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

**Quirks that bite in tapashub component tests:**
- No `@testing-library/user-event` dep — use `fireEvent` from `@testing-library/react`.
- Radix `Tabs` only mount the *active* tab's content, so text inside an inactive
  `TabsContent` is absent from the DOM. To assert on a non-default tab, switch to
  it first — a bare `fireEvent.click` on the trigger does NOT switch it (Radix
  uses automatic activation on focus); do `mouseDown` + `.focus()` + `fireEvent.focus`
  on the `getByRole("tab", { name })` trigger, then assert.
- Interpolated strings like `{industry} • {pct}% Ownership` render as separate
  text nodes, so `getByText(/Industry/)` fails; use a `(_, el) => el?.textContent === "..."` matcher.
- Company-scoped list pages (Orders etc.) fetch via `customFetch`/`globalThis.fetch`
  with the active companyId in the query string; drive scope through `CompanyProvider`
  + `setActiveCompanyId`, and return per-company fixtures keyed by the `companyId` param.
