# LiveKit Migration Guide

TapBoss has migrated from Jitsi/JaaS to **LiveKit** for all real-time audio and video communication. LiveKit is a self-hosted, open-source WebRTC platform that integrates fully into TapBoss with no external logins, no iframes, and no third-party branding.

---

## Architecture

```
TapBoss Frontend (Replit)
        │  WebRTC + HTTPS
        ▼
TapBoss API (Replit) ── /api/meetings/token ──► LiveKit JWT
        │  WebSocket (WSS)
        ▼
  LiveKit Server (your VPS)
        │
        ▼
  PostgreSQL (Supabase)
```

---

## Step 1 — Set up a LiveKit server on a VPS

LiveKit runs on any Linux VPS (AWS EC2, DigitalOcean, Hetzner, etc.).

### Option A: Docker Compose (recommended)

```bash
# On your VPS
curl -sSL https://get.docker.com | sh

# Create LiveKit config
cat > livekit.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: localhost:6379
turn:
  enabled: false   # enable if behind NAT
keys:
  access_key: YOUR_LIVEKIT_API_KEY
  secret: YOUR_LIVEKIT_API_SECRET
EOF

# Run LiveKit
docker run -d \
  --name livekit \
  -p 7880:7880 \
  -p 7881:7881/tcp \
  -p 50000-60000:50000-60000/udp \
  -v $(pwd)/livekit.yaml:/livekit.yaml \
  livekit/livekit-server \
  --config /livekit.yaml \
  --bind 0.0.0.0
```

### Option B: LiveKit Cloud (no VPS required)

Sign up at https://cloud.livekit.io and get your `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from the dashboard. No server setup needed.

---

## Step 2 — Open firewall ports

On your VPS, allow inbound traffic on:

| Port | Protocol | Purpose |
|------|----------|---------|
| 7880 | TCP | LiveKit API + WebSocket |
| 7881 | TCP | RTC TCP fallback |
| 50000–60000 | UDP | Media (WebRTC) |

---

## Step 3 — Configure TapBoss secrets

In your Replit project, go to **Secrets** and add:

| Secret | Value | Example |
|--------|-------|---------|
| `LIVEKIT_URL` | WebSocket URL of your LiveKit server | `wss://livekit.yourdomain.com` or `wss://your-vps-ip:7880` |
| `LIVEKIT_API_KEY` | The `access_key` from `livekit.yaml` | `access_key` |
| `LIVEKIT_API_SECRET` | The `secret` from `livekit.yaml` | `your_secret_here` |

> **Note:** If using LiveKit Cloud, copy the URL, API key, and secret directly from the cloud dashboard.

After adding secrets, **restart the API Server workflow** in Replit.

---

## Step 4 — Verify the connection

Once the API server restarts, navigate to **Meetings** in TapBoss. The settings panel will show **"LiveKit Connected"** if the credentials are correct.

You can also test via curl:
```bash
curl -s "https://your-tapboss-domain/api/meetings/livekit-status" \
  -H "Cookie: your_session_cookie"
```

Expected: `{"configured":true}`

---

## Features enabled by LiveKit

- ✅ One-to-one and group audio/video calls
- ✅ Screen sharing
- ✅ Camera on/off, microphone mute/unmute
- ✅ Active speaker detection
- ✅ Grid view and speaker-focused view
- ✅ Participant list
- ✅ Connection quality indicators
- ✅ Auto-reconnect
- ✅ Meeting timer
- ✅ Leave confirmation
- ✅ Floating mini-player (stay in call while navigating)
- ✅ Incoming call notifications via Socket.IO

---

## What was removed

- `@jitsi/react-sdk` package
- All Jitsi/JaaS code (`jitsi-provider.ts`, `jitsi-meet.tsx`)
- JaaS-specific secrets (`JITSIAAS_MAGIC_COOKIE`, `JITSIAAS_PRIVATE_KEY`) — no longer used in code

---

## Troubleshooting

**"LiveKit not configured"** banner — Add all three secrets and restart the API server.

**Connection fails / black screen** — Verify UDP ports 50000–60000 are open on your VPS firewall. LiveKit uses UDP for media by default.

**Behind NAT** — Enable TURN in `livekit.yaml`:
```yaml
turn:
  enabled: true
  domain: your-turn-domain.com
  cert_file: /path/to/cert.pem
  key_file: /path/to/key.pem
```

**For local testing** — Use `wss://localhost:7880` and allow self-signed certificates, or use LiveKit Cloud.

---

## Additional resources

- [LiveKit Documentation](https://docs.livekit.io)
- [LiveKit Cloud](https://cloud.livekit.io)
- [@livekit/components-react](https://github.com/livekit/components-js)
- [livekit-server-sdk (Node.js)](https://github.com/livekit/server-sdk-js)
