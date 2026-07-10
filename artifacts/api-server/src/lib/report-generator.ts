/**
 * AI Executive Report Generator
 *
 * Produces structured report content (JSON) + rich HTML email combining live
 * financial data, cached AI analyses (SWOT, valuation, predictions, market)
 * and AI-written executive narrative, recommendations, and action plan.
 */

import { db } from "@workspace/db";
import {
  aiAnalysesTable, aiValuationsTable, aiPredictionsTable, aiMarketAnalysesTable,
  aiReportHistoryTable, transactionsTable, companiesTable,
} from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { getActiveProvider, getActiveProviderName } from "./ai-provider";
import {
  buildCompanyContext, buildPortfolioContext,
  formatContextForPrompt, buildMonthlyFinanceTrend,
} from "./ai-context";
import { appUrl } from "./email";

// ── Helpers ───────────────────────────────────────────────────────────────────
const inr = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(1)}L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── Content JSON types ────────────────────────────────────────────────────────
export interface ReportKpi {
  label: string; value: string; raw: number; delta?: string; color: string;
}
export interface ReportChartPoint {
  label: string; revenue: number; expenses: number; profit: number;
}
export interface ReportRisk         { title: string; severity: string; }
export interface ReportOpportunity  { title: string; impact: string; }
export interface ReportRecommendation {
  title: string; description: string; priority: string; effort: string;
}
export interface ReportActionItem   { item: string; priority: string; }

export interface ReportContentJson {
  kpis:            ReportKpi[];
  chart_data:      ReportChartPoint[];
  risks:           ReportRisk[];
  opportunities:   ReportOpportunity[];
  recommendations: ReportRecommendation[];
  action_plan:     ReportActionItem[];
  ai_narrative:    string;
}

// ── Period label ──────────────────────────────────────────────────────────────
export function computePeriodLabel(type: string, date: Date = new Date()): string | null {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  switch (type) {
    case "daily":
      return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    case "weekly": {
      // ISO week number
      const jan4 = new Date(y, 0, 4);
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      const weekNum = Math.round((startOfWeek.getTime() - jan4.getTime()) / (7 * 86400000)) + 1;
      return `${y}-W${String(weekNum).padStart(2, "0")}`;
    }
    case "monthly":
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    case "quarterly":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "annual":
      return String(y);
    case "manual":
    default:
      return null;
  }
}

// ── Next run time for all 5 schedule types ────────────────────────────────────
export function computeNextRunAt(type: string, from = new Date()): Date {
  const d = new Date(from);
  // All scheduled reports fire at 08:00 IST = 02:30 UTC
  // Target 02:00 UTC (= ~7:30 AM IST); isDue() covers the full 02:xx hour.
  const setMorning = (dt: Date) => { dt.setUTCHours(2, 0, 0, 0); return dt; };
  switch (type) {
    case "daily": {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return setMorning(next);
    }
    case "weekly": {
      const daysUntilMonday = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMonday);
      return setMorning(d);
    }
    case "monthly": {
      d.setMonth(d.getMonth() + 1, 1);
      return setMorning(d);
    }
    case "quarterly": {
      const q = Math.floor(d.getMonth() / 3);
      d.setMonth((q + 1) * 3, 1);
      return setMorning(d);
    }
    case "annual": {
      d.setFullYear(d.getFullYear() + 1, 0, 1);
      return setMorning(d);
    }
    default:
      return new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
}

// ── AI prompts ────────────────────────────────────────────────────────────────
const REPORT_NARRATIVE_SYSTEM = `You are an executive business analyst writing a concise business report for the company owner.
Based on the provided financial and operational data, write a 200-300 word executive narrative in professional business language.
Cover: financial health, notable trends, key risks, and the single most important action the owner should take.
Write in third-person. Do NOT use bullet points — write flowing paragraphs.
Return ONLY the narrative text, no headers, no markdown.`;

const STRUCTURED_SECTIONS_SYSTEM = `You are a business intelligence analyst. Based on the provided company data, return ONLY valid JSON with this exact schema:
{
  "risks": [{"title": "...", "severity": "critical"|"high"|"medium"|"low"}],
  "opportunities": [{"title": "...", "impact": "high"|"medium"|"low"}],
  "recommendations": [{"title": "...", "description": "...", "priority": "critical"|"high"|"medium"|"low", "effort": "Low"|"Medium"|"High"}],
  "action_plan": [{"item": "...", "priority": "critical"|"high"|"medium"|"low"}]
}
Rules:
- risks: 3-5 items, specific and data-driven
- opportunities: 3-5 concrete growth opportunities
- recommendations: 3-5 actionable AI recommendations with priority and effort level
- action_plan: 5-7 concrete next actions the owner should take this period
Return ONLY valid JSON, no markdown fences.`;

