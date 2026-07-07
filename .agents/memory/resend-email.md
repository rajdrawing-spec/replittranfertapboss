---
name: Resend transactional email (TBOS)
description: How invite/transactional emails are sent via the Resend connector, and the escaping/from-address constraints.
---

# Resend transactional email

Email delivery uses the Resend connector via `@replit/connectors-sdk`
(`new ReplitConnectors().proxy("resend", "/emails", { method, headers, body })`).
`proxy` returns a `fetch` `Response`; JSON-stringify the body and set
`Content-Type: application/json`. Success body is `{ id }`.

## From address
- Must be a domain **verified in Resend**. `onboarding@resend.dev` works for
  testing but only delivers to the Resend account owner's own address.
- Made configurable via `EMAIL_FROM` env (default `onboarding@resend.dev`), and
  the CTA link via `APP_URL` (falls back to `https://$REPLIT_DEV_DOMAIN/tapashub`).

**Why:** the user asked for a gmail.com from-address, which can never be verified;
transactional providers reject unverified sender domains.

## Best-effort send pattern
- The underlying write (invitation row, shareholder record) is persisted first;
  email send is attempted after and its failure must NOT roll back the write.
- User-invite returns `{ ...invite, emailSent, emailError }`; shareholder-invite
  returns 502 on send failure and only stamps `invitedAt` after a successful send.

## Security: always HTML-escape template values
- Every user-/DB-controlled value interpolated into email HTML (name, company
  name, role, inviter, recipient address) MUST go through `esc()`. Unescaped
  values allow markup/link injection into a trusted branded email (phishing).
- Subjects are plain text but strip CR/LF to avoid header injection.

**How to apply:** when adding a new email template in
`artifacts/api-server/src/lib/email.ts`, wrap every `${...}` dynamic token in
`esc(...)`; cover it with an injection test in `email.test.ts` (mock the SDK via
`vi.hoisted` — the mock factory runs before top-level consts otherwise).
