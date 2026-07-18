---
name: TBOS granular RBAC for parent modules
description: Treasury/Fund Allocation moved from super-admin-only to permission keys; request-access flow; test mocking implications.
---

- Treasury and Fund Allocation are gated by `treasury.view/manage` and `funds.view/manage` (not `requireSuperAdmin`). Finance role holds all of them; Director holds the `.view` ones. Sidebar items in `layout.tsx` carry an optional `perm` and are filtered via `hasPermission`.
- Denied pages render `RequestAccessGate` (components/access-gate.tsx) which POSTs `/api/access-requests` → notification + audit, with an in-memory 1h per-user/module cooldown.
- **Why:** user required per-role gating grantable via Team & Roles, plus a "request approval" UX instead of blanket "Super Admin required" screens.
- **How to apply:** new modules should get `<module>.view/manage` keys in permissions.ts (system role seed auto-updates on boot), `requirePermission` on routes, `enabled: canView` on page queries (so denied users don't prefetch), and `RequestAccessGate` for the denied state.
- Backend tests that fake `@workspace/db` (e.g. treasury-isolation) must `vi.mock("../middleware/authz")` — real `requirePermission` queries the roles table and 500s against the in-memory store.
