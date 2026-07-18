---
name: TBOS realtime (chat/calls) reliability
description: Socket.IO + LiveKit lessons — single-use tokens, /api socket path for prod, disconnect recovery
---

- **Single-use socket tokens + reconnection**: the API server deletes a chat socket token on first use. Clients MUST pass `auth` as a *function* (fetching a fresh token per attempt), never a static token — otherwise every automatic reconnect fails forever with "Invalid or expired token". This was the root cause of "chat errors again and again".
- **Socket path must live under /api**: in production only `/api/*` is forwarded to the API server; a bare `/socket.io` path never reaches it (static frontend swallows it). Socket.IO is mounted at `/api/socket.io` on server, both clients, and the Vite dev proxy (`ws: true`). Keep default transports (polling-first, WS upgrade) so a dropped WS upgrade degrades instead of failing.
- **Don't tear down the chat socket on channel switch**: keep selected channel in a ref for handlers; re-join company + current channel in the `connect` handler (fires on reconnects too).
- **LiveKit token refresh**: swapping the `token` prop while connected is a no-op (client returns early when connected). Instead, key `LiveKitRoom` on the token and, in an `onDisconnected` handler, distinguish user-initiated leave (a `leavingRef` flag) from unexpected drops; on drop fetch a fresh token (remount reconnects). Branch on status: 4xx = end call cleanly (meeting gone/access revoked), 5xx/network = retry with backoff before giving up.

**Why:** prevents recurring chat/call failures across dev and prod; reconnect auth and prod routing are invisible in local happy-path testing.
**How to apply:** any new realtime feature (sockets, calls) must use auth-as-function, `/api`-prefixed paths, and reconnect-aware join logic.

- LiveKit's built-in control-bar Leave button disconnects the room directly, bypassing app-level leaveCall(); the onDisconnected handler must check `reason === DisconnectReason.CLIENT_INITIATED` and treat it as an intentional leave, or the auto-reconnect logic silently rejoins the user ("leave not working").
