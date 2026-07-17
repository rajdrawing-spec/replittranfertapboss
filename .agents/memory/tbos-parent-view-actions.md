---
name: TBOS Parent View Company Actions
description: How chat and instant-meeting quick actions work in the parent/portfolio view, and the LiveKit URL trap.
---

- In the parent/portfolio view, `activeCompany` is `null`, so company-scoped pages (Chat, Meetings) must provide a local company picker instead of rendering an empty "No company selected" state. Default the picker to the parent company first, then the active company, so parent-team actions work immediately.
- Dashboard quick actions (Open Chat, Instant Meeting) also need a company picker in parent view. They should not require switching to a subsidiary first.
- The LiveKit `roomUrl` stored in `meetingsTable` is a `wss://` WebSocket URL. It must **never** be opened via `window.open`, `<a href>`, or browser navigation — that causes `ERR_UNKNOWN_URL_SCHEME`. Always fetch a token and join through the shared `MeetingContext` (`startCall`) so the `<LiveKitRoom>` component connects via WebSocket internally.
- This applies to the dashboard Instant Meeting card, the Chat channel video-call button, and anywhere else a meeting is created on the fly.
