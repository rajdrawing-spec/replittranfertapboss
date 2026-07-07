---
name: Object storage upload auth with Clerk
description: How to adapt the object-storage skill's storage route when the app uses Clerk (not Replit Auth).
---

The object-storage skill's `routes/storage.ts` template guards the presigned-URL
endpoint with a Passport/Replit-Auth check (`req.isAuthenticated()`). This project
uses Clerk, so that check never passes.

**Rule:** In a Clerk app, remove the `hasAuthenticatedSession`/`req.isAuthenticated()`
guard and instead rely on the global `requireAuth` middleware (mounted before the
router) plus the app's own role middleware. Company-logo uploads are gated with
`requireSuperAdmin` on `POST /storage/uploads/request-url`.

**Serving:** `GET /storage/objects/*` is mounted after global `requireAuth`, so
in-app `<img src="/api/storage/objects/...">` works via the same-origin Clerk cookie.
We store the full serving path (`/api/storage${objectPath}`) in `companies.logoUrl`.

**Why:** Mixing the Replit-Auth template guard into a Clerk stack silently 401s every
upload. **How to apply:** whenever copying object-storage server templates into a
Clerk-authenticated API, swap the auth guard for `requireAuth`/`requireSuperAdmin`.
