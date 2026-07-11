import { Router } from "express";
import { db, aiAnalysesTable, aiConfigTable, aiValuationsTable, aiPredictionsTable, aiMarketAnalysesTable } from "@workspace/db";
import {
  ordersTable, productsTable, transactionsTable, employeesTable,
  leadsTable, customersTable, companiesTable, shareholdersTable
} from "@workspace/db";
import { eq, sql, desc, inArray, and } from "drizzle-orm";
import { requirePermission, requireSuperAdmin } from "../middleware/authz";
import { getActiveProvider, getActiveProviderName, setConfig, testProvider } from "../lib/ai-provider";
import {
  buildCompanyContext, buildPortfolioContext, formatContextForPrompt,
  buildMonthlyFinanceTrend, formatMonthlyTrendForPrompt,
} from "../lib/ai-context";
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
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
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

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
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

// ── Valuation system prompt ───────────────────────────────────────────────────
const VALUATION_SYSTEM_PROMPT = `You are a senior investment analyst and business valuation expert.
Analyse the provided financial data using SIX valuation methods, then produce a weighted-average final estimate.

Valuation Methods and Weights:
  1. Asset-Based        (20%): Net Worth = Total Assets − Total Liabilities
  2. Revenue Multiple   (30%): Annual Revenue × industry multiple (0.5–3× ecommerce/retail; 1–3× manufacturing; 5–15× SaaS)
  3. EBITDA Multiple    (20%): EBITDA × 4–8× (use net profit as EBITDA proxy when EBITDA unavailable)
  4. DCF                (15%): Estimate 3-year free cash flow, discount at 20% WACC, add terminal value
  5. Startup Scorecard  (10%): Score team, product, market, traction, competition (0–100 each), scale to INR
  6. VC Method          ( 5%): Estimate exit value in 5 years at 3–5× revenue, discount at 30% required return

Return ONLY valid JSON — no markdown, no text outside the JSON:
{
  "asset_valuation":           number,   // INR
  "revenue_multiple_valuation": number,  // INR
  "ebitda_valuation":          number,   // INR
  "dcf_valuation":             number,   // INR
  "scorecard_valuation":       number,   // INR
  "vc_valuation":              number,   // INR
  "estimated_value":           number,   // INR — weighted average of all 6 methods
  "enterprise_value":          number,   // INR — estimated_value + estimated debt − cash
  "shareholder_equity":        number,   // INR — estimated_value − estimated liabilities
  "nav":                       number,   // INR — net asset value
  "book_value_per_share":      number,   // INR — shareholder_equity ÷ outstanding_shares (0 if no share data)
  "estimated_share_price":     number,   // INR — estimated_value ÷ outstanding_shares (0 if no share data)
  "growth_score":              number,   // 0–100 composite growth quality score
  "health_trend":              "growing"|"stable"|"declining",
  "revenue_growth_rate":       number,   // % MoM or YoY (positive or negative)
  "profit_growth_rate":        number,   // %
  "investor_score":            number,   // 0–100 Investor Readiness Score
  "investor_rating":           "excellent"|"strong"|"moderate"|"needs_improvement",
  "recommendations":           string[], // 4–6 specific, actionable investor-readiness suggestions
  "explanation":               string    // 3–4 sentence plain-language explanation citing actual numbers
}

Investor Readiness Score bands: 90–100 = excellent, 75–89 = strong, 60–74 = moderate, <60 = needs_improvement.
All monetary values in Indian Rupees (INR). Return ONLY JSON — no markdown.`;

// ── Predictions system prompt ─────────────────────────────────────────────────
const PREDICTIONS_SYSTEM_PROMPT = `You are a financial forecasting expert.
Based on the provided business data and 12-month trend, generate 3, 6, and 12-month predictions.
Return ONLY valid JSON:
{
  "predictions": [
    {
      "metric":             "revenue"|"profit"|"cash_flow"|"valuation"|"headcount",
      "horizon":            3|6|12,
      "value":              number,
      "confidence_score":   number,      // 0-100
      "risk_level":         "low"|"medium"|"high",
      "supporting_factors": string[],    // 2-3 specific factors
      "recommended_actions": string[]    // 1-3 actionable steps
    }
  ]
}
Generate exactly 15 entries: all 5 metrics × 3 horizons.
All monetary values in INR. Return ONLY JSON — no markdown.`;

