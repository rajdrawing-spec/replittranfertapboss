---
name: TBOS feature modules — notifications, attachments, storage posture
description: Durable rules for event notifications, user-supplied attachment URLs, and object-storage auth in TapashHub Business OS.
---

# Event notifications
- Emit via the fire-and-forget helper `emitNotification(...)` in `artifacts/api-server/src/lib/notify.ts`; call as `void emitNotification({...})` so it can never break the primary operation. It resolves companyName from companyId when not given.
- **Fire on state TRANSITIONS, not on every write.** Low-stock notifies only when a product crosses into low-stock (compare prior stock), not on every update while it stays low. Same rule for "delivered", "completed", "disconnected", etc. — load/compare the prior value.
- **"last synced" timestamps must only advance on real success.** Shipment `lastSyncedAt` updates only when the courier adapter returns `status === "success"`. Integration adapters are honest stubs returning `"skipped"`, so it correctly never advances — do not fabricate a synced-looking timestamp on skipped/failed.
- **Why:** a code review flagged notification spam (every-write emission) and a misleading sync timestamp; both erode trust in the signal.

# Attachment URL safety
- Any user-supplied URL that gets persisted and later rendered as a clickable link MUST be scheme-allowlisted server-side. Use `isSafeAttachmentUrl()` in `artifacts/api-server/src/lib/url-safety.ts` (allows `http/https` and same-origin `/objects/`, `/public-objects/`, `/api/storage/` paths; rejects `javascript:`, `data:`, etc.). Applied on documents `fileUrl` and marketing creatives `url`/`thumbnailUrl`.
- **Why:** URL-attach features are an XSS/phishing vector; validating on save means stored data is always safe to render.

# Object storage auth posture
- The upload endpoint `POST /storage/uploads/request-url` was relaxed from super-admin-only to any authenticated staff (needed so regular users can attach document files). Upload paths are unguessable random UUIDs.
- The private-serving route `GET /storage/objects/*` still ships with its ACL check **commented out** (template default) — no per-object/company read enforcement. Cross-tenant object confidentiality is deferred to the tenant-isolation work, not solved here.