// ── HTML report builder ───────────────────────────────────────────────────────
function reportLayout(headline: string, date: string, bodyHtml: string): string {
  const url = appUrl();
  const cta = url
    ? `<tr><td style="padding:16px 0 4px;">
         <a href="${esc(url)}/ai-reports" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View Full Report</a>
       </td></tr>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;background:#0b0b0f;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#15151c;border:1px solid #26262e;border-radius:16px;overflow:hidden;">
  <tr><td style="padding:24px 28px 18px;border-bottom:1px solid #24242e;">
    <div><span style="color:#a78bfa;font-size:20px;font-weight:700;letter-spacing:-0.02em;">TapasHub</span>
    <span style="color:#6b7280;font-size:12px;"> · AI Executive Report</span></div>
    <h1 style="margin:10px 0 4px;color:#f4f4f5;font-size:22px;">${esc(headline)}</h1>
    <div style="color:#6b7280;font-size:12px;">${esc(date)}</div>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:#cbd5e1;font-size:14px;line-height:1.6;">
      ${bodyHtml}
      ${cta}
    </table>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #24242e;color:#6b7280;font-size:11px;line-height:1.5;">
    AI-generated report. Not official financial advice. Manage report schedules in TapasHub AI Assistant.
  </td></tr>
</table>
</body></html>`;
}

function sectionHeader(title: string, emoji = ""): string {
  return `<tr><td style="padding:16px 0 8px;">
    <div style="color:#a78bfa;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #24242e;padding-bottom:6px;">${emoji ? esc(emoji) + " " : ""}${esc(title)}</div>
  </td></tr>`;
}

