---
name: TBOS PWA / offline & low-bandwidth tuning
description: Service-worker precache + react-query tuning decisions for the tapashub web app; what must NOT be cached or retried.
---

# TBOS PWA / offline & low-bandwidth

The tapashub web app uses `vite-plugin-pwa` (Workbox generateSW) for a
production-only service worker that **precaches the app shell + static assets**
(content-hashed JS/CSS/fonts/icons) so repeat loads are fast on slow networks and
the app is installable on mobile.

## Hard rules
- **Never runtime-cache `/api` or `/__clerk`.** Only precache immutable static
  assets. Caching API responses would leak stale/cross-tenant data in this
  multi-tenant app. `navigateFallbackDenylist` excludes both.
- **SW is disabled in dev** (`devOptions.enabled: false`). It only exists in
  production builds, so the Replit dev preview never shows SW caching behavior —
  verify SW via `pnpm build` output (expect `sw.js` + `manifest.webmanifest`).
- **Normalize the base path** before feeding `navigateFallback`/manifest `scope`:
  `/${BASE_PATH.replace(/^\/+|\/+$/g,'')}/`. BASE_PATH may arrive with or without
  a trailing slash; an un-normalized value produces `/tapashubindex.html` and
  breaks SPA fallback on deep-link refresh in production.

## react-query defaults for flaky networks
- Queries: retry 2 with exponential backoff (`min(1000*2**n, 15s)`),
  `refetchOnReconnect: true`, `gcTime` 30 min (instant back-nav from cache).
- **Mutations are NOT auto-retried.**
  **Why:** a write can succeed server-side but fail client-side on a drop; an
  automatic retry would create duplicate records/side effects. Users re-submit
  explicitly. Only add per-mutation retry for provably idempotent endpoints.
