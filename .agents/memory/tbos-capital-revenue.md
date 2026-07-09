---
name: TBOS capital vs revenue separation
description: How treasury capital (raised) and subsidiary operational revenue are tracked and displayed separately.
---

## Rule
Never mix treasury capital entries with subsidiary operational revenue. They are fundamentally different:
- **Capital** = money raised from investors/grants, stored in `treasury_entries` table.
- **Revenue** = operational income recorded by subsidiaries in `transactionsTable` (type='income', status='completed').

## How the summary endpoint works
`GET /treasury/summary` returns both, clearly labeled:
- Capital fields: `totalRaised`, `allocated`, `available`, `utilizationPercent`
- Revenue fields: `groupRevenue`, `netGroupPosition`, `revenueBySubsidiary[]`, `monthlyRevenue[]`
- The allocation chart now has two bars per company: `allocated` (capital) and `income` (revenue).

Revenue is computed by querying `transactionsTable` (read-only) — no new treasury_entries are created when subsidiaries log income. This avoids coupling and double-counting.

## Sidebar widget
`WorkingCapitalWidget` (`components/working-capital-widget.tsx`) polls `GET /treasury/working-capital` every 60s. Only shown in parent view, expanded sidebar.

## Chart binding
`allocationsBySubsidiary` now uses field `allocated` (not `total`). If the chart ever breaks, check `dataKey` props — it must be `"allocated"` not `"total"`.

**Why:** Prior design returned `total` which was renamed to `allocated` for clarity. A bad binding caused empty bars.

**How to apply:** Any new chart consuming allocationsBySubsidiary must use `dataKey="allocated"` and `dataKey="income"`.
