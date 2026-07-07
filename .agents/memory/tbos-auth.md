---
name: TBOS/TAPBOSS auth approach
description: How authentication and invite-only access work in the TAPBOSS app (Clerk-based).
---

# TAPBOSS auth

Auth is **Replit-managed Clerk** with Google sign-in (whitelabel), replacing the
old password/session-cookie system. The app is **invite-only** and internal —
there is no public content; signed-out users are redirected to a branded
`/sign-in` (Clerk `<SignIn>`).

**Web transport is cookie-based.** Frontend calls use bare `/api/...` paths
(same origin), never Bearer/getToken. Clerk cookie is sent automatically.

**Server bridge (JIT provisioning), in `lib/auth-user.ts`:**
`getOrProvisionLocalUser(clerkUserId)` maps a Clerk session to a local `users`
row. Fast path: match by `clerkUserId`. First sign-in: fetch email from Clerk,
then:
- email === `SUPER_ADMIN_EMAIL` (tapashub@gmail.com) → bootstrap/activate the
  single super_admin.
- existing users row by email → link + activate.
- pending `invitations` row → create user from invite, mark accepted.
- otherwise → `not_invited` (403). This is the invite-only gate.

`requireAuth` (global, after health+auth routers) runs this and attaches
`req.userId` + `req.localUser`. Admin routes gate with `requireSuperAdmin` /
`requirePermission(perm)` from `middleware/authz.ts`.

**Permissions:** catalog + system roles in `lib/permissions.ts`. super_admin
has `["*"]`. `platform.*` perms are super-admin-reserved; other roles get module
perms. System roles are re-seeded idempotently on boot (`seed-roles.ts`).

**Why:** spec required Google auth, invite-only SaaS, configurable roles, and an
audit trail. Super admin is the only account that can invite/manage users,
roles, companies, integrations, billing, and view audit logs.

**How to apply:** never reintroduce password concepts. Keep Clerk wiring
(pubkey via `publishableKeyFromHost`, unconditional `proxyUrl`,
`/sign-in/*?` + `/sign-up/*?` routes, proxy middleware before body parsers)
verbatim — only theme/UI is customizable.
