---
name: TBOS auth approach
description: How authentication is implemented in TBOS API and frontend
---

## Mechanism
- **Cookie:** `tbos_uid` signed with `SESSION_SECRET` via `cookie-parser`. HttpOnly, SameSite=Lax.
- **Password hash:** SHA-256(password + email) — simple, no bcrypt dependency.
- **Bootstrap password:** `Admin@123` — valid when `passwordHash` is null (first login sets the hash).
- **Middleware:** `requireAuth` in `artifacts/api-server/src/middleware/auth.ts` — reads `req.signedCookies.tbos_uid`, returns 401 if missing, attaches `req.userId`.

## Route protection
Applied in `routes/index.ts` as a blanket middleware after auth/health routers:
```ts
router.use(healthRouter);
router.use(authRouter);      // public
router.use(requireAuth);     // all routes below need auth
router.use(companiesRouter);
// ... all other routers
```

## Frontend
- `AuthProvider` in `contexts/auth-context.tsx` checks `/api/auth/me` on mount.
- `AuthGuard` wraps all authenticated pages, redirects to `/login` if unauthenticated.
- Login page at `/login` — standalone, outside AuthGuard.

## SESSION_SECRET
Required — index.ts throws on startup if missing. No insecure fallback.

## How to apply
Any new route that should be public (e.g. webhooks, health): mount BEFORE `requireAuth`.
Any new route that should be protected: mount AFTER `requireAuth` (default).
