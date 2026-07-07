---
name: TAPBOSS company scoping & vault access
description: How company-level authorization and vault password reveal are gated
---

# Company scoping & authorization model

Users have `role` (text) + `companyIds` (int[]) on the users table. Frontend drives filtering
via the chosen active workspace (`useCompany().activeCompany`), passing `companyId` as a query param.

**Group-level roles** (`super_admin`, `founder`, `director`, `finance`, `ca`) can access every
company's data. Other roles are limited to their own `companyIds`.

**Vault passwords:** `investor` role is fully blocked from reveal. Non-group roles may only reveal
entries whose `companyId` is in their `companyIds` (null companyId = group-level, blocked for them).
List/search always AND the `companyId` filter with the `q` text filter — never OR — or subsidiary
users leak other companies' rows when searching.

**Why:** A code review flagged cross-company leakage (search returning all companies when `q` set)
and unauthorized field mutation via raw PATCH bodies.
**How to apply:** On every new company-scoped route, combine companyId + text filters with `and()`,
and strip `id`/`companyId`/`createdAt`/`updatedAt` from PATCH `req.body` before `.set()`.