// ── Market system prompt ──────────────────────────────────────────────────────
const MARKET_SYSTEM_PROMPT = `You are a market intelligence and competitive analysis expert.
Based on the provided company profile and data, generate actionable market intelligence.
Return ONLY valid JSON:
{
  "industry_demand": string,           // 3-4 sentences on industry demand/trends
  "competitor_analysis": [
    {
      "name":           string,        // competitor name or archetype
      "strength":       string,        // their competitive advantage
      "weakness":       string,        // their vulnerability
      "market_position": string        // how they compare to this company
    }
  ],
  "recommendations": [
    {
      "type":        "launch"|"enter"|"discontinue"|"pricing"|"operational",
      "title":       string,
      "description": string,
      "priority":    "critical"|"high"|"medium"|"low"
    }
  ]
}
Include 3-4 competitors and 4-6 prioritised recommendations. Return ONLY JSON — no markdown.`;

// ── POST /ai/valuation/:companyId ─────────────────────────────────────────────
router.post("/ai/valuation/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const force = (req.query.force as string | undefined) === "true";

    if (!force) {
      const [cached] = await db.select().from(aiValuationsTable)
        .where(eq(aiValuationsTable.companyId, companyId))
        .orderBy(desc(aiValuationsTable.createdAt)).limit(1);
      if (cached && isFresh(cached.createdAt)) { res.json(formatValuation(cached)); return; }
    }

    const ctx = await buildCompanyContext(companyId);
    if (!ctx) { res.status(404).json({ error: "Company not found" }); return; }

    // Pull 12-month trend + outstanding shares for share price calculations
    const [trend, sharesRow] = await Promise.all([
      buildMonthlyFinanceTrend(companyId, 12),
      db.select({ totalShares: sql<number>`coalesce(sum(shares), 0)` })
        .from(shareholdersTable)
        .where(and(eq(shareholdersTable.companyId, companyId), eq(shareholdersTable.status, "active"))),
    ]);
    const trendText      = formatMonthlyTrendForPrompt(trend);
    const outstandingShares = Number(sharesRow[0]?.totalShares ?? 0);

    const provider     = await getActiveProvider();
    const providerName = await getActiveProviderName();

    const userMsg = [
      `Company data:\n${formatContextForPrompt(ctx)}`,
      `\n12-Month Trend:\n${trendText}`,
      `\nOutstanding Shares: ${outstandingShares > 0 ? outstandingShares.toLocaleString("en-IN") : "unknown"}`,
    ].join("\n");

    const raw = await provider.chat(
      [{ role: "user", content: userMsg }],
      VALUATION_SYSTEM_PROMPT,
    );

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonStr); }
    catch {
      req.log.warn({ raw }, "Valuation AI returned non-JSON");
      res.status(502).json({ error: "AI returned unexpected format. Please retry." }); return;
    }

    const num  = (v: unknown, def = 0) => Number.isFinite(Number(v)) ? Number(v) : def;
    const clamp = (v: unknown) => Math.min(100, Math.max(0, Math.round(num(v))));
    const VALID_RATINGS   = ["excellent", "strong", "moderate", "needs_improvement"];
    const VALID_TRENDS    = ["growing", "stable", "declining"];

    const [row] = await db.insert(aiValuationsTable).values({
      companyId,
      provider: providerName,
      estimatedValue:    num(parsed.estimated_value),
      enterpriseValue:   num(parsed.enterprise_value),
      shareholderEquity: num(parsed.shareholder_equity),
      nav:               num(parsed.nav),
      growthScore:       clamp(parsed.growth_score),
      healthTrend:       VALID_TRENDS.includes(String(parsed.health_trend)) ? String(parsed.health_trend) : "stable",
      revenueGrowthRate: num(parsed.revenue_growth_rate),
      profitGrowthRate:  num(parsed.profit_growth_rate),
      explanation:       typeof parsed.explanation === "string" ? parsed.explanation : null,
      // New multi-method fields
      investorScore:          clamp(parsed.investor_score),
      investorRating:         VALID_RATINGS.includes(String(parsed.investor_rating)) ? String(parsed.investor_rating) : "moderate",
      assetValuation:         num(parsed.asset_valuation),
      revenueMultipleVal:     num(parsed.revenue_multiple_valuation),
      ebitdaValuation:        num(parsed.ebitda_valuation),
      dcfValuation:           num(parsed.dcf_valuation),
      scorecardValuation:     num(parsed.scorecard_valuation),
      vcValuation:            num(parsed.vc_valuation),
      bookValuePerShare:      num(parsed.book_value_per_share),
      estimatedSharePrice:    num(parsed.estimated_share_price),
      recommendations:        Array.isArray(parsed.recommendations)
                                ? (parsed.recommendations as unknown[]).filter(r => typeof r === "string").slice(0, 8)
                                : [],
    }).returning();

    res.json(formatValuation(row));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Valuation AI failed" });
  }
});

// ── GET /ai/valuation/:companyId ──────────────────────────────────────────────
router.get("/ai/valuation/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [cached] = await db.select().from(aiValuationsTable)
      .where(eq(aiValuationsTable.companyId, companyId))
      .orderBy(desc(aiValuationsTable.createdAt)).limit(1);

    res.json(cached && isFresh(cached.createdAt) ? formatValuation(cached) : null);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get cached valuation" });
  }
});

