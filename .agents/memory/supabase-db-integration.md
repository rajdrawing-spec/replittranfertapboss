---
name: Supabase DB integration
description: TAPBOSS uses SUPABASE_DB_URL as the primary persistent database; DATABASE_URL is Replit's managed dev DB (fallback in dev only).
---

## Rule
`SUPABASE_DB_URL` is the primary production database (Supabase Postgres).
`DATABASE_URL` (Replit managed) is only the dev fallback — never used in production.

## Why
Replit's publish-time "overwrite with dev data" option only touches the managed `DATABASE_URL` database, not an external SUPABASE_DB_URL. This prevents production data loss on redeploy.

## How to apply
- `lib/db/src/index.ts` and `lib/db/drizzle.config.ts` both: prefer SUPABASE_DB_URL, fall back to DATABASE_URL only when NODE_ENV !== "production".
- Production deploys MUST have SUPABASE_DB_URL in deployment secrets.
- `executeSql({ environment: "production" })` in CodeExecution still queries Replit's managed prod DB replica — it does NOT query Supabase. Use the app's own API or a direct pg connection for Supabase queries.
- Pool config for Supabase: `ssl: { rejectUnauthorized: false }`, `max: 5` (free tier ~60 connection limit).
- `drizzle-kit push` automatically targets Supabase when SUPABASE_DB_URL is set.
- Schema was pushed to Supabase via `drizzle-kit push --force` and boot seed seeded 8 companies + 12 roles.
