---
name: TAPBOSS tenant scoping on aggregate/data endpoints
description: Which API routes enforce company scoping vs. still trust a client companyId, and the correct pattern.
---

# Tenant scoping across TAPBOSS API routes

Most data routes read a **client-provided** `companyId` from `req.query` with **no server-side authorization** against the caller's own companies. This lets any authenticated staff read another company's records by crafting the request. ~17 route files do this (orders, inventory, crm, finance, marketing, employees, shipping, documents, approvals, notifications, audit, platforms, search, users, ...).

**Scoped correctly:** `account-directory.ts` (getUser + `accessScope()`), and `dashboard.ts` / `director.ts` (via a local `companyScope(req)` reading `req.localUser`).

## The pattern to apply
- `companyScope(req)`: Super Admin (`isSuperAdmin(localUser)`) => `null` (all companies); otherwise `localUser.companyIds` (may be `[]` = sees nothing).
- If a request supplies a `companyId`, reject with **403** when it's not in the caller's scope.
- If none supplied, filter aggregates to the caller's scope.
- **Never pass an empty array to drizzle `inArray`** — guard `scope.length === 0` and early-return the empty result *before any DB call*. `[]` is truthy, so `scope ? inArray(col, scope) : undefined` still calls `inArray(col, [])`.

**Why:** removing fabricated metrics turned dashboard/director aggregates from fake into real cross-company numbers, so those were scoped. Comprehensive per-route tenant hardening (all ~17 routes) + authz tests is its own security task — do not fold it into unrelated work.
**How to apply:** when touching any company-filtered route, add `companyScope`/403 checks; when adding a new data route, scope it from the start.

## Write-side scoping
- `shareholders.ts` guards writes with `canAccessCompany(req, ...)` (POST checks `parsed.data.companyId`; PATCH/DELETE re-load the row and check `existing.companyId`). `documents.ts`, `shipping.ts`, `marketing.ts` (campaigns) were later given the same POST+PATCH guards.
- PATCH handlers here strip client `companyId`, so they can't *move* a record — but without a re-load+`canAccessCompany` on the existing row a scoped user could still edit **another** company's record. Always load-then-check on PATCH/DELETE.
- Nullable-`companyId` tables (e.g. `documents.companyId` is not `.notNull()`) need `companyId != null && !canAccessCompany(...)` — a null/global record isn't "another company" and passing `null` to `canAccessCompany` (which does `scope.includes`) would 403 legit global rows.
- Still unguarded at last pass: DELETE on documents/shipping/marketing, all of marketing **creatives & leads** (POST/PATCH/DELETE), and the GET list endpoints on documents/shipping/marketing (read-side leak — no companyScope at all).
