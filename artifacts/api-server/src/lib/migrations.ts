/**
 * Idempotent schema migrations that run at every server startup.
 *
 * Rules:
 *  - Every statement must be safe to run multiple times (IF NOT EXISTS, etc.)
 *  - Never DROP or rename columns/tables here — use explicit Supabase migrations.
 *  - Keep data-fixes lightweight and scoped.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function applyMigrations(): Promise<void> {
  try {
    // ── Treasury entries ──────────────────────────────────────────────────────
    // This table was added after the initial deployment, so it may be missing
    // in the Supabase DB. CREATE TABLE IF NOT EXISTS is fully idempotent.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS treasury_entries (
        id              SERIAL PRIMARY KEY,
        funding_source  TEXT        NOT NULL,
        investor_name   TEXT,
        amount          REAL        NOT NULL,
        date            TEXT        NOT NULL,
        currency        TEXT        NOT NULL DEFAULT 'INR',
        payment_method  TEXT,
        reference_number TEXT,
        description     TEXT        NOT NULL,
        notes           TEXT,
        status          TEXT        NOT NULL DEFAULT 'approved',
        is_reversed     BOOLEAN     NOT NULL DEFAULT FALSE,
        reversed_at     TIMESTAMP,
        reversed_by_name TEXT,
        reversal_reason TEXT,
        created_by_id   INTEGER,
        created_by_name TEXT        NOT NULL DEFAULT 'system',
        approved_by_name TEXT,
        approved_at     TIMESTAMP,
        created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS treasury_entries_status_idx ON treasury_entries(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS treasury_entries_date_idx ON treasury_entries(date)
    `);

    // ── AI config & analyses ──────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_config (
        id          SERIAL PRIMARY KEY,
        key         TEXT        NOT NULL UNIQUE,
        value       TEXT,
        iv          TEXT,
        updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_analyses (
        id                    SERIAL PRIMARY KEY,
        company_id            INTEGER   NOT NULL,
        provider              TEXT      NOT NULL,
        strengths             JSONB     NOT NULL DEFAULT '[]',
        weaknesses            JSONB     NOT NULL DEFAULT '[]',
        opportunities         JSONB     NOT NULL DEFAULT '[]',
        threats               JSONB     NOT NULL DEFAULT '[]',
        revenue_leaks         JSONB     NOT NULL DEFAULT '[]',
        cost_opportunities    JSONB     NOT NULL DEFAULT '[]',
        cash_risks            JSONB     NOT NULL DEFAULT '[]',
        growth_opportunities  JSONB     NOT NULL DEFAULT '[]',
        summary               TEXT,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── Gemini conversation tables ────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id            SERIAL PRIMARY KEY,
        title         TEXT      NOT NULL,
        owner_user_id INTEGER,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id               SERIAL PRIMARY KEY,
        conversation_id  INTEGER   NOT NULL,
        role             TEXT      NOT NULL,
        content          TEXT      NOT NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── AI report schedules and history ──────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_report_schedules (
        id                SERIAL PRIMARY KEY,
        company_id        INTEGER,
        type              TEXT      NOT NULL,
        enabled           BOOLEAN   NOT NULL DEFAULT true,
        recipient_emails  JSONB     NOT NULL DEFAULT '[]',
        last_run_at       TIMESTAMP,
        next_run_at       TIMESTAMP,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_report_history (
        id               SERIAL PRIMARY KEY,
        schedule_id      INTEGER,
        company_id       INTEGER,
        type             TEXT      NOT NULL,
        period_label     TEXT,
        status           TEXT      NOT NULL,
        subject          TEXT      NOT NULL,
        html_content     TEXT,
        ai_summary       TEXT,
        content_json     JSONB,
        recipient_count  INTEGER   DEFAULT 0,
        error_message    TEXT,
        sent_at          TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Idempotently add columns and index added after initial migration
    await db.execute(sql`ALTER TABLE ai_report_history ADD COLUMN IF NOT EXISTS period_label TEXT`);
    await db.execute(sql`ALTER TABLE ai_report_history ADD COLUMN IF NOT EXISTS content_json JSONB`);
    // Use COALESCE so NULL company_id rows (portfolio) also deduplicate correctly
    // (PostgreSQL unique indexes treat NULL != NULL, so raw company_id won't dedup NULLs)
    await db.execute(sql`DROP INDEX IF EXISTS ai_report_history_dedup`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_report_history_dedup
        ON ai_report_history (COALESCE(company_id, -1), type, period_label)
        WHERE period_label IS NOT NULL
    `);

    // ── AI valuation, predictions, market analyses ────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_valuations (
        id                    SERIAL PRIMARY KEY,
        company_id            INTEGER   NOT NULL,
        provider              TEXT      NOT NULL,
        estimated_value       REAL,
        enterprise_value      REAL,
        shareholder_equity    REAL,
        nav                   REAL,
        growth_score          INTEGER,
        health_trend          TEXT,
        revenue_growth_rate   REAL,
        profit_growth_rate    REAL,
        explanation           TEXT,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_predictions (
        id           SERIAL PRIMARY KEY,
        company_id   INTEGER   NOT NULL,
        provider     TEXT      NOT NULL,
        predictions  JSONB     NOT NULL DEFAULT '[]',
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_market_analyses (
        id                    SERIAL PRIMARY KEY,
        company_id            INTEGER   NOT NULL,
        provider              TEXT      NOT NULL,
        industry_demand       TEXT,
        competitor_analysis   JSONB     NOT NULL DEFAULT '[]',
        recommendations       JSONB     NOT NULL DEFAULT '[]',
        created_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── Additive column patches (idempotent via IF NOT EXISTS) ────────────────
    // Add iv column to ai_config if missing (added to support encrypted API keys)
    await db.execute(sql`
      ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS iv TEXT
    `);

    // Add owner_user_id to conversations if missing
    await db.execute(sql`
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_user_id INTEGER
    `);

    logger.info("Startup migrations applied (schema)");
  } catch (e) {
    // Log but never crash the server — missing tables are better discovered
    // through the relevant API routes than a hard boot failure.
    logger.error({ err: e }, "Startup migration error (non-fatal)");
  }
}

/**
 * Repair fund_allocations rows where from_company_id or to_company_id no longer
 * exists in the companies table (stale ID after company recreation).
 *
 * Must be called AFTER ensureStarterCompanies() so companies exist on first boot.
 * Safe to run multiple times — only touches genuinely orphaned rows.
 */
export async function repairOrphanedAllocations(): Promise<void> {
  try {
    const fromResult = await db.execute(sql`
      UPDATE fund_allocations fa
      SET    from_company_id = (
               SELECT id FROM companies WHERE type = 'parent' LIMIT 1
             )
      WHERE  NOT EXISTS (
               SELECT 1 FROM companies WHERE id = fa.from_company_id
             )
        AND  EXISTS (
               SELECT 1 FROM companies WHERE type = 'parent'
             )
    `);
    const toResult = await db.execute(sql`
      UPDATE fund_allocations fa
      SET    to_company_id = (
               SELECT id FROM companies WHERE type = 'subsidiary' LIMIT 1
             )
      WHERE  NOT EXISTS (
               SELECT 1 FROM companies WHERE id = fa.to_company_id
             )
        AND  EXISTS (
               SELECT 1 FROM companies WHERE type = 'subsidiary'
             )
    `);
    const fixed = (fromResult.rowCount ?? 0) + (toResult.rowCount ?? 0);
    if (fixed > 0) {
      logger.info({ fixed }, "Repaired orphaned fund-allocation company IDs");
    }
  } catch (e) {
    logger.error({ err: e }, "Orphan allocation repair failed (non-fatal)");
  }
}
