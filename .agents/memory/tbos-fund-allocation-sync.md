---
name: TBOS fund allocation & finance sync
description: How parent→sub fund allocation, order→finance revenue sync, and approval gating fit together, and the invariants that keep money from double-booking.
---

# Fund allocation + cross-module finance sync

Parent (Tapas Hub) → subsidiary capital moves and sales→finance sync were built on the single shared `transactions` table (no separate ledger). Key design + invariants:

- **Fund allocation executes as a paired transaction**: a `transfer` out of the source company + an `income` (category `Capital Injection`) into the recipient, both keyed `ALLOC-<id>`. Optional equity change bumps `companies.ownership_percent` of the recipient. All inside one `db.transaction`.
- **Order revenue sync** (`order-revenue-sync.ts`): revenue recognised when an order reaches status `delivered` → `income`/`Sales Revenue` keyed `ORDER-<orderNumber>`; a `refunded`/`returned` order reverses it with an `expense`/`Refund` keyed `REFUND-<orderNumber>` (only if revenue existed). Called from orders POST + PATCH.
- **Idempotency is enforced at the DB, not just app checks**: a partial unique index `transactions_sync_ref_uniq` on `(reference_number, category)` WHERE reference_number LIKE 'ORDER-%'/'REFUND-%'/'ALLOC-%'. Sync inserts use `onConflictDoNothing()`; only notify when a row was actually returned.
- **Allocation execution is race-safe** via `SELECT ... FOR UPDATE` on the allocation row before acting, and it only proceeds from status `pending_approval` (idempotent no-op otherwise).

**Why:** an architect review flagged that check-then-insert + read-then-write both double-book under concurrent order updates / duplicate approvals. The FOR UPDATE lock + partial unique index are the guardrails.

**How to apply:** any new auto-generated finance posting should use a deterministic `reference_number` prefix and either extend the partial index or reuse an existing key; never rely on an app-level existence check alone.

## Approval gating
- Threshold in `finance-config.ts` (`FUND_APPROVAL_THRESHOLD`, ₹1,00,000). Allocation ≥ threshold OR any equity change > 0 → creates an `approvals` row of type `fund_allocation` and stays `pending_approval`; below → executes immediately.
- Approving/rejecting that approval (in approvals action route) propagates to the linked allocation (execute on approve, mark rejected on reject).
- `fund_allocation` approvals are gated to super_admin/company_admin AND `canAccessCompany(req, approval.companyId)`; `GET /fund-allocations` is tenant-scoped via `companyScope(req)` (from/to must intersect the caller's companies). Creation is `requireSuperAdmin`.
