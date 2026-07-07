---
name: Sandbox DB seeding
description: How to seed the Postgres DB from the CodeExecution sandbox
---

# Seeding the database from CodeExecution

The CodeExecution sandbox **cannot** `import("pg")` — it resolves from the workspace root
where `pg` is not hoisted, so you get `ERR_MODULE_NOT_FOUND`. A `"use impure"` Pool block fails too.

**How to apply:** Use the pre-registered `executeSql({ sqlQuery })` callback instead. Build large
multi-row `INSERT ... VALUES (...),(...)` strings in plain JS (loops over data), then pass one
INSERT per table to `executeSql`. This is the reliable path for bulk seeding.
