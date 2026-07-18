---
name: TBOS Call Center module
description: Exotel-ready call center — provider abstraction, mock endpoints, and schema import gotcha
---

- Telephony is behind a `CallService` interface (`api-server/src/lib/call-center/call.service.ts`); `MockCallProvider` is active until Exotel credentials exist, then `ExotelProvider` (stub) gets implemented and swapped in `getCallProvider()`. Never call a vendor API from routes directly.
- Call state transitions must be conditional updates (status precondition in the WHERE clause) or concurrent answer/end/hold requests corrupt call logs. 409 on precondition failure.
- `req.resolvedPermissions` attached by `requirePermission` is a **string[]**, not a Set — use `hasPermission(perms, key)` from `lib/auth-user`, never `.has()`.
- Schema files in `lib/db` must import `{ z } from "zod/v4"` (not `"zod"`) or `z.infer<typeof createInsertSchema(...)>` fails with TS2344.
- New tables need both: raw SQL via executeSql for dev AND a `CREATE TABLE IF NOT EXISTS` block in `api-server/src/lib/migrations.ts` for prod catch-up.
