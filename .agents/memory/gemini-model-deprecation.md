---
name: Gemini model deprecation
description: Pinned Gemini model names can 404 for new API keys; prefer the -latest aliases.
---

Direct Gemini API keys created recently get `404 "This model models/gemini-2.5-flash is no longer available to new users"` at `generateContent` — even though the model still appears in `models.list`.

**Why:** Google gates older pinned models per-account; listing is not the same as being callable.

**How to apply:** Use rolling aliases (`gemini-flash-latest`, `gemini-pro-latest`) in all text/audio call sites instead of pinned `gemini-2.5-*` names. When an AI pipeline suddenly fails with 404 NOT_FOUND on the model, test with the alias before debugging anything else. E2E verification of the meeting-notes pipeline can be replayed with `artifacts/api-server/scripts/verify-meeting-notes.ts <audio file>` (creates and cleans up its own test rows).
