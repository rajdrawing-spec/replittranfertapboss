import { pgTable, serial, integer, text, timestamp, jsonb, real } from "drizzle-orm/pg-core";

// ── ai_config: stores the active AI provider selection + encrypted API keys ──
export const aiConfigTable = pgTable("ai_config", {
  id:           serial("id").primaryKey(),
  key:          text("key").notNull().unique(),   // e.g. "active_provider", "groq_key"
  value:        text("value"),                    // plaintext for non-sensitive; AES-256-GCM hex for credential keys
  iv:           text("iv"),                       // AES-GCM IV (hex) — set only for encrypted credential keys
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

// ── ai_analyses: cached SWOT + insights results per company ──────────────────
export const aiAnalysesTable = pgTable("ai_analyses", {
  id:           serial("id").primaryKey(),
  companyId:    integer("company_id").notNull(),
  provider:     text("provider").notNull(),
  strengths:         jsonb("strengths").$type<string[]>().notNull().default([]),
  weaknesses:        jsonb("weaknesses").$type<string[]>().notNull().default([]),
  opportunities:     jsonb("opportunities").$type<string[]>().notNull().default([]),
  threats:           jsonb("threats").$type<string[]>().notNull().default([]),
  revenueleaks:      jsonb("revenue_leaks").$type<string[]>().notNull().default([]),
  costOpportunities: jsonb("cost_opportunities").$type<string[]>().notNull().default([]),
  cashRisks:         jsonb("cash_risks").$type<string[]>().notNull().default([]),
  growthOpportunities: jsonb("growth_opportunities").$type<string[]>().notNull().default([]),
  summary:      text("summary"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ── Shared sub-types ──────────────────────────────────────────────────────────

export type PredictionItem = {
  metric: string;          // revenue | profit | cash_flow | valuation | headcount
  horizon: number;         // 3 | 6 | 12 (months)
  value: number;
  confidenceScore: number; // 0-100
  riskLevel: string;       // low | medium | high
  supportingFactors: string[];
  recommendedActions: string[];
};

export type CompetitorItem = {
  name: string;
  strength: string;
  weakness: string;
  marketPosition: string;
};

export type MarketRecommendation = {
  type: string;        // launch | enter | discontinue | pricing | operational
  title: string;
  description: string;
  priority: string;    // critical | high | medium | low
};

// ── ai_valuations: cached AI-estimated company valuation per company ──────────
export const aiValuationsTable = pgTable("ai_valuations", {
  id:                  serial("id").primaryKey(),
  companyId:           integer("company_id").notNull(),
  provider:            text("provider").notNull(),
  // Weighted-average final estimate
  estimatedValue:      real("estimated_value"),
  enterpriseValue:     real("enterprise_value"),
  shareholderEquity:   real("shareholder_equity"),
  nav:                 real("nav"),
  growthScore:         integer("growth_score"),       // 0-100
  healthTrend:         text("health_trend"),          // growing | stable | declining
  revenueGrowthRate:   real("revenue_growth_rate"),   // %
  profitGrowthRate:    real("profit_growth_rate"),    // %
  explanation:         text("explanation"),
  // Investor Readiness Score (0-100)
  investorScore:       integer("investor_score"),
  investorRating:      text("investor_rating"),       // excellent | strong | moderate | needs_improvement
  // Per-method valuations (INR)
  assetValuation:           real("asset_valuation"),
  revenueMultipleVal:       real("revenue_multiple_val"),
  ebitdaValuation:          real("ebitda_valuation"),
  dcfValuation:             real("dcf_valuation"),
  scorecardValuation:       real("scorecard_valuation"),
  vcValuation:              real("vc_valuation"),
  // Share price breakdown
  bookValuePerShare:        real("book_value_per_share"),
  estimatedSharePrice:      real("estimated_share_price"),
  // Actionable recommendations
  recommendations:     jsonb("recommendations").$type<string[]>().default([]),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
});

// ── ai_predictions: 3/6/12-month metric forecasts ────────────────────────────
export const aiPredictionsTable = pgTable("ai_predictions", {
  id:          serial("id").primaryKey(),
  companyId:   integer("company_id").notNull(),
  provider:    text("provider").notNull(),
  predictions: jsonb("predictions").$type<PredictionItem[]>().notNull().default([]),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// ── ai_market_analyses: market demand + competitor intelligence ───────────────
export const aiMarketAnalysesTable = pgTable("ai_market_analyses", {
  id:                 serial("id").primaryKey(),
  companyId:          integer("company_id").notNull(),
  provider:           text("provider").notNull(),
  industryDemand:     text("industry_demand"),
  competitorAnalysis: jsonb("competitor_analysis").$type<CompetitorItem[]>().notNull().default([]),
  recommendations:    jsonb("recommendations").$type<MarketRecommendation[]>().notNull().default([]),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
});

export type AiConfig        = typeof aiConfigTable.$inferSelect;
export type AiAnalysis      = typeof aiAnalysesTable.$inferSelect;
export type AiValuation     = typeof aiValuationsTable.$inferSelect;
export type AiPredictions   = typeof aiPredictionsTable.$inferSelect;
export type AiMarketAnalysis = typeof aiMarketAnalysesTable.$inferSelect;
