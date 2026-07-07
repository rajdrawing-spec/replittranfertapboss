---
name: TBOS client-side caching & identity isolation
description: How react-query caching is configured in the tapashub web app and the rule for user-scoped cache keys.
---

# React-query defaults
- The web app's `QueryClient` sets app-wide defaults (staleTime ~1min, gcTime ~5min, refetchOnWindowFocus off, retry 1) so navigating between pages does not refetch everything on every mount. Tune per-query only when a screen needs fresher/staler data.

# Identity-scoped cache keys (multi-tenant safety)
- **Any query whose result depends on the signed-in user MUST include the Clerk userId in its queryKey** (e.g. the session probe uses `["auth","me", userId ?? null]`).
- **Why:** a static key + long staleTime means a different account can read the previous account's cached profile/permissions. A listener that clears the cache on identity change is a secondary defense but is timing-dependent (the "first observed auth event doesn't clear" gap) — do not rely on it alone.
- **How to apply:** when adding a cached query for user-specific data, scope the key by userId; the cache then isolates per account regardless of invalidation-listener timing.

# Session query shape
- The `/api/auth/me` probe returns a discriminated result: 403 (not-invited/disabled) is a valid `{kind:"access"}` value, NOT a thrown error; only network/5xx throws so react-query retries. Loading is derived (`!isLoaded || (isSignedIn && data===undefined && !isError)`) so signed-out users resolve instantly and no fake progress timer lingers.

# Route code-splitting
- Page components are `React.lazy` chunks wrapped in a single `React.Suspense` with a lightweight spinner fallback (never a blank screen). Keep small always-on components (Layout, NotFound, LoadingScreen) eager.
