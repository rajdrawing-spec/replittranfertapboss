import { Router } from "express";
import { db, aiAnalysesTable, aiConfigTable } from "@workspace/db";
import {
  ordersTable, productsTable, transactionsTable, employeesTable,
  leadsTable, customersTable, companiesTable
} from "@workspace/db";
import { eq, sql, desc, inArray, and } from "drizzle-orm";
import { requirePermission, requireSuperAdmin } from "../middleware/authz";
import { getActiveProvider, getActiveProviderName, setConfig, testProvider } from "../lib/ai-provider";
import { buildCompanyContext, buildPortfolioContext, formatContextForPrompt } from "../lib/ai-context";
import { canAccessCompany, companyScope } from "../lib/company-scope";

// ── Prompt guardrails ─────────────────────────────────────────────────────────
const MAX_QUESTION_LEN = 1000;
function sanitizePromptInput(s: string): string {
  return s.trim().slice(0, MAX_QUESTION_LEN).replace(/[<>]/g, "");
}
function frameUserInput(label: string, value: string): string {
  return `[BEGIN ${label}]\n${value}\n[END ${label}]`;
}

const router = Router();

// ── Cache TTL ─────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function isFresh(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() < CACHE_TTL_MS;
}

// ── SWOT system prompt ────────────────────────────────────────────────────────
const ANALYSIS_SYSTEM_PROMPT = `You are an expert business intelligence analyst and management consultant.
Analyse the provided company data and return ONLY valid JSON — no markdown, no explanation outside the JSON.
Your output MUST strictly follow this schema:
{
  "strengths":           string[],  // 3–5 bullet points
  "weaknesses":          string[],  // 3–5 bullet points
  "opportunities":       string[],  // 3–5 bullet points
  "threats":             string[],  // 3–5 bullet points
  "revenue_leaks":       string[],  // 2–4 specific revenue leak observations
  "cost_opportunities":  string[],  // 2–4 actionable cost reduction ideas
  "cash_risks":          string[],  // 2–3 cash flow risk flags
  "growth_opportunities":string[],  // 3–5 concrete growth actions
  "summary":             string     // 2–3 sentence executive summary
}
Be specific, data-driven, and concise. Each bullet is max 15 words.`;

const EXECUTIVE_SYSTEM_PROMPT = `You are a virtual executive team — acting simultaneously as CEO, CFO, COO, and CMO — for a multi-company business group.
Analyse the provided business data and answer the strategic question.
Return ONLY valid JSON with this schema:
{
  "answer":          string,    // direct 1–2 sentence answer
  "reasoning":       string,    // 2–4 sentence reasoning
  "supporting_data": string[],  // 3–5 specific data points from the context
  "financial_impact":string,    // e.g. "Potential ₹X savings / revenue uplift"
  "effort":          string,    // "Low / Medium / High"
  "confidence":      number,    // 0–100
  "priority":        "critical"|"high"|"medium"|"low"
}`;

// ── POST /ai/analyse/:companyId ───────────────────────────────────────────────
router.post("/ai/analyse/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const force = (req.query.force as string | undefined) === "true";

    // Check 1-hour cache unless force-refresh
    if (!force) {
      const [cached] = await db
        .select()
        .from(aiAnalysesTable)
        .where(eq(aiAnalysesTable.companyId, companyId))
        .orderBy(desc(aiAnalysesTable.createdAt))
        .limit(1);
      if (cached && isFresh(cached.createdAt)) {
        res.json(formatAnalysis(cached));
        return;
      }
    }

    const ctx = await buildCompanyContext(companyId);
    if (!ctx) { res.status(404).json({ error: "Company not found" }); return; }

    const provider = await getActiveProvider();
    const providerName = await getActiveProviderName();
    const contextText = formatContextForPrompt(ctx);

    const raw = await provider.chat(
      [{ role: "user", content: `Analyse this company:\n\n${contextText}` }],
      ANALYSIS_SYSTEM_PROMPT,
    );

    // Parse JSON — strip any accidental markdown fences
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      req.log.warn({ raw }, "AI analysis returned non-JSON");
      res.status(502).json({ error: "AI returned unexpected format. Please retry." });
      return;
    }

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

    const [analysis] = await db
      .insert(aiAnalysesTable)
      .values({
        companyId,
        provider: providerName,
        strengths:           arr(parsed.strengths),
        weaknesses:          arr(parsed.weaknesses),
        opportunities:       arr(parsed.opportunities),
        threats:             arr(parsed.threats),
        revenueleaks:        arr(parsed.revenue_leaks),
        costOpportunities:   arr(parsed.cost_opportunities),
        cashRisks:           arr(parsed.cash_risks),
        growthOpportunities: arr(parsed.growth_opportunities),
        summary:             typeof parsed.summary === "string" ? parsed.summary : null,
      })
      .returning();

    res.json(formatAnalysis(analysis));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "AI analysis failed" });
  }
});

