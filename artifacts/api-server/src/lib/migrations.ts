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
