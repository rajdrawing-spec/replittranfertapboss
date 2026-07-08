---
name: TBOS Browser Workspace
description: Architecture decisions and pitfalls for the server-side Playwright browser streaming feature in TAPBOSS.
---

# Browser Workspace — key decisions

## Architecture
- One `BrowserContext` (= Chrome Profile) per company, keyed by `companyId`
- `launchPersistentContext(userDataDir=.browser-profiles/company-{id}/)` for per-company isolation
- One Playwright `Page` per (companyId, platformKey) pair inside the same context
- Sessions persist 30 min of idle; auto-closed by `BrowserSessionManager.cleanupIdle()`

## Build: playwright-core needs externals in esbuild
`playwright-core` transitively requires `chromium-bidi` sub-packages. Add ALL of these to the `external` list in `build.mjs`:
```
"playwright-core", "chromium-bidi", "chromium-bidi/*"
```
Without `chromium-bidi/*` the build fails with "Could not resolve chromium-bidi/lib/cjs/bidiMapper/BidiMapper".

## Chromium on Replit
Installed via `installSystemDependencies({ packages: ["chromium"] })`.
Discovered at runtime with `which chromium` (tries: chromium, chromium-browser, google-chrome-stable, google-chrome).
Required args: `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer`.

## WebSocket auth: one-time tokens
1. Client calls `GET /api/browser/token?companyId=X&platform=Y` (behind requireAuth)
2. Server issues 32-byte random token with 30s TTL, stored in-memory Map
3. Client connects WS with `?token=<TOKEN>`
4. Upgrade handler verifies + deletes token immediately (one-time use)

**Why:** WS upgrades bypass normal Express middleware; the token flow ensures the upgrade is tied to an already-authenticated request.

## Security: URL must come from catalog server-side
The token endpoint resolves the browser navigation target from `INTEGRATION_CATALOG` using the `platform` key — it NEVER accepts a client-supplied URL.
**Why:** Accepting arbitrary URLs from the client is an SSRF risk (server-side browser can reach internal network endpoints).

## Screenshot backpressure
Use `inFlight` boolean in the `setInterval` screenshot loop.
```ts
if (inFlight) return; // drop frame, never queue
inFlight = true;
try { ... } finally { inFlight = false; }
```
**Why:** `setInterval` at 200ms with async screenshot work can pile up if Playwright is slow (heavy page, CPU saturation), amplifying resource use.

## Frontend reconnect: use retryKey state
Increment `retryKey` state to re-trigger the `useEffect` connection without a full page reload.
```tsx
const [retryKey, setRetryKey] = useState(0)
// useEffect deps: [companyId, platform.key, retryKey]
// Retry: setRetryKey(k => k + 1)
```
**Why:** `window.location.reload()` loses all app state; re-triggering the effect fetches a fresh token and reconnects cleanly.

## Passive wheel events in React
React's `onWheel` is passive in React 19 — calling `e.preventDefault()` has no effect.
Fix: use `useEffect` to add a non-passive listener directly to the DOM element:
```ts
el.addEventListener('wheel', handler, { passive: false })
```

## http.createServer pattern required
Must switch `app.listen(port)` to `http.createServer(app)` + `server.listen(port)` to attach the WS upgrade handler before the server starts listening.
`setupBrowserWebSocket(server)` must be called before `server.listen()`.
