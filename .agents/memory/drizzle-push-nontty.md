---
name: drizzle-kit push in non-TTY
description: Why `drizzle-kit push --force` can still fail here, and how to apply destructive schema changes.
---

# drizzle-kit push needs a TTY for conflicts

`pnpm --filter @workspace/db push-force` (i.e. `drizzle-kit push --force`) still
throws `Interactive prompts require a TTY terminal` when the diff includes an
**ambiguous column conflict** — e.g. dropping a column while adding another
looks like a possible rename, triggering `promptColumnsConflicts`. `--force`
only auto-confirms data-loss, not the rename-vs-drop disambiguation.

**How to apply:** for destructive/ambiguous schema changes (dropped columns,
renames), apply the DDL directly via the `executeSql` CodeExecution callback
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP COLUMN IF EXISTS`,
`CREATE TABLE IF NOT EXISTS`, add UNIQUE via a guarded `DO $$` block).
executeSql accepts a multi-statement script. Plain additive pushes are fine.
