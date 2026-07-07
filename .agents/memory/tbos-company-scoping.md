---
name: TAPBOSS company scoping & authorization
description: How company-level authorization is enforced on scoped routes (list, search, and writes)
---

# Company scoping & authorization model

Users have `role` (text) + `companyIds` (int[]) on the users table. Frontend drives filtering
via the chosen active workspace (`useCompany().activeCompany`), passing `companyId` as a query param.

**Group-level roles** (`super_admin`, `founder`, `director`, `finance`, `ca`) can access every
company's data. Other roles are limited to their own `companyIds` (a null `companyId` row = group-level).

**Enforce scope server-side on EVERY endpoint — never trust the request's `companyId`:**
- Build an `accessScope(user)` SQL predicate: group roles → no filter; others →
  `or(inArray(companyId, user.companyIds), isNull(companyId))`. ALWAYS AND this into the WHERE
  clause of list/search — do not make it conditional on whether a `companyId` query param was sent
  (that leaves a bypass: a non-group user passing an arbitrary `companyId` skips the restriction).
- Writes (PATCH/DELETE by id) MUST AND the same `accessScope` into the WHERE clause, or any authed
  user can mutate rows across tenants by guessing IDs. Stripping id/companyId/timestamps from the
  PATCH body is NOT sufficient — it doesn't stop cross-tenant row selection.
- POST: validate the body's `companyId` is in the caller's `companyIds` (non-group roles); reject null.
- List/search always AND the `companyId` filter with the `q` text filter — never OR.

**Why:** Two code reviews flagged broken multi-tenant isolation: (1) search returning all companies
when `q` was set (OR bug), and (2) scope applied only when no `companyId` param present, plus writes
with no row-level scope, letting any user read/edit/delete other tenants' rows.
**How to apply:** On every new company-scoped route, define `accessScope(user)` once and AND it into
the WHERE of list, search, PATCH, and DELETE; validate companyId on POST.
