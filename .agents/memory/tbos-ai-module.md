---
name: TBOS AI provider layer
description: Architecture and security rules for the AI Business Intelligence module (Task #34).
---

## Architecture

- **AI provider abstraction**: `AiProvider` interface with 4 adapters (Gemini, OpenRouter, Groq, DeepSeek). Active provider stored in `ai_config` table (key=`active_provider`). Defaults to Gemini (Replit proxy, no key needed).
- **Route mounting**: `geminiRouter` must be mounted with `router.use(geminiRouter)` in `routes/index.ts` alongside `aiRouter` — it is imported but easy to forget the mount call.
- **Context builder**: `artifacts/api-server/src/lib/ai-context.ts` — aggregates Finance, Treasury, Orders, CRM, HR, Inventory into `CompanyContext`. `formatContextForPrompt()` serialises to prose for the prompt.
- **DB tables**: `ai_analyses` (SWOT + insights cache, 1-hour TTL per company) and `ai_config` (key/value store for provider selection + API keys).
- **Gemini SDK**: `@workspace/integrations-gemini-ai` — accessed via Replit AI integrations proxy; model is `gemini-2.5-flash`; `maxOutputTokens: 8192`.

## Security rules

- **All AI routes** must have `requirePermission("ai.read")` middleware — including `/gemini/*` routes.
- **Every company-scoped route** (`/ai/analyse/:companyId`, `/ai/analyse/:companyId/cached`, `/ai/executive` with companyId) must call `canAccessCompany(req, companyId)` and 403 on mismatch.
- **Executive Q&A input** must be sanitised: max 1000 chars, strip `<>`, and wrapped in `[BEGIN QUESTION]...[END QUESTION]` delimiters before concatenation into the prompt.
- **Provider config routes** (`GET/PATCH /ai/provider`, `POST /ai/provider/test`) are `requireSuperAdmin` only.

## Permission rules (ALL AI endpoints)

Every AI route — including legacy `/ai/chat`, `/ai/insights`, and ALL `/gemini/*` routes — must have `requirePermission("ai.read")` middleware. There are no publicly accessible AI endpoints for any authenticated user.

## Credential encryption

Provider API keys (openrouter, groq, deepseek) are stored AES-256-GCM encrypted in `ai_config`. The `iv` column holds the hex IV. `setConfig` and `getConfig` in `ai-provider.ts` auto-encrypt/decrypt for keys in `CREDENTIAL_KEYS` set. Never store API keys as plaintext.

## esbuild critical note

`@google/*` must NOT be in the esbuild external list or `@google/genai` won't bundle into dist/index.mjs and the server will crash with `ERR_MODULE_NOT_FOUND`. Remove `"@google/*"` from the build.mjs external array — `@google-cloud/*` stays external (loads .proto files).

## Frontend

- `ai-assistant.tsx` uses `useCompany()` (from company-context) for `activeCompany` and `companies` — NOT `useAuth()`.
- Analysis runs against a single selected company (via Select picker); Executive AI can query single company, list, or full portfolio.
- Settings AI Provider card is shown only to `isSuperAdmin` users.
