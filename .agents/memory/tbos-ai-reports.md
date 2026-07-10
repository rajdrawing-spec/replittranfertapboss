---
name: TBOS AI executive reports
description: Scheduler design decisions, dedup strategy, and history scoping rules for AI executive reports.
---

## Catch-up scheduler pattern (not time-window)

**Rule:** Use catch-up logic keyed by period labels, not a time-window (`isDue()`). Every tick checks recent period slots and generates any missing or failed ones.

**Why:** A time-window approach permanently misses periods when the server is down at the trigger hour. The catch-up pattern fills gaps automatically on resume.

**How to apply:**
- `periodSlotsToCheck(type, now)` returns `{ label, asOfDate }` pairs for the current period plus lookback: daily→7, weekly→4, monthly→3, quarterly→2, annual→1.
- Pass `asOfDate` into `generateExecutiveReport` so the period label, financial data window, and trend calculations all reflect the correct historical date.
- Only skip generation if an existing row has `status = "ready"` or `"sent"`. A `"failed"` row must be **updated in-place** (not re-inserted) to avoid hitting the dedup unique index.

## Dedup indexes (split, not expression)

The original single `COALESCE(company_id, -1)` expression index caused Replit's deployment validator to scramble operator classes. Replaced with two plain partial unique indexes:
- `ai_report_history_dedup_company` — `(company_id, type, period_label) WHERE period_label IS NOT NULL AND company_id IS NOT NULL`
- `ai_report_history_dedup_portfolio` — `(type, period_label) WHERE period_label IS NOT NULL AND company_id IS NULL`

The scheduler's dedup catch still works because both index names contain the substring `"ai_report_history_dedup"`.

## History endpoint scoping

**Rule:** Apply company-scope WHERE predicates in SQL **before** `LIMIT 50`. Filtering in application code after the LIMIT causes scoped users to get empty or sparse results when recent rows are dominated by other companies.

**How:** Build `whereClauses` with `isNotNull + inArray(companyId, scope)` for non-super-admin callers, then pass to `.where(and(...whereClauses))` before `.limit(50)`.

## Permissions

- `ai.reports` permission gates all report history endpoints.
- Portfolio reports (`companyId IS NULL`) are super-admin only.
- `canAccessCompany` must be checked on every route that accepts a `companyId` param.
