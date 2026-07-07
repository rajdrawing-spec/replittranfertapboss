---
name: TBOS integrations framework
description: How the platform-integrations framework stores credentials and stays honest about sync state.
---

# Platform integrations framework

## Credentials are env-var references, never DB values
A running app on Replit **cannot create Replit Secrets at runtime** (that is an
agent-time flow). So the framework never accepts a raw API key over HTTP and
never stores plaintext credentials in the DB.

Instead each `integration_connections` row stores `secret_refs`: the *names* of
env vars, namespaced per company as `INTEGRATION_<PLATFORM_KEY>_<COMPANY_ID>_<SECRET_KEY>`
(all upper-case; see `secretEnvName()` in `integration-catalog.ts`). Values are
read from `process.env` at runtime.

**Why:** satisfies "secrets via Replit Secrets, never plaintext in DB" while
staying multi-tenant (two companies connecting the same platform get distinct
secret names, not a shared global key).

**How to apply:** connect() marks a connection `connected` only when *all*
required env vars exist AND the adapter's `testConnection` passes; otherwise
`pending`/`error` with a message listing the exact secret names to add. To wire a
real provider, add its Replit secrets under those names, then register a real
adapter in `integration-adapters.ts`.

## Stub adapters must stay honest (no fabricated data)
Unregistered providers fall back to a stub adapter whose `sync()` returns
`status: "skipped"` with recordsSynced 0 — it never invents synced records.
**Why:** aligns with the project's "real data only" principle; sync history and
dashboards must never show fake numbers. Keep this contract when adding adapters.

## Catalog drives the UI generically
The 17-platform catalog lives in `integration-catalog.ts` and is served via
`GET /api/integrations/catalog`. The frontend renders cards purely from it —
adding a platform there surfaces a working card with no UI changes.
