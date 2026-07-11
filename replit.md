# TapasHub Business Operating System (TBOS)

A production-ready SaaS ERP + CRM + AI platform for TapasHub, a parent company that owns 30% stakes in 6 businesses. Single command center for managing all companies — orders, inventory, finance, HR, CRM, approvals, and AI-powered insights.

## Run & Operate

- `pnpm --filter @workspace/tapashub run dev` — run the frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, Recharts, framer-motion, wouter
- API: Express 5, Zod validation, Orval codegen
- DB: PostgreSQL + Drizzle ORM
- Fonts: Inter + JetBrains Mono

## Where things live

- `artifacts/tapashub/` — React + Vite frontend
- `artifacts/tapashub/src/pages/` — all 12 page components
- `artifacts/api-server/src/routes/` — Express route handlers
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/db/src/schema/` — Drizzle schema definitions
- `lib/api-client-react/src/generated/` — generated React Query hooks

## Companies

1. TapasHub (parent, 100%)
2. HugFAB (apparel, 30%)
3. TikkaTails (pet products, 30%)
4. Throttledaires (automotive, 30%)
5. Sanchikart (e-commerce, 30%)
6. Pepalworks (stationery & craft, 30%)

## Pages / Modules

| Route | Module |
|-------|--------|
| `/` | Executive Dashboard (cross-portfolio KPIs, AI insights, activity) |
| `/companies` | Company grid with revenue and health |
| `/companies/:id` | Company deep-dive |
| `/orders` | Order management (all channels) |
| `/inventory` | Product catalog, low-stock alerts |
| `/finance` | P&L, cash flow, transactions |
| `/hr` | Employee directory, attendance |
| `/crm` | Customers, leads pipeline, vendors |
| `/approvals` | Approval workflow queue |
| `/notifications` | Notification center |
| `/ai-assistant` | AI business chat |
| `/settings` | User management |

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks
- Multi-company: all tables have `company_id` FK; dashboard aggregates across all
- Route ordering: static routes (e.g. `/orders/stats`) always registered before parameterized routes (`:orderId`) in each router file
- Dark-first UI: `dark` class on html element, localStorage toggle for light mode
- AI assistant uses real DB data for grounded responses; no hallucinated numbers

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Environment setup (imported project)

- Auth: Replit-managed Clerk (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` auto-provisioned).
- AI: Gemini. User declined the Replit AI Integrations upgrade, so `lib/integrations-gemini-ai/src/client.ts` falls back to a direct `GEMINI_API_KEY` secret instead of the managed proxy — see `.agents/memory/gemini-client-fallback.md`.
- DB: Replit Postgres via `DATABASE_URL`; schema pushed with `pnpm --filter @workspace/db run push`. Starter companies and system roles auto-seed on API server startup.
- All three artifacts (`tapashub` web, `api-server`, `mockup-sandbox`) run via their auto-created workflows; `pnpm run typecheck` and both `test`/`test-web` suites pass.

## Gotchas

- After any schema change, run `pnpm --filter @workspace/db run push` then restart the API server
- After any OpenAPI spec change, run `pnpm --filter @workspace/api-spec run codegen` then re-run `pnpm run typecheck:libs`
- The `@import url(...)` for Google Fonts must be the FIRST line in `index.css` — before `@import 'tailwindcss'`
- The API server builds via esbuild (CJS); `PORT` and `BASE_PATH` env vars are injected by the artifact workflow — do not hardcode them

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
