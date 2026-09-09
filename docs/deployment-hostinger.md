# Deploying TBOS to Hostinger (Node.js)

This app was originally built on Replit, where `.replit` set `router = "application"`
and traffic was split automatically: `/api/*` went to the Node server and everything
else was served by a separate static host.

**Hostinger's Node.js hosting gives you one Node process on one port.** There is no
second static host, so the API server serves the frontend itself. That is what
`src/middlewares/staticSiteMiddleware.ts` does.

## Architecture

```
                 ┌──────────────────────────────────┐
  Browser ─────► │  Node process (one port)         │
                 │                                  │
                 │  /api/*         → Express router │
                 │  /api/__clerk   → Clerk proxy    │
                 │  /api/socket.io → Socket.IO      │
                 │  /assets/*      → static, cached │
                 │  everything else → index.html    │
                 └──────────────────────────────────┘
```

Because the frontend calls the API with **relative** URLs (`/api/...`), the frontend
and API must be same-origin. Serving both from one process satisfies that with no
CORS configuration and no second domain.

## Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `PORT` | **yes** | Hostinger assigns this. The server exits at boot if it is missing. |
| `SUPABASE_DB_URL` | **yes in production** | PostgreSQL connection string. See the warning below — this is *not* `DATABASE_URL`. |
| `SESSION_SECRET` | **yes** | Long random string for signing cookies. The server exits at boot if it is missing. |
| `CLERK_PUBLISHABLE_KEY` | yes, for auth | Also needed at build time as `VITE_CLERK_PUBLISHABLE_KEY`. |
| `CLERK_SECRET_KEY` | yes, for auth | Server-side Clerk key. |
| `NODE_ENV` | recommended | Set to `production`. |

### Optional

| Variable | Default | Notes |
|---|---|---|
| `WEB_DIST` | auto-detected | Absolute path to the frontend build. Set it if you move `dist/public` away from the monorepo layout. |
| `TRUST_PROXY` | `1` | Reverse-proxy hops to trust. `false` disables. Needed for correct client IPs. |
| `RATE_LIMIT_MAX` | `1000` | Requests per window, per IP, on `/api`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `ENABLE_CSP` | off | Set `true` to turn on helmet's Content-Security-Policy. **Validate on a staging URL first** — see the note below. |
| `BASE_PATH` | `/` | Only change if serving from a subdirectory. |

> **Build-time vs runtime:** anything the browser needs (`VITE_*`) is baked into the
> bundle at build time, so changing it later requires a rebuild, not just a restart.

> ### ⚠️ The database variable is `SUPABASE_DB_URL`, not `DATABASE_URL`
>
> `lib/db/src/index.ts` reads `SUPABASE_DB_URL` first and only falls back to
> `DATABASE_URL` when `NODE_ENV !== "production"`. With `NODE_ENV=production` set and
> only `DATABASE_URL` provided, the process **exits at boot** — the module throws while
> being imported, so nothing starts listening and there is no HTTP response at all:
>
> ```
> Error: SUPABASE_DB_URL must be set in production. Check your deployment secrets.
> ```
>
> Set `SUPABASE_DB_URL` on Hostinger. Setting both is harmless.
>
> SSL is forced on whenever `SUPABASE_DB_URL` is used, and the pool is capped at 5
> connections. If you point it at a non-Supabase Postgres that does not speak SSL,
> connections will fail — that cap and the SSL flag are keyed off the variable name,
> not the host.

## Deploy steps

```bash
# 1. Install (pnpm is required — the preinstall hook enforces it)
pnpm install --frozen-lockfile

# 2. Build frontend + API server (also runs the typecheck)
pnpm run build

# 3. Start
pnpm run start
```

Point Hostinger's **Application startup file** at `artifacts/api-server/dist/index.mjs`,
or set the start command to `pnpm run start`.

`pnpm run build` produces:

- `artifacts/tapashub/dist/public/` — the frontend, found automatically by the server
- `artifacts/api-server/dist/index.mjs` — the bundled server

## Verifying a deployment

```bash
curl -i https://yourdomain.com/api/healthz     # → 200 {"status":"ok"}
curl -i https://yourdomain.com/                # → 200 text/html
curl -i https://yourdomain.com/invoices/123    # → 200 text/html (SPA fallback, not 404)
curl -i https://yourdomain.com/api/nope        # → 404 JSON, not HTML
curl -sI https://yourdomain.com/assets/<hashed>.js | grep -i cache-control
                                               # → public, max-age=31536000, immutable
```

If `/` returns 404, the server did not find the frontend build. The startup log says
which directories it searched — set `WEB_DIST` to the right absolute path.

## Notes and caveats

**Content-Security-Policy is off by default.** This app loads Clerk, Google Fonts and
LiveKit from third-party origins. A CSP that misses one of them fails closed — a blank
page in production with only a console message explaining why. Turn it on with
`ENABLE_CSP=true` only after validating against a real deployment.

**Caching.** Hashed files under `/assets` are cached for a year (a new build produces
new filenames). `index.html` and the service worker are sent `no-cache`, because a
stale `index.html` references JS bundles whose hashed names no longer exist on the
server — the classic blank screen after a deploy.

**Migrations and seeding run at boot**, after the server starts listening
(`src/index.ts`). On a multi-instance setup they would run per instance; the seeders
are written to be idempotent, but a single instance is the expected shape here.

**Auth failures do not take down the frontend.** Clerk's middleware is mounted on
`/api` rather than globally, and `/api/healthz` is mounted ahead of it. A missing or
wrong `CLERK_SECRET_KEY` therefore produces failing API calls and a health check that
still answers `200` — not a 500 on every HTML, JS and CSS request, which is what a
global mount produced.

**A database outage no longer crashes the process.** Startup migrations and seeding
run after the server begins listening; the chain ends in a `.catch()` that logs at
fatal level and keeps the process up. Without it a brief DB blip at boot became an
unhandled rejection and Node exited, turning one transient failure into a crash loop.

**Native dependencies.** `sharp` and `playwright-core` are left unbundled by
`build.mjs` and must exist in `node_modules` at runtime. Do not prune them. If
Hostinger's environment cannot supply Chromium, the browser-automation routes will
fail while the rest of the app works.
