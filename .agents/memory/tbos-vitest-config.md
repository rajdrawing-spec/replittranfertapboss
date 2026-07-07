---
name: TBOS (tapashub) Vitest setup
description: Why tapashub tests use a standalone vitest.config.ts and how the Clerk boundary is mocked.
---

# tapashub test setup

The tapashub artifact runs jsdom component/integration tests with Vitest.

**Rule:** Tests must use the standalone `vitest.config.ts`, NOT `vite.config.ts`.
**Why:** `vite.config.ts` throws at load time if `PORT`/`BASE_PATH` env vars are
missing (they are dev-server-only). Vitest auto-loads `vitest.config.ts` when
present, sidestepping that throw. The vitest config only needs the `@vitejs/plugin-react`
plugin and the `@` -> `src` alias.

**Testing the Clerk auth boundary without real OAuth:** sign-in is Clerk Google
OAuth (invite-only) and cannot be driven headlessly. Mock `@clerk/react`
(`useAuth`/`useClerk`) with a small external store wired through
`useSyncExternalStore` so identity changes re-render consumers, and mock
`/api/auth/me` via `globalThis.fetch`. This is how account-switch isolation
(cache keyed by Clerk userId + cache-clear-on-identity-change) is verified.

**How to apply:** any future component test in tapashub — reuse the standalone
config and the Clerk-store mock pattern rather than trying to boot real Clerk.
Test files are excluded from `tsconfig.json`, so they are validated by running
`pnpm test`, not by `pnpm typecheck`.