// ── GET /ai/valuation/:companyId/shareholders ─────────────────────────────────
router.get("/ai/valuation/:companyId/shareholders", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [valuation] = await db.select().from(aiValuationsTable)
      .where(eq(aiValuationsTable.companyId, companyId))
      .orderBy(desc(aiValuationsTable.createdAt)).limit(1);

    const holders = await db.select().from(shareholdersTable)
      .where(and(eq(shareholdersTable.companyId, companyId), eq(shareholdersTable.status, "active")));

    const estValue = valuation?.estimatedValue ?? 0;
    const shareholders = holders.map((h) => {
      const ownershipPct  = (h.ownershipPercent ?? 0) / 100;
      const shareValue    = estValue * ownershipPct;
      const capitalIn     = h.investmentAmount ?? 0;
      const roiEstimate   = capitalIn > 0 ? ((shareValue - capitalIn) / capitalIn) * 100 : null;
      const growthRate    = valuation?.revenueGrowthRate ?? 0;
      return {
        id:                 h.id,
        name:               h.name,
        role:               h.role,
        ownershipPercent:   h.ownershipPercent ?? 0,
        shares:             h.shares ?? 0,
        capitalInvested:    capitalIn,
        estimatedShareValue: shareValue,
        estimatedGrowth:    growthRate,
        roiEstimate,
        roiExplanation: roiEstimate != null
          ? `Based on ₹${Math.round(capitalIn).toLocaleString("en-IN")} invested and AI-estimated share value of ₹${Math.round(shareValue).toLocaleString("en-IN")}`
          : "No capital injection recorded — ROI cannot be computed",
      };
    });

    res.json({
      valuation: valuation ? formatValuation(valuation) : null,
      shareholders,
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to build shareholder valuation" });
  }
});

// ── POST /ai/predictions/:companyId ──────────────────────────────────────────
router.post("/ai/predictions/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const force = (req.query.force as string | undefined) === "true";
    if (!force) {
      const [cached] = await db.select().from(aiPredictionsTable)
        .where(eq(aiPredictionsTable.companyId, companyId))
        .orderBy(desc(aiPredictionsTable.createdAt)).limit(1);
      if (cached && isFresh(cached.createdAt)) { res.json(formatPredictions(cached)); return; }
    }

    const ctx   = await buildCompanyContext(companyId);
    if (!ctx) { res.status(404).json({ error: "Company not found" }); return; }
    const trend = await buildMonthlyFinanceTrend(companyId, 12);
    const trendText = formatMonthlyTrendForPrompt(trend);

    const provider = await getActiveProvider();
    const providerName = await getActiveProviderName();

    const raw = await provider.chat(
      [{ role: "user", content: `Company snapshot:\n${formatContextForPrompt(ctx)}\n\n12-Month Trend:\n${trendText}` }],
      PREDICTIONS_SYSTEM_PROMPT,
    );

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonStr); }
    catch {
      req.log.warn({ raw }, "Predictions AI returned non-JSON");
      res.status(502).json({ error: "AI returned unexpected format. Please retry." }); return;
    }

    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
    const rawPreds = Array.isArray(parsed.predictions) ? parsed.predictions : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const predictions = rawPreds.map((p: any) => ({
      metric:             String(p.metric ?? "revenue"),
      horizon:            [3, 6, 12].includes(Number(p.horizon)) ? Number(p.horizon) : 3,
      value:              Number(p.value ?? 0),
      confidenceScore:    Math.min(100, Math.max(0, Number(p.confidence_score ?? 70))),
      riskLevel:          ["low", "medium", "high"].includes(String(p.risk_level)) ? String(p.risk_level) : "medium",
      supportingFactors:  arr(p.supporting_factors),
      recommendedActions: arr(p.recommended_actions),
    }));

    const [row] = await db.insert(aiPredictionsTable).values({
      companyId, provider: providerName, predictions,
    }).returning();

    res.json(formatPredictions(row));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Predictions AI failed" });
  }
});

// ── GET /ai/predictions/:companyId ────────────────────────────────────────────
router.get("/ai/predictions/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [cached] = await db.select().from(aiPredictionsTable)
      .where(eq(aiPredictionsTable.companyId, companyId))
      .orderBy(desc(aiPredictionsTable.createdAt)).limit(1);

    res.json(cached && isFresh(cached.createdAt) ? formatPredictions(cached) : null);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get cached predictions" });
  }
});

