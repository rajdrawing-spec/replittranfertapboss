---
name: TBOS prod schema catch-up
description: Supabase prod DB drifts from dev schema; startup migrations auto-heal, plus lessons on legacy columns, ON CONFLICT, and DO $$ blocks
---

Supabase prod DB can lag behind dev schema. `api-server/src/lib/migrations.ts` runs idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` at every startup so restarts auto-heal missing tables/columns.

**Why:** drizzle-kit push can't target prod safely (non-TTY prompts), and deploys have hit missing chat/connect/meeting tables in prod.

Additional lessons (July 2026):
- Prod can also have **legacy extra columns** dev never had (e.g. a NOT NULL `company_id` on chat_messages from a pre-channels schema). ADD COLUMN IF NOT EXISTS can't fix these — inserts fail with NOT NULL violations. Detect via information_schema (constrain to `table_schema='public'`) and `ALTER COLUMN ... DROP NOT NULL`.
- `DO $$ ... $$` blocks get mangled by the drizzle `sql` template (`$$` → `$`, syntax error). Do the existence check in JS instead of PL/pgSQL.
- Any `ON CONFLICT (a,b)` in code requires a UNIQUE index in prod, not just a regular index; dedupe rows first, then `CREATE UNIQUE INDEX IF NOT EXISTS`. Drop the now-redundant regular index in the same migration to avoid duplicate indexes.
- SUPABASE_DB_URL has an unescaped `@` in the password, so psql/URL parsers choke; split creds at the last `@` manually and connect with node `pg` (found under node_modules/.pnpm).
