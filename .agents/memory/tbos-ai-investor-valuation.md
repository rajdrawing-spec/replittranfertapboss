---
name: TBOS AI Investor Valuation Engine
description: Architecture and key decisions for the 6-method AI valuation upgrade on the ai_valuations table.
---

## Rule
When upgrading `ai_valuations`, always add new nullable columns via raw `executeSql` ALTER TABLE first, then update `lib/db/src/schema/ai.ts`, then run `cd lib/db && npx tsc --build` to refresh the compiled `.d.ts` — the lib has no build npm script.

**Why:** `pnpm run build` on `@workspace/db` returns "no build script". The dist declarations are emitted by TypeScript project references (`tsc --build`). Skipping this step leaves `$inferSelect` missing the new columns and causes widespread TS2339 errors across `artifacts/api-server`.

## How to apply
Any time you add columns to a lib/db table:
1. `executeSql` ALTER TABLE (additive only — never drop/rename without TTY)
2. Edit `lib/db/src/schema/<table>.ts`
3. `cd /home/runner/workspace/lib/db && npx tsc --build`
4. Then typecheck api-server

## Valuation method weights (current)
| Method | Weight | Column |
|---|---|---|
| Asset-Based | 20% | asset_valuation |
| Revenue Multiple | 30% | revenue_multiple_val |
| EBITDA Multiple | 20% | ebitda_valuation |
| DCF | 15% | dcf_valuation |
| Scorecard | 10% | scorecard_valuation |
| VC Method | 5% | vc_valuation |

Final `estimated_value` = weighted average computed by the AI.

## Outstanding shares in prompt
The handler queries `sum(shareholders.shares)` for the company and passes it as "Outstanding Shares: N" so the AI can compute `book_value_per_share` and `estimated_share_price`. If no shareholder data, passes "unknown" and the AI returns 0 for those fields.

## Investor Readiness Score bands
- 90–100 → excellent (green)
- 75–89 → strong (blue)
- 60–74 → moderate (amber)
- <60 → needs_improvement (red)
