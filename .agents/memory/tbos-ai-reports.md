---
name: TBOS AI executive reports
description: Scheduler startup ordering, tenant isolation, and email hardening decisions for the AI executive reports feature
---

# TBOS AI Executive Reports

## Scheduler startup ordering

**Rule:** `startReportScheduler()` must delay its first tick by at least 5 seconds (or wait for migrations to complete) before querying the DB.

**Why:** The scheduler is started synchronously in `index.ts` before `applyMigrations()` resolves. If the first tick fires immediately, it queries `ai_report_schedules` before `CREATE TABLE IF NOT EXISTS` has run, producing a Drizzle `_DrizzleQueryError: relation does not exist`. The integration scheduler has the same theoretical race but was never hit because its tables already existed; the report tables were new.

**How to apply:** Use `setTimeout(() => { void tick(); }, 5_000)` for the first run; subsequent runs use `setInterval`. Any new scheduler that queries tables created in startup migrations must follow the same pattern.

## Portfolio-level records are super-admin only

**Rule:** Report history / schedule rows with `companyId = null` (portfolio-wide) must only be visible to super-admin callers. Scoped users (with a limited `companyScope`) must not read them — even `GET /reports/history` should exclude `companyId null` rows for non-super-admins.

**Why:** The code-review caught that a naive `scope.includes(r.companyId)` would pass `null` through for scoped users because `[].includes(null)` is false but the filter was: `companyId == null || scope.includes(companyId)`, which let portfolio records through. The fix: `companyId != null && scope.includes(companyId)` for scoped users.

**How to apply:** Every list endpoint that can return rows with a nullable `companyId` must use this pattern: `scope === null ? rows : rows.filter(r => r.companyId != null && scope.includes(r.companyId))`.

## CR/LF injection in email subject

**Rule:** Strip `\r` and `\n` from the `subject` field inside the shared `send()` function, not at each call site.

**Why:** Individual callers (invite, shareholder, report) each have their own subject composition; centralising the strip in `send()` guarantees coverage for future email types too. The shareholder invite email already did this at the call site, but the report email didn't.

**How to apply:** `subject = subject.replace(/[\r\n]+/g, " ").trim()` at the top of `send()` in `email.ts`.

## Background report generation error visibility

**Rule:** Background async report generation (the `void (async () => {...})()` block inside `POST /reports/generate`) must log errors explicitly with `req.log.error` before updating the DB row to `failed`.

**Why:** Without explicit logging, the catch block is a silent black hole — the DB row eventually shows `status: failed` but there's no server-side trace to diagnose the cause. The scheduler already uses `log.error` per-schedule; the on-demand route should match.
