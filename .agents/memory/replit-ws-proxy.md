---
name: Replit WebSocket proxy limitation
description: Replit's path-based dev proxy handles HTTP REST but NOT WebSocket upgrades across artifacts. Fix via Vite proxy.
---

## Rule
Never rely on Replit's path-based proxy for WebSocket connections from a web artifact to an API artifact.

**Why:** Replit's reverse proxy routes `/api/*` HTTP requests to the API server artifact correctly, but WebSocket upgrade requests (HTTP 101 Upgrade) are not forwarded through the path proxy. The browser sees `ws.onerror` immediately, showing "Connection failed" before any server-side code runs.

**How to apply:** Add a Vite `server.proxy` entry with `ws: true` for each WebSocket path. The WS connection then goes to the same Vite dev server (same origin, definitely supported), and Vite proxies it via `localhost:API_PORT`:

```ts
// vite.config.ts server section
proxy: {
  '/api/browser/ws': {                      // WS — must come before /api catch-all
    target: 'http://localhost:8080',
    ws: true,
    changeOrigin: true,
  },
  '/api': {                                  // REST — also proxied for consistency
    target: 'http://localhost:8080',
    changeOrigin: true,
  },
},
```

REST calls still reach the API server — the Vite proxy sends them to `localhost:8080` just like the Replit path proxy would.

**Symptoms of the bug:** `/api/browser/token` returns 200 in logs (HTTP works), but `/api/browser/ws` never appears in the API server logs at all (upgrade dropped by proxy).
