---
name: Gemini client dual-mode fallback
description: How lib/integrations-gemini-ai/src/client.ts (and image/client.ts) support both the Replit AI Integrations proxy and a direct user-supplied Gemini key.
---

`lib/integrations-gemini-ai/src/client.ts` prefers `AI_INTEGRATIONS_GEMINI_BASE_URL` +
`AI_INTEGRATIONS_GEMINI_API_KEY` (Replit-managed proxy) but falls back to a plain
`GEMINI_API_KEY` env var (direct `GoogleGenAI({ apiKey })`, no custom baseUrl) when the
user declines the Replit AI Integrations account upgrade.

**Why:** `setupReplitAIIntegrations` can return `{status: "awaiting_account_upgrade"}` if
the user isn't on a plan that supports it, and retrying doesn't help — the correct
fallback is `requestSecrets` for the provider's own key, not repeated retries.

**How to apply:** `lib/integrations-gemini-ai/src/image/client.ts` re-exports `ai` from
the shared `client.ts` rather than duplicating the env-var checks — keep it that way so
both paths (chat + image generation) stay in sync if the fallback logic changes again.
