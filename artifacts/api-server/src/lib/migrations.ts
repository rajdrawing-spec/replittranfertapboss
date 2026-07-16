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
    // Two separate partial unique indexes replace the previous COALESCE expression index.
    // The COALESCE approach caused operator-class mismatches when Replit's deployment
    // validator introspected the dev DB and regenerated the DDL (text_ops on integer column).
    // Split into: one for company-scoped rows (company_id IS NOT NULL), one for portfolio rows.
    await db.execute(sql`DROP INDEX IF EXISTS ai_report_history_dedup`);
    await db.execute(sql`DROP INDEX IF EXISTS ai_report_history_dedup_company`);
    await db.execute(sql`DROP INDEX IF EXISTS ai_report_history_dedup_portfolio`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_report_history_dedup_company
        ON ai_report_history (company_id, type, period_label)
        WHERE period_label IS NOT NULL AND company_id IS NOT NULL
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ai_report_history_dedup_portfolio
        ON ai_report_history (type, period_label)
        WHERE period_label IS NOT NULL AND company_id IS NULL
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

    // ── Chat & Connect tables (catch-up for Supabase prod DB) ─────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_channels (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER   NOT NULL,
        type        TEXT      NOT NULL DEFAULT 'team',
        name        TEXT      NOT NULL,
        department  TEXT,
        created_by  INTEGER,
        is_active   BOOLEAN   NOT NULL DEFAULT true,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'team'`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS department TEXT`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS created_by INTEGER`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`);
    await db.execute(sql`ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_channels_company_id_idx ON chat_channels(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_channels_type_idx ON chat_channels(type)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_channel_members (
        id            SERIAL PRIMARY KEY,
        channel_id    INTEGER   NOT NULL,
        user_id       INTEGER   NOT NULL,
        last_read_at  TIMESTAMP,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE chat_channel_members ADD COLUMN IF NOT EXISTS channel_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_channel_members ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_channel_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_channel_members_channel_user_idx ON chat_channel_members(channel_id, user_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id              SERIAL PRIMARY KEY,
        channel_id      INTEGER   NOT NULL,
        user_id         INTEGER   NOT NULL,
        display_name    TEXT      NOT NULL,
        content         TEXT      NOT NULL,
        reply_to_id     INTEGER,
        attachments     JSONB     NOT NULL DEFAULT '[]',
        reactions       JSONB     NOT NULL DEFAULT '{}',
        mentions        JSONB     NOT NULL DEFAULT '[]',
        is_announcement BOOLEAN   NOT NULL DEFAULT false,
        is_pinned       BOOLEAN   NOT NULL DEFAULT false,
        edited_at       TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS channel_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_messages_channel_id_idx ON chat_messages(channel_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_message_reads (
        id          SERIAL PRIMARY KEY,
        message_id  INTEGER   NOT NULL,
        user_id     INTEGER   NOT NULL,
        read_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE chat_message_reads ADD COLUMN IF NOT EXISTS message_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_message_reads ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE chat_message_reads ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NOT NULL DEFAULT NOW()`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_message_reads_message_user_idx ON chat_message_reads(message_id, user_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS chat_polls (
        id            SERIAL PRIMARY KEY,
        channel_id    INTEGER   NOT NULL,
        user_id       INTEGER   NOT NULL,
        question      TEXT      NOT NULL,
        options       JSONB     NOT NULL DEFAULT '[]',
        votes         JSONB     DEFAULT '{}',
        is_multiple   BOOLEAN   NOT NULL DEFAULT false,
        closed        BOOLEAN   NOT NULL DEFAULT false,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_polls_channel_id_idx ON chat_polls(channel_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_status (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER   NOT NULL UNIQUE,
        presence        TEXT      NOT NULL DEFAULT 'offline',
        status_message  TEXT,
        do_not_disturb  BOOLEAN   NOT NULL DEFAULT false,
        dnd_until       TIMESTAMP,
        last_seen_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS user_status_user_id_idx ON user_status(user_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_settings (
        id                    SERIAL PRIMARY KEY,
        company_id            INTEGER   NOT NULL UNIQUE,
        default_provider      TEXT      NOT NULL DEFAULT 'jitsi',
        jitsi_server_url      TEXT      NOT NULL DEFAULT 'https://meet.jit.si',
        default_duration      INTEGER   NOT NULL DEFAULT 30,
        waiting_room_enabled  BOOLEAN   NOT NULL DEFAULT false,
        password_required     BOOLEAN   NOT NULL DEFAULT false,
        max_participants      INTEGER   NOT NULL DEFAULT 50,
        screen_share_enabled  BOOLEAN   NOT NULL DEFAULT true,
        recording_enabled     BOOLEAN   NOT NULL DEFAULT false,
        lobby_enabled         BOOLEAN   NOT NULL DEFAULT false,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meeting_settings_company_id_idx ON meeting_settings(company_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meetings (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER   NOT NULL,
        channel_id      INTEGER,
        task_id         INTEGER,
        title           TEXT      NOT NULL,
        agenda          TEXT,
        meeting_id      TEXT      NOT NULL UNIQUE,
        provider        TEXT      NOT NULL DEFAULT 'jitsi',
        room_url        TEXT      NOT NULL,
        password        TEXT,
        scheduled_at    TIMESTAMP,
        duration        INTEGER   NOT NULL DEFAULT 30,
        organizer_id    INTEGER   NOT NULL,
        status          TEXT      NOT NULL DEFAULT 'scheduled',
        is_recurring    BOOLEAN   NOT NULL DEFAULT false,
        recurrence      TEXT,
        waiting_room    BOOLEAN   NOT NULL DEFAULT false,
        max_participants  INTEGER NOT NULL DEFAULT 50,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS company_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS channel_id INTEGER`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS task_id INTEGER`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS agenda TEXT`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_id TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'jitsi'`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS room_url TEXT NOT NULL DEFAULT ''`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS password TEXT`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 30`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS organizer_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled'`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recurrence TEXT`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS waiting_room BOOLEAN NOT NULL DEFAULT false`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS max_participants INTEGER NOT NULL DEFAULT 50`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS jwt TEXT`);
    await db.execute(sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meetings_company_id_idx ON meetings(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meetings_status_idx ON meetings(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meetings_scheduled_at_idx ON meetings(scheduled_at)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_participants (
        id          SERIAL PRIMARY KEY,
        meeting_id  INTEGER   NOT NULL,
        user_id     INTEGER   NOT NULL,
        status      TEXT      NOT NULL DEFAULT 'invited',
        joined_at   TIMESTAMP,
        left_at     TIMESTAMP,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS meeting_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL`);
    await db.execute(sql`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited'`);
    await db.execute(sql`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS left_at TIMESTAMP`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meeting_participants_meeting_user_idx ON meeting_participants(meeting_id, user_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_templates (
        id                       SERIAL PRIMARY KEY,
        company_id               INTEGER   NOT NULL,
        name                     TEXT      NOT NULL,
        title                    TEXT      NOT NULL,
        agenda                   TEXT,
        duration                 INTEGER   NOT NULL DEFAULT 30,
        waiting_room             BOOLEAN   NOT NULL DEFAULT false,
        password_required        BOOLEAN   NOT NULL DEFAULT false,
        is_recurring             BOOLEAN   NOT NULL DEFAULT false,
        recurrence               TEXT,
        default_participant_ids  JSONB     DEFAULT '[]',
        created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meeting_templates_company_id_idx ON meeting_templates(company_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS meeting_notes (
        id          SERIAL PRIMARY KEY,
        meeting_id  INTEGER   NOT NULL,
        user_id     INTEGER   NOT NULL,
        content     TEXT      NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS meeting_notes_meeting_id_idx ON meeting_notes(meeting_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS planner_events (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER   NOT NULL,
        user_id     INTEGER   NOT NULL,
        type        TEXT      NOT NULL,
        title       TEXT      NOT NULL,
        start_date  DATE      NOT NULL,
        end_date    DATE,
        all_day     BOOLEAN   NOT NULL DEFAULT false,
        metadata    JSONB     DEFAULT '{}',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS planner_events_user_id_idx ON planner_events(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS planner_events_company_id_idx ON planner_events(company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS planner_events_start_date_idx ON planner_events(start_date)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workload_snapshots (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER   NOT NULL,
        snapshot_date   DATE      NOT NULL,
        data            JSONB     NOT NULL,
        ai_provider     TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS workload_snapshots_company_date_idx ON workload_snapshots(company_id, snapshot_date)`);

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
