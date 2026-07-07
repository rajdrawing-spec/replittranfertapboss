---
name: TBOS API fetch base URL
description: How to correctly construct API URLs in the tapashub frontend for direct fetch() calls
---

## Rule
Use bare `/api/...` paths for all direct `fetch()` calls in the tapashub frontend. Do NOT prefix with `import.meta.env.BASE_URL`.

## Why
The Vite `BASE_URL` (set from `BASE_PATH` env var) is `/tapashub/`. Prefixing with it creates URLs like `/tapashub/api/companies` which do not route to the API server. The Replit reverse proxy routes `/api/*` directly to the API server regardless of which artifact issued the request.

The generated Orval API client also uses bare `/api/...` paths — follow the same convention.

## How to apply
```ts
// WRONG
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "")
fetch(`${API_BASE}/api/auth/login`, ...)  // → /tapashub/api/auth/login ✗

// CORRECT
const API_BASE = ""
fetch(`${API_BASE}/api/auth/login`, ...)  // → /api/auth/login ✓
// Or simply:
fetch("/api/auth/login", ...)
```
