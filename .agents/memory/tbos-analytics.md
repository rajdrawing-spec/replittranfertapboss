---
name: TBOS analytics module
description: How the analytics/reports endpoints compute figures and avoid cross-tenant aggregate leakage.
---

# Analytics & reports

Per-company or portfolio financials over trailing buckets (12 months / 8 quarters
/ 5 years). Revenue = sum of `orders.total_amount` by `created_at`; expenses = sum
of `transactions` where type='expense' by `date`; profit = revenue − expenses.
Valuation/equity come from active `shareholders` (valuation = Σ per-company
totalShares × maxSharePrice). COGS/gross margin stay **null** — expense
categorisation isn't tracked, so they are reported as unavailable, never faked.

## A ratio can leak the very total you're hiding
**Rule:** market share (company revenue ÷ group revenue) is returned ONLY to
super admins (companyScope === null). Scoped users get null.
**Why:** a scoped user already sees their own company's absolute revenue; handing
them an exact ratio lets them algebraically recover the group's absolute revenue
(own ÷ share = group total). The denominator never has to be returned to leak.
**How to apply:** whenever an endpoint returns a ratio/percentage whose numerator
the caller already knows, the denominator is effectively disclosed — gate such
derived metrics to callers allowed to see the whole aggregate, or coarse-band them.

## Timezone-safe date buckets
**Rule:** format bucket boundaries for text `date` columns from LOCAL components
(getFullYear/Month/Date), not `toISOString().slice(0,10)`.
**Why:** buckets are built with `new Date(y, m, d)` (local midnight); ISO
conversion can shift the calendar date across the UTC boundary and file txns into
the wrong bucket on non-UTC servers. (The rest of the codebase uses the ISO form
and only works because the container is UTC — don't rely on that in new code.)