// ── POST /ai/market/:companyId ────────────────────────────────────────────────
router.post("/ai/market/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const force = (req.query.force as string | undefined) === "true";
    if (!force) {
      const [cached] = await db.select().from(aiMarketAnalysesTable)
        .where(eq(aiMarketAnalysesTable.companyId, companyId))
        .orderBy(desc(aiMarketAnalysesTable.createdAt)).limit(1);
      if (cached && isFresh(cached.createdAt)) { res.json(formatMarket(cached)); return; }
    }

    const ctx = await buildCompanyContext(companyId);
    if (!ctx) { res.status(404).json({ error: "Company not found" }); return; }

    // Fetch company profile for industry/type info
    const [company] = await db.select({ industry: companiesTable.industry, type: companiesTable.type })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);

    const provider = await getActiveProvider();
    const providerName = await getActiveProviderName();

    const industryNote = company?.industry
      ? `Industry: ${company.industry}\n`
      : "Industry: Not specified\n";

    const raw = await provider.chat(
      [{ role: "user", content: `${industryNote}Company data:\n${formatContextForPrompt(ctx)}` }],
      MARKET_SYSTEM_PROMPT,
    );

    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonStr); }
    catch {
      req.log.warn({ raw }, "Market AI returned non-JSON");
      res.status(502).json({ error: "AI returned unexpected format. Please retry." }); return;
    }

    const VALID_TYPES = new Set(["launch", "enter", "discontinue", "pricing", "operational"]);
    const VALID_PRI   = new Set(["critical", "high", "medium", "low"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawComps = Array.isArray(parsed.competitor_analysis) ? parsed.competitor_analysis : [];
    const competitorAnalysis = rawComps.map((c: any) => ({
      name:           String(c.name ?? "Competitor"),
      strength:       String(c.strength ?? ""),
      weakness:       String(c.weakness ?? ""),
      marketPosition: String(c.market_position ?? ""),
    }));

    const rawRecs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    const recommendations = rawRecs.map((r: any) => ({
      type:        VALID_TYPES.has(String(r.type)) ? String(r.type) : "operational",
      title:       String(r.title ?? ""),
      description: String(r.description ?? ""),
      priority:    VALID_PRI.has(String(r.priority)) ? String(r.priority) : "medium",
    }));

    const [row] = await db.insert(aiMarketAnalysesTable).values({
      companyId, provider: providerName,
      industryDemand: typeof parsed.industry_demand === "string" ? parsed.industry_demand : null,
      competitorAnalysis,
      recommendations,
    }).returning();

    res.json(formatMarket(row));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Market AI failed" });
  }
});

// ── GET /ai/market/:companyId ─────────────────────────────────────────────────
router.get("/ai/market/:companyId", requirePermission("ai.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.params.companyId as string);
    if (!Number.isFinite(companyId)) { res.status(400).json({ error: "Invalid companyId" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [cached] = await db.select().from(aiMarketAnalysesTable)
      .where(eq(aiMarketAnalysesTable.companyId, companyId))
      .orderBy(desc(aiMarketAnalysesTable.createdAt)).limit(1);

    res.json(cached && isFresh(cached.createdAt) ? formatMarket(cached) : null);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get cached market analysis" });
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

function formatValuation(v: typeof aiValuationsTable.$inferSelect) {
  return {
    id: v.id, companyId: v.companyId, provider: v.provider,
    estimatedValue:    v.estimatedValue,
    enterpriseValue:   v.enterpriseValue,
    shareholderEquity: v.shareholderEquity,
    nav:               v.nav,
    growthScore:       v.growthScore,
    healthTrend:       v.healthTrend,
    revenueGrowthRate: v.revenueGrowthRate,
    profitGrowthRate:  v.profitGrowthRate,
    explanation:       v.explanation,
    // Multi-method valuation engine fields
    investorScore:        v.investorScore,
    investorRating:       v.investorRating,
    assetValuation:       v.assetValuation,
    revenueMultipleVal:   v.revenueMultipleVal,
    ebitdaValuation:      v.ebitdaValuation,
    dcfValuation:         v.dcfValuation,
    scorecardValuation:   v.scorecardValuation,
    vcValuation:          v.vcValuation,
    bookValuePerShare:    v.bookValuePerShare,
    estimatedSharePrice:  v.estimatedSharePrice,
    recommendations:      v.recommendations ?? [],
    createdAt:            v.createdAt.toISOString(),
  };
}

function formatPredictions(p: typeof aiPredictionsTable.$inferSelect) {
  return {
    id: p.id, companyId: p.companyId, provider: p.provider,
    predictions: p.predictions,
    createdAt: p.createdAt.toISOString(),
  };
}

function formatMarket(m: typeof aiMarketAnalysesTable.$inferSelect) {
  return {
    id: m.id, companyId: m.companyId, provider: m.provider,
    industryDemand:     m.industryDemand,
    competitorAnalysis: m.competitorAnalysis,
    recommendations:    m.recommendations,
    createdAt:          m.createdAt.toISOString(),
  };
}

export default router;