function kpiRow(items: { label: string; value: string; delta?: string; color?: string }[]): string {
  const cells = items.map(({ label, value, delta, color }) => `
    <td style="padding:12px;background:#1e1e2a;border-radius:8px;text-align:center;width:${Math.floor(100 / items.length)}%;">
      <div style="color:#6b7280;font-size:11px;margin-bottom:4px;">${esc(label)}</div>
      <div style="color:${color ?? "#f4f4f5"};font-size:18px;font-weight:700;">${esc(value)}</div>
      ${delta ? `<div style="color:${delta.startsWith("+") ? "#34d399" : "#f87171"};font-size:11px;margin-top:2px;">${esc(delta)}</div>` : ""}
    </td>`).join('<td style="width:8px;"></td>');
  return `<tr><td style="padding:0 0 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
  </td></tr>`;
}

function paragraph(text: string): string {
  return `<tr><td style="padding:0 0 16px;color:#cbd5e1;line-height:1.7;">${esc(text)}</td></tr>`;
}

function bulletList(items: string[], color = "#cbd5e1"): string {
  if (!items.length) return "";
  return `<tr><td style="padding:0 0 12px;">
    <ul style="margin:0;padding-left:18px;color:${color};">
      ${items.slice(0, 5).map(i => `<li style="margin-bottom:4px;">${esc(i)}</li>`).join("")}
    </ul>
  </td></tr>`;
}

// ── Generate structured content ────────────────────────────────────────────────
async function buildStructuredContent(
  contextText: string,
  swot: typeof aiAnalysesTable.$inferSelect | null,
  market: typeof aiMarketAnalysesTable.$inferSelect | null,
  provider: Awaited<ReturnType<typeof getActiveProvider>>,
): Promise<{ risks: ReportRisk[]; opportunities: ReportOpportunity[]; recommendations: ReportRecommendation[]; action_plan: ReportActionItem[] }> {
  const contextSnippet = [
    contextText.slice(0, 2000),
    swot ? `SWOT: Strengths: ${swot.strengths.slice(0,2).join("; ")}. Risks: ${swot.threats.slice(0,2).join("; ")}` : "",
    market?.recommendations.length ? `Top mkt rec: ${market.recommendations[0]?.title}` : "",
  ].filter(Boolean).join("\n");

  try {
    const raw = await provider.chat(
      [{ role: "user", content: `Analyse this business and produce the JSON report sections:\n\n${contextSnippet}` }],
      STRUCTURED_SECTIONS_SYSTEM,
    );
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const arr = <T>(v: unknown): T[] => Array.isArray(v) ? v.filter(Boolean) as T[] : [];

    return {
      risks:           arr<ReportRisk>(parsed.risks),
      opportunities:   arr<ReportOpportunity>(parsed.opportunities),
      recommendations: arr<ReportRecommendation>(parsed.recommendations),
      action_plan:     arr<ReportActionItem>(parsed.action_plan),
    };
  } catch {
    // Fallback: derive from cached SWOT if AI fails
    return {
      risks:           (swot?.threats ?? []).slice(0, 4).map(t => ({ title: t, severity: "medium" })),
      opportunities:   (swot?.opportunities ?? []).slice(0, 4).map(o => ({ title: o, impact: "medium" })),
      recommendations: (swot?.growthOpportunities ?? []).slice(0, 3).map(g => ({
        title: g, description: "Based on SWOT analysis", priority: "medium", effort: "Medium",
      })),
      action_plan:     (swot?.revenueleaks ?? []).slice(0, 3).map(r => ({ item: `Address: ${r}`, priority: "high" })),
    };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
export interface GenerateReportOptions {
  companyId:      number | null;
  type:           string;
  recipientEmails: string[];
  scheduleId?:    number;
}

export interface GeneratedReport {
  subject:     string;
  htmlContent: string;
  aiSummary:   string;
  contentJson: ReportContentJson;
  periodLabel: string | null;
}

export async function generateExecutiveReport(opts: GenerateReportOptions): Promise<GeneratedReport> {
  const { companyId, type } = opts;

  // ── 1. Resolve company name ────────────────────────────────────────────────
  let companyName: string;
  if (companyId != null) {
    const [co] = await db.select({ name: companiesTable.name })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    companyName = co?.name ?? `Company #${companyId}`;
  } else {
    companyName = "Group Portfolio";
  }

  const TYPE_LABELS: Record<string, string> = {
    daily: "Daily", weekly: "Weekly", monthly: "Monthly",
    quarterly: "Quarterly", annual: "Annual", manual: "Executive",
  };
  const typeLabel = TYPE_LABELS[type] ?? "Executive";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const periodLabel = computePeriodLabel(type, now);
  const subject = `${typeLabel} AI Report — ${companyName} — ${now.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;

  // ── 2. Fetch MTD financial snapshot ───────────────────────────────────────
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startStr = `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const endStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let mtdRevenue = 0, mtdExpenses = 0;
  if (companyId != null) {
    const [fin] = await db.select({
      income:   sql<number>`coalesce(sum(case when type='income'  then amount else 0 end),0)`,
      expenses: sql<number>`coalesce(sum(case when type='expense' then amount else 0 end),0)`,
    }).from(transactionsTable)
      .where(and(eq(transactionsTable.companyId, companyId), sql`date >= ${startStr}`, sql`date <= ${endStr}`));
    mtdRevenue   = Number(fin?.income   ?? 0);
    mtdExpenses  = Number(fin?.expenses ?? 0);
  }

  // ── 3. Fetch cached AI analyses ─────────────────────────────────────────────
  let swot: typeof aiAnalysesTable.$inferSelect | null = null;
  let valuation: typeof aiValuationsTable.$inferSelect | null = null;
  let predictions: typeof aiPredictionsTable.$inferSelect | null = null;
  let market: typeof aiMarketAnalysesTable.$inferSelect | null = null;

  if (companyId != null) {
    const [[s], [v], [p], [m]] = await Promise.all([
      db.select().from(aiAnalysesTable).where(eq(aiAnalysesTable.companyId, companyId)).orderBy(desc(aiAnalysesTable.createdAt)).limit(1),
      db.select().from(aiValuationsTable).where(eq(aiValuationsTable.companyId, companyId)).orderBy(desc(aiValuationsTable.createdAt)).limit(1),
      db.select().from(aiPredictionsTable).where(eq(aiPredictionsTable.companyId, companyId)).orderBy(desc(aiPredictionsTable.createdAt)).limit(1),
      db.select().from(aiMarketAnalysesTable).where(eq(aiMarketAnalysesTable.companyId, companyId)).orderBy(desc(aiMarketAnalysesTable.createdAt)).limit(1),
    ]);
    swot = s ?? null;
    valuation = v ?? null;
    predictions = p ?? null;
    market = m ?? null;
  }

  // ── 4. Build context + trend data ──────────────────────────────────────────
  let contextText = "";
  const trend = companyId != null ? await buildMonthlyFinanceTrend(companyId, 6) : [];

  if (companyId != null) {
    const ctx = await buildCompanyContext(companyId);
    if (ctx) contextText = formatContextForPrompt(ctx);
  } else {
    const pCtx = await buildPortfolioContext(undefined);
    if (pCtx) contextText = formatContextForPrompt(pCtx as unknown as Parameters<typeof formatContextForPrompt>[0]);
  }

  // ── 5. Get AI provider ─────────────────────────────────────────────────────
  const provider = await getActiveProvider();

  // ── 6. Generate AI narrative ───────────────────────────────────────────────
  const trendSnippet = trend.map(t =>
    `${t.month}: Rev ${inr(t.revenue)} | Exp ${inr(t.expenses)} | Profit ${inr(t.profit)}`
  ).join("; ");

  const narrativeInput = [
    companyId != null ? `Company: ${companyName}` : "Portfolio report",
    `Report type: ${typeLabel} | Period: ${dateStr}`,
    contextText ? `\nBusiness data:\n${contextText.slice(0, 2000)}` : "",
    trendSnippet ? `\n6-month trend: ${trendSnippet}` : "",
    valuation ? `\nAI Valuation: ${inr(valuation.estimatedValue)}, growth score ${valuation.growthScore}/100, trend: ${valuation.healthTrend}` : "",
    swot?.summary ? `\nSWOT summary: ${swot.summary}` : "",
  ].filter(Boolean).join("\n");

  let aiNarrative = "";
  try {
    aiNarrative = await provider.chat(
      [{ role: "user", content: narrativeInput }],
      REPORT_NARRATIVE_SYSTEM,
    );
    aiNarrative = aiNarrative.replace(/^#+\s*/gm, "").trim();
  } catch {
    aiNarrative = "AI narrative unavailable. Please run a manual analysis from the TapasHub dashboard.";
  }

  // ── 7. Generate structured sections ───────────────────────────────────────
  const structured = await buildStructuredContent(contextText, swot, market, provider);

  // ── 8. Build contentJson ───────────────────────────────────────────────────
  const mtdProfit = mtdRevenue - mtdExpenses;
  const prevMonth = trend.length >= 2 ? trend[trend.length - 2] : null;
  const revDelta = prevMonth && prevMonth.revenue > 0
    ? `${((mtdRevenue - prevMonth.revenue) / prevMonth.revenue * 100).toFixed(1)}%` : undefined;

  const kpis: ReportKpi[] = [];
  if (companyId != null) {
    kpis.push(
      { label: "MTD Revenue",  value: inr(mtdRevenue),  raw: mtdRevenue,  delta: revDelta ? (mtdRevenue >= (prevMonth?.revenue ?? 0) ? "+" : "") + revDelta : undefined, color: "green" },
      { label: "MTD Expenses", value: inr(mtdExpenses), raw: mtdExpenses, color: "red" },
      { label: "MTD Profit",   value: inr(mtdProfit),   raw: mtdProfit,   color: mtdProfit >= 0 ? "green" : "red" },
    );
  }
  if (valuation) {
    kpis.push({
      label: "AI Valuation", value: inr(valuation.estimatedValue),
      raw: valuation.estimatedValue ?? 0, color: "purple",
    });
  }

  const chartData: ReportChartPoint[] = trend.map(t => ({
    label:    t.month,
    revenue:  t.revenue,
    expenses: t.expenses,
    profit:   t.profit,
  }));

  const contentJson: ReportContentJson = {
    kpis,
    chart_data:      chartData,
    risks:           structured.risks,
    opportunities:   structured.opportunities,
    recommendations: structured.recommendations,
    action_plan:     structured.action_plan,
    ai_narrative:    aiNarrative,
  };

  // ── 9. Build HTML email ────────────────────────────────────────────────────
  let bodyHtml = "";

  if (kpis.length) {
    const htmlKpis = kpis.map(k => ({
      label: k.label, value: k.value, delta: k.delta,
      color: k.color === "green" ? "#34d399" : k.color === "red" ? "#f87171" : k.color === "purple" ? "#a78bfa" : "#f4f4f5",
    }));
    bodyHtml += sectionHeader("Key Performance Indicators", "📊");
    bodyHtml += kpiRow(htmlKpis.slice(0, 4));
  }

  if (valuation) {
    bodyHtml += sectionHeader("AI Business Valuation (Estimate)", "💎");
    bodyHtml += kpiRow([
      { label: "Est. Company Value", value: inr(valuation.estimatedValue), color: "#a78bfa" },
      { label: "Growth Score",       value: `${valuation.growthScore ?? "—"}/100`, color: "#f4f4f5" },
      { label: "Health Trend",       value: valuation.healthTrend ?? "—",
        color: valuation.healthTrend === "growing" ? "#34d399" : valuation.healthTrend === "declining" ? "#f87171" : "#fbbf24" },
    ]);
    if (valuation.explanation) bodyHtml += paragraph(valuation.explanation);
  }

  if (structured.risks.length) {
    bodyHtml += sectionHeader("Key Risks", "⚠️");
    bodyHtml += bulletList(structured.risks.map(r => `[${r.severity.toUpperCase()}] ${r.title}`), "#f87171");
  }

  if (structured.opportunities.length) {
    bodyHtml += sectionHeader("Growth Opportunities", "💡");
    bodyHtml += bulletList(structured.opportunities.map(o => `[${o.impact.toUpperCase()}] ${o.title}`), "#34d399");
  }

  if (structured.recommendations.length) {
    bodyHtml += sectionHeader("AI Recommendations", "🎯");
    bodyHtml += bulletList(structured.recommendations.map(r => `[${r.priority.toUpperCase()}] ${r.title} — ${r.description}`), "#cbd5e1");
  }

  bodyHtml += sectionHeader("Executive Analysis (AI)", "🤖");
  bodyHtml += paragraph(aiNarrative);

  bodyHtml += `<tr><td style="padding:12px;background:#1e1e2a;border-radius:8px;font-size:11px;color:#6b7280;line-height:1.5;">
    ⚠️ AI-generated content. Not official financial advice.
  </td></tr>`;

  const htmlContent = reportLayout(
    `${typeLabel} AI Report — ${companyName}`,
    dateStr,
    bodyHtml,
  );

  void (await getActiveProviderName());

  return { subject, htmlContent, aiSummary: aiNarrative, contentJson, periodLabel };
}

// ── Store a report record ─────────────────────────────────────────────────────
export async function storeReport(opts: {
  companyId:      number | null;
  scheduleId?:    number;
  type:           string;
  periodLabel?:   string | null;
  status:         string;
  subject:        string;
  htmlContent?:   string;
  aiSummary?:     string;
  contentJson?:   ReportContentJson;
  recipientCount?: number;
  errorMessage?:  string;
  sentAt?:        Date;
}): Promise<number> {
  const [row] = await db.insert(aiReportHistoryTable).values({
    companyId:      opts.companyId,
    scheduleId:     opts.scheduleId,
    type:           opts.type,
    periodLabel:    opts.periodLabel ?? null,
    status:         opts.status,
    subject:        opts.subject,
    htmlContent:    opts.htmlContent,
    aiSummary:      opts.aiSummary,
    contentJson:    opts.contentJson as Record<string, unknown> | undefined,
    recipientCount: opts.recipientCount ?? 0,
    errorMessage:   opts.errorMessage,
    sentAt:         opts.sentAt,
  }).returning({ id: aiReportHistoryTable.id });
  return row.id;
}

// ── History retention cleanup ─────────────────────────────────────────────────
// Retention limits per type: daily=30, weekly=12, monthly=12, quarterly=8, annual=5
const RETENTION: Record<string, number> = {
  daily: 30, weekly: 12, monthly: 12, quarterly: 8, annual: 5,
};

export async function pruneReportHistory(companyId: number | null): Promise<void> {
  for (const [type, keep] of Object.entries(RETENTION)) {
    try {
      // Find the cutoff id (the keep-th most recent for this company+type)
      const rows = await db.select({ id: aiReportHistoryTable.id })
        .from(aiReportHistoryTable)
        .where(
          companyId != null
            ? and(eq(aiReportHistoryTable.companyId, companyId), eq(aiReportHistoryTable.type, type))
            : eq(aiReportHistoryTable.type, type)
        )
        .orderBy(desc(aiReportHistoryTable.createdAt));

      const toDelete = rows.slice(keep).map(r => r.id);
      if (toDelete.length > 0) {
        await db.delete(aiReportHistoryTable)
          .where(sql`id = ANY(${sql.raw(`ARRAY[${toDelete.join(",")}]`)})`);
      }
    } catch {
      // Non-fatal — pruning failures don't block report generation
    }
  }
}
