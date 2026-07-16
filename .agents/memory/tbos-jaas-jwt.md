---
name: TBOS JaaS JWT integration
description: How Jitsi as a Service (JaaS) JWTs are signed and what 8x8 requires.
---

JaaS requires a signed JWT to join a room. The JWT must be signed with the **RSA private key** that matches the public key uploaded in the JaaS console. The magic cookie is only the key identifier (`kid`), not the signing secret.

**Prerequisites:**
1. Generate an RSA 4096 key pair in PEM format:
   ```bash
   ssh-keygen -t rsa -b 4096 -m PEM -f jaasauth.key
   openssl rsa -in jaasauth.key -pubout -outform PEM -out jaasauth.key.pub
   ```
2. Upload the public key (`jaasauth.key.pub`) to the JaaS console → API Keys. JaaS returns a `vpaas-magic-cookie-<apiKey>/<appId>` string.
3. Store the **private key** (PEM content) in the Replit secret `JITSIAAS_PRIVATE_KEY`.
4. Store the magic cookie in the Replit secret `JITSIAAS_MAGIC_COOKIE`.

**JWT header:**
```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "vpaas-magic-cookie-<apiKey>/<appId>"
}
```

**JWT payload:**
```json
{
  "aud": "jitsi",
  "iss": "<appId>",
  "sub": "<appId>",
  "room": "<appId>/<meetingId>",
  "exp": <unixTimestamp>,
  "context": {
    "user": {
      "id": "<userId>",
      "name": "<displayName>",
      "email": "<email>",
      "avatar": "<avatarUrl>",
      "moderator": "true"
    },
    "features": {
      "livestreaming": "true",
      "recording": "true",
      "transcription": "true",
      "outbound-call": "true",
      "sip-outbound-call": "true"
    }
  }
}
```

**Important:** 8x8 expects boolean feature values as **strings** (`"true"` / `"false"`), not JSON booleans. Also, `moderator` must be a string.

**Backend signing:** use Node.js `crypto.createSign("RSA-SHA256")` with the PEM private key. Do NOT use HMAC-SHA256 with the API key; that will produce a token that JaaS rejects with "Authentication failed".

**Room URL format:**
`https://8x8.vc/<appId>/<meetingId>?jwt=<token>`

**Frontend SDK configuration:**
For JaaS, the serverUrl is `https://8x8.vc/<appId>`. The frontend Jitsi SDK gets:
- `domain`: `8x8.vc`
- `roomName`: `<appId>/<meetingId>`
- `jwt`: the token

**Why this matters:** JaaS authenticates JWTs by verifying the RSA signature against the uploaded public key. The magic cookie alone cannot sign a valid token. The previous HS256 implementation used the API key as a shared secret, which JaaS does not support, causing the "Authentication failed" error on the pre-join screen.
