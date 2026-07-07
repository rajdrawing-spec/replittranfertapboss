---
name: Clerk prod custom-domain 401 / "Development mode" badge
description: Diagnosing a published Clerk app that shows dev-mode + 401s on a custom domain
---

# Published Clerk app on custom domain: "Development mode" badge + 401 on every auth call

**Symptom:** The *live* app (custom domain, e.g. `tapboss.tapashub.com`) shows Clerk's
"Development mode" badge on the sign-in card and every authenticated API call
(`/api/auth/me`) returns 401, so users hit the "Couldn't load your profile" screen.
The dev preview is a red herring here — confirm the URL in the address bar first
(a Replit `.replit.dev`/preview URL vs. the published custom domain).

**Root cause:** The published deployment is running with **development** Clerk keys
(`pk_test`) on the client while the deployed server verifies against a different key
set — so the session token signed by the dev instance never verifies → 401. This
happens when the deployment is stale (published before Clerk prod was provisioned)
or the custom domain isn't registered with the Clerk **production** instance.

**Why:** Replit-managed Clerk keeps dev keys (`pk_test`/`sk_test`) during development
and swaps in live keys (`pk_live`/`sk_live`) **at publish time**. A published build
still showing dev keys means the live keys were never baked in for that deployment/domain.

**How to apply:**
1. Verify the client + server Clerk wiring already matches the canonical snippets in
   the clerk-auth skill (`setup-and-customization.md`). If it does, the bug is NOT code.
2. The fix is operational: **re-publish** the app so production Clerk keys + proxy URL
   are baked into both client and server.
3. Because it's a **custom domain**, the domain must be registered with the Clerk
   production instance (authorized JS origins, redirect URIs, and DNS CNAMEs). If
   re-publishing alone doesn't clear it, the custom domain registration is the gap.
4. Do NOT hand-edit the Clerk secrets and do NOT debug this from dev logs — prod uses
   different keys/proxy not visible from dev. Rely on the user's live-app observations.
