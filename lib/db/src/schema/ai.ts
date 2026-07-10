import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

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
  provider:     text("provider").notNull(),        // which AI provider generated it
  // Structured analysis fields (stored as JSON arrays of strings)
  strengths:         jsonb("strengths").$type<string[]>().notNull().default([]),
  weaknesses:        jsonb("weaknesses").$type<string[]>().notNull().default([]),
  opportunities:     jsonb("opportunities").$type<string[]>().notNull().default([]),
  threats:           jsonb("threats").$type<string[]>().notNull().default([]),
  revenueleaks:      jsonb("revenue_leaks").$type<string[]>().notNull().default([]),
  costOpportunities: jsonb("cost_opportunities").$type<string[]>().notNull().default([]),
  cashRisks:         jsonb("cash_risks").$type<string[]>().notNull().default([]),
  growthOpportunities: jsonb("growth_opportunities").$type<string[]>().notNull().default([]),
  // Summary narrative
  summary:      text("summary"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type AiConfig   = typeof aiConfigTable.$inferSelect;
export type AiAnalysis = typeof aiAnalysesTable.$inferSelect;
