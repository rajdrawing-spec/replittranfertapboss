---
name: TBOS Treasury & Finance modules
description: Treasury module design (parent-only ledger, no companyId), soft-cancel on transactions, subsidiary finance view
---

## Treasury module

- `treasury_entries` table has **no `companyId`** — intentional: TapasHub is single-parent, treasury is one central ledger
- All `/treasury/*` routes require `requireSuperAdmin` — never open to staff
- Treasury balance = SUM(approved + non-reversed entries) − SUM(executed fund_allocations FROM parent)
- Soft-reversal only (no hard delete): `isReversed=true` + audit trail
- Route file: `artifacts/api-server/src/routes/treasury.ts`
- Frontend page: `artifacts/tapashub/src/pages/treasury.tsx`
- Nav: "Treasury" added to `parentNav` in `layout.tsx`, route at `/treasury` in `App.tsx`

## Finance module changes

- `DELETE /finance/transactions/:txId` is a **soft-cancel** (sets `status="cancelled"`) — records are never destroyed
- Frontend cancel icon changed from Trash2 → Ban to reflect non-destructive intent
- Expense categories expanded to 17 (added: Marketing, Technology, Office, Operations, Manufacturing, Shipping, Legal, Miscellaneous)
- Subsidiary finance overview section: shows when `activeCompany.mode === "subsidiary"` using balance API's `fundAllocationsIn` field

## Startup migrations (critical pattern)

`applyMigrations()` runs BEFORE seeders to create tables. `repairOrphanedAllocations()` runs AFTER seeders so companies exist on first boot. Order in index.ts:
1. `applyMigrations()` — schema DDL (CREATE TABLE IF NOT EXISTS)
2. `ensureSystemRoles()` + `ensureStarterCompanies()` — in parallel
3. `repairOrphanedAllocations()` — fixes stale fund_allocation company IDs

The `treasury_entries` table is not in the original Supabase schema — it was added post-deployment. The startup migration creates it if missing (idempotent).

## Fund allocation cancel (atomic)

`POST /fund-allocations/:id/cancel` uses `db.transaction` + `SELECT ... FOR UPDATE` to prevent race with concurrent approval execution:
- Locks the row first
- Re-reads linked tx IDs inside the lock (they may be set by concurrent executor)
- Cancels allocation + linked transactions atomically
- Error codes thrown as `{ code: 404/400/409 }` objects for the outer catch

## Finance balance "all companies" view

Setting allocIn = allocOut = 0 in consolidated view is intentional: internal transfers net to zero so showing both as equal numbers was misleading. Per-company view (with companyId param) still computes real in/out correctly.

## Finance security fix (important)

**Before:** Finance transaction routes had NO company-scope authorization — any authenticated user could read/edit/cancel any company's transactions by ID.

**After:** All four transaction routes now call `canAccessCompany(req, companyId)`:
- GET list: scoped by `companyScope(req)` using `inArray` (guarded for empty array)
- POST: checks `canAccessCompany` on body's companyId before insert
- PATCH/:id: looks up tx.companyId first, then checks `canAccessCompany`
- DELETE/:id: same lookup + check before soft-cancel

**Why:** Cross-tenant data isolation — staff must never touch another company's ledger.
