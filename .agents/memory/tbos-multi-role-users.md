---
name: TBOS multi-role users
description: How multiple roles per user work — schema, permission union, middleware, self-view restriction scope
---

## Schema
`users.extra_roles json NOT NULL DEFAULT '[]'` added alongside the existing `users.role text` (primary role). Migrated with `ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_roles json NOT NULL DEFAULT '[]'::json`.

## Permission union
`getUserPermissions` in `auth-user.ts` unions permissions across `[user.role, ...user.extraRoles]`. If any role has `"*"` the function returns `["*"]` immediately. Uses `inArray` from drizzle-orm — the auth test drizzle-orm mock must include `inArray`.

## Middleware side-effect
`requirePermission` now attaches resolved permissions to `(req as any).resolvedPermissions` so route handlers can inspect them without a second DB call. Pattern:
```ts
const perms: string[] = (req as any).resolvedPermissions ?? [];
const canManage = perms.includes("*") || perms.includes("shareholders.manage");
```

## Shareholder self-view restriction — must cover ALL read routes
When `canManage` is false, restrict to email-matched rows on:
- `GET /shareholders` — return only rows where `email = user.email`
- `GET /shareholders/:id` — 403 unless `h.email === user.email`
- `GET /shareholders/cap-table` — 403 outright (self-view users don't need a company-level cap table)

**Why:** a shareholder with scoped companyIds could still enumerate other shareholders via `:id` or `cap-table` if only the list endpoint was guarded.

## Frontend
`Shareholders` page is a thin wrapper that renders `<AdminShareholdersView />` or `<MyHoldingsView />` based on `hasPermission("shareholders.manage")`. Each child owns its own hooks — no conditional hooks violation.