// ── GET /ai/analyse/:companyId/cached ─────────────────────────────────────────
router.get("/ai/analyse/:companyId/cached", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [cached] = await db
      .select()
      .from(aiAnalysesTable)
      .where(eq(aiAnalysesTable.companyId, companyId))
      .orderBy(desc(aiAnalysesTable.createdAt))
      .limit(1);

    if (!cached || !isFresh(cached.createdAt)) {
      res.json(null);
      return;
    }
    res.json(formatAnalysis(cached));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to fetch cached analysis" });
  }
});

// ── POST /ai/executive ────────────────────────────────────────────────────────
router.post("/ai/executive", requirePermission("ai.read"), async (req, res) => {
  try {
    const { question, companyId, companyIds } = req.body as {
      question?: string;
      companyId?: number | null;
      companyIds?: number[];
    };

    if (!question?.trim()) { res.status(400).json({ error: "Question is required" }); return; }

    // Determine caller's allowed companies (null = super admin, all companies)
    const callerScope = companyScope(req);

    // Validate targeted company selections against caller's scope
    if (companyId && !canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (companyIds?.length) {
      const forbidden = companyIds.filter(id => !canAccessCompany(req, id));
      if (forbidden.length) { res.status(403).json({ error: "Forbidden: one or more company IDs are out of scope" }); return; }
    }

    // Sanitize and frame user input to prevent prompt injection
    const safeQuestion = sanitizePromptInput(question);
    if (!safeQuestion) { res.status(400).json({ error: "Question is required" }); return; }

    // Build context — single company, explicit list, or caller-scoped portfolio
    let contextText: string;
    if (companyId) {
      const ctx = await buildCompanyContext(companyId);
      contextText = ctx ? formatContextForPrompt(ctx) : "No data available for this company.";
    } else if (companyIds?.length) {
      const portfolio = await buildPortfolioContext(companyIds);
      contextText = portfolio.companies.map(formatContextForPrompt).join("\n\n---\n\n");
    } else {
      // Default: only companies the caller is authorised to see.
      // callerScope === null → super admin → full portfolio allowed.
      // callerScope === []   → no companies → refuse rather than return empty context.
      if (callerScope !== null && callerScope.length === 0) {
        res.status(403).json({ error: "You are not associated with any company" });
        return;
      }
      const portfolio = await buildPortfolioContext(callerScope ?? undefined);
      contextText = [
        `Portfolio Summary: Total Revenue ₹${Math.round(portfolio.groupRevenue).toLocaleString("en-IN")}, ` +
        `Expenses ₹${Math.round(portfolio.groupExpenses).toLocaleString("en-IN")}, ` +
        `Net Profit ₹${Math.round(portfolio.groupNetProfit).toLocaleString("en-IN")}, ` +
        `Active Employees ${portfolio.activeEmployees}`,
        "",
        ...portfolio.companies.map(formatContextForPrompt),
      ].join("\n\n---\n\n");
    }

    const provider = await getActiveProvider();
    const raw = await provider.chat(
      [{ role: "user", content: `Business Data:\n\n${contextText}\n\n${frameUserInput("QUESTION", safeQuestion)}` }],
      EXECUTIVE_SYSTEM_PROMPT,
    );

    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      req.log.warn({ raw }, "Executive AI returned non-JSON");
      res.status(502).json({ error: "AI returned unexpected format. Please retry." });
      return;
    }

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

    res.json({
      answer:         String(parsed.answer ?? ""),
      reasoning:      String(parsed.reasoning ?? ""),
      supportingData: arr(parsed.supporting_data),
      financialImpact: typeof parsed.financial_impact === "string" ? parsed.financial_impact : null,
      effort:         typeof parsed.effort === "string" ? parsed.effort : null,
      confidence:     Number(parsed.confidence ?? 70),
      priority:       ["critical", "high", "medium", "low"].includes(String(parsed.priority))
                        ? (parsed.priority as string)
                        : "medium",
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Executive AI query failed" });
  }
});

// ── GET /ai/provider ──────────────────────────────────────────────────────────
router.get("/ai/provider", requireSuperAdmin, async (req, res) => {
  try {
    const activeProvider = await getActiveProviderName();
    const keys = await db.select().from(aiConfigTable);
    const keyMap = Object.fromEntries(keys.map((r) => [r.key, r.value]));

    res.json({
      activeProvider,
      providers: [
        { name: "gemini",      label: "Google Gemini (Replit proxy — free)", requiresKey: false, hasKey: true },
        { name: "openrouter",  label: "OpenRouter (free models)",             requiresKey: true,  hasKey: !!keyMap["openrouter_api_key"] },
        { name: "groq",        label: "Groq (fast free models)",              requiresKey: true,  hasKey: !!keyMap["groq_api_key"] },
        { name: "deepseek",    label: "DeepSeek",                             requiresKey: true,  hasKey: !!keyMap["deepseek_api_key"] },
      ],
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get AI provider config" });
  }
});

// ── PATCH /ai/provider ────────────────────────────────────────────────────────
router.patch("/ai/provider", requireSuperAdmin, async (req, res) => {
  try {
    const { activeProvider, groqApiKey, openrouterApiKey, deepseekApiKey } = req.body as Record<string, string | undefined>;
    const valid = ["gemini", "openrouter", "groq", "deepseek"];

    if (activeProvider !== undefined) {
      if (!valid.includes(activeProvider)) { res.status(400).json({ error: "Invalid provider" }); return; }
      await setConfig("active_provider", activeProvider);
    }
    if (groqApiKey !== undefined)        await setConfig("groq_api_key",        groqApiKey);
    if (openrouterApiKey !== undefined)  await setConfig("openrouter_api_key",  openrouterApiKey);
    if (deepseekApiKey !== undefined)    await setConfig("deepseek_api_key",    deepseekApiKey);

    // Return updated config (same shape as GET)
    const updatedProvider = await getActiveProviderName();
    const keys = await db.select().from(aiConfigTable);
    const keyMap = Object.fromEntries(keys.map((r) => [r.key, r.value]));
    res.json({
      activeProvider: updatedProvider,
      providers: [
        { name: "gemini",     label: "Google Gemini (Replit proxy — free)", requiresKey: false, hasKey: true },
        { name: "openrouter", label: "OpenRouter (free models)",             requiresKey: true,  hasKey: !!keyMap["openrouter_api_key"] },
        { name: "groq",       label: "Groq (fast free models)",              requiresKey: true,  hasKey: !!keyMap["groq_api_key"] },
        { name: "deepseek",   label: "DeepSeek",                             requiresKey: true,  hasKey: !!keyMap["deepseek_api_key"] },
      ],
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update AI provider" });
  }
});

// ── POST /ai/provider/test ────────────────────────────────────────────────────
router.post("/ai/provider/test", requireSuperAdmin, async (req, res) => {
  try {
    const { provider } = req.body as { provider?: string };
    if (!provider) { res.status(400).json({ error: "provider is required" }); return; }
    const result = await testProvider(provider);
    res.json({ ok: result.ok, latencyMs: result.latencyMs, error: result.error ?? null });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Provider test failed" });
  }
});

// ── Legacy endpoints ──────────────────────────────────────────────────────────
// Still require ai.read permission — any authenticated user that needs AI chat
// must have this permission granted to their role.
router.post("/ai/chat", requirePermission("ai.read"), async (req, res) => {
  try {
    const { message, companyId: reqCompanyId } = req.body as { message: string; companyId?: number };

    // Determine the company filter: explicit single company, or caller's full scope.
    const callerScope = companyScope(req);
    if (callerScope !== null && callerScope.length === 0) {
      res.json({ response: "No company data available for your account.", timestamp: new Date().toISOString(), dataPoints: [] });
      return;
    }

    // Validate explicitly requested company
    if (reqCompanyId && !canAccessCompany(req, reqCompanyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    // Build a drizzle condition for filtering by accessible companies
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeCondition = (col: any) =>
      reqCompanyId
        ? eq(col, reqCompanyId)
        : callerScope !== null && callerScope.length > 0
          ? inArray(col, callerScope)
          : undefined; // super admin with no specific company = no filter

    const [orderStats] = await db
      .select({
        total: sql<number>`count(*)`,
        todayRevenue: sql<number>`coalesce(sum(case when created_at::date = current_date then total_amount else 0 end), 0)`,
        monthlyRevenue: sql<number>`coalesce(sum(case when date_trunc('month', created_at) = date_trunc('month', now()) then total_amount else 0 end), 0)`,
        pending: sql<number>`count(*) filter (where status = 'pending')`,
      })
      .from(ordersTable)
      .where(scopeCondition(ordersTable.companyId));

    const [invStats] = await db
      .select({ lowStock: sql<number>`count(*) filter (where stock_quantity <= reorder_level)` })
      .from(productsTable)
      .where(scopeCondition(productsTable.companyId));

    const [empCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(employeesTable)
      .where(and(eq(employeesTable.status, "active"), scopeCondition(employeesTable.companyId)));

    const [leadStats] = await db
      .select({
        total: sql<number>`count(*)`,
        newLeads: sql<number>`count(*) filter (where stage = 'new')`,
        won: sql<number>`count(*) filter (where stage = 'won')`,
      })
      .from(leadsTable)
      .where(scopeCondition(leadsTable.companyId));

    const ctx = {
      todayRevenue: Number(orderStats?.todayRevenue ?? 0),
      monthlyRevenue: Number(orderStats?.monthlyRevenue ?? 0),
      totalOrders: Number(orderStats?.total ?? 0),
      pendingOrders: Number(orderStats?.pending ?? 0),
      lowStockItems: Number(invStats?.lowStock ?? 0),
      activeEmployees: Number(empCount?.count ?? 0),
      totalLeads: Number(leadStats?.total ?? 0),
      newLeads: Number(leadStats?.newLeads ?? 0),
      wonLeads: Number(leadStats?.won ?? 0),
    };

    // Use the active AI provider for richer responses
    let response = "";
    const dataPoints: { label: string; value: string }[] = [];

    try {
      const provider = await getActiveProvider();
      const contextSummary = `Business context: Monthly revenue ₹${ctx.monthlyRevenue.toLocaleString("en-IN")}, ${ctx.totalOrders} orders (${ctx.pendingOrders} pending), ${ctx.activeEmployees} employees, ${ctx.lowStockItems} low-stock items, ${ctx.totalLeads} leads (win rate ${ctx.totalLeads > 0 ? ((ctx.wonLeads / ctx.totalLeads) * 100).toFixed(1) : 0}%).`;
      response = await provider.chat(
        [{ role: "user", content: message }],
        `You are TAPBOSS AI, a business intelligence assistant. ${contextSummary} Be concise and data-driven. Max 3 sentences.`,
      );
      dataPoints.push({ label: "Monthly Revenue", value: `₹${ctx.monthlyRevenue.toLocaleString("en-IN")}` });
      dataPoints.push({ label: "Active Employees", value: String(ctx.activeEmployees) });
    } catch {
      // Fallback to rule-based
      response = `Monthly revenue is ₹${ctx.monthlyRevenue.toLocaleString("en-IN")}. There are ${ctx.pendingOrders} pending orders and ${ctx.lowStockItems} low-stock items needing attention.`;
      dataPoints.push({ label: "Monthly Revenue", value: `₹${ctx.monthlyRevenue.toLocaleString("en-IN")}` });
    }

    res.json({ response, timestamp: new Date().toISOString(), dataPoints });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "AI assistant error" });
  }
});

router.get("/ai/insights", requirePermission("ai.read"), async (req, res) => {
  try {
    const insightScope = companyScope(req);
    if (insightScope !== null && insightScope.length === 0) {
      res.json([]);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scopeFilter = (col: any) =>
      insightScope !== null && insightScope.length > 0 ? inArray(col, insightScope) : undefined;

    const [invStats] = await db
      .select({ lowStock: sql<number>`count(*) filter (where stock_quantity <= reorder_level and stock_quantity > 0)`, outOfStock: sql<number>`count(*) filter (where stock_quantity = 0)` })
      .from(productsTable)
      .where(scopeFilter(productsTable.companyId));

    const [orderStats] = await db
      .select({ pending: sql<number>`count(*) filter (where status = 'pending')` })
      .from(ordersTable)
      .where(scopeFilter(ordersTable.companyId));

    // Restrict company list to caller's scope
    const companiesQuery = db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable);
    const companies = insightScope !== null && insightScope.length > 0
      ? await companiesQuery.where(inArray(companiesTable.id, insightScope))
      : await companiesQuery;

    const insights = [
      {
        id: 1, type: "low_inventory",
        title: `${Number(invStats?.lowStock ?? 0)} Products Below Reorder Level`,
        description: `${Number(invStats?.lowStock ?? 0)} products are running low. ${Number(invStats?.outOfStock ?? 0)} are completely out of stock.`,
        severity: Number(invStats?.outOfStock ?? 0) > 0 ? "critical" : "warning",
        companyName: null, actionLabel: "View Inventory", actionUrl: "/inventory",
        createdAt: new Date().toISOString(),
      },
      {
        id: 2, type: "sales_trend",
        title: "Revenue Trend Active",
        description: "Check the Analytics module for detailed revenue and profit trends across all subsidiaries.",
        severity: "info",
        companyName: companies[0]?.name ?? "TapasHub", actionLabel: "View Analytics", actionUrl: "/analytics",
        createdAt: new Date().toISOString(),
      },
      {
        id: 3, type: "compliance",
        title: "GST Filing Due in 5 Days",
        description: "GSTR-1 filing deadline is approaching. Ensure all sales invoices are verified and filed.",
        severity: "warning",
        companyName: null, actionLabel: "Check Finance", actionUrl: "/finance",
        createdAt: new Date().toISOString(),
      },
      {
        id: 4, type: "overdue_payment",
        title: `${Number(orderStats?.pending ?? 0)} Orders Pending Processing`,
        description: `${Number(orderStats?.pending ?? 0)} orders awaiting confirmation and dispatch.`,
        severity: Number(orderStats?.pending ?? 0) > 20 ? "critical" : "warning",
        companyName: null, actionLabel: "Process Orders", actionUrl: "/orders",
        createdAt: new Date().toISOString(),
      },
    ];

    res.json(insights);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get AI insights" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatAnalysis(a: typeof aiAnalysesTable.$inferSelect) {
  return {
    id:                  a.id,
    companyId:           a.companyId,
    provider:            a.provider,
    strengths:           a.strengths,
    weaknesses:          a.weaknesses,
    opportunities:       a.opportunities,
    threats:             a.threats,
    revenueleaks:        a.revenueleaks,
    costOpportunities:   a.costOpportunities,
    cashRisks:           a.cashRisks,
    growthOpportunities: a.growthOpportunities,
    summary:             a.summary,
    createdAt:           a.createdAt.toISOString(),
  };
}

export default router;
