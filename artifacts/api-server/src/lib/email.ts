import { ReplitConnectors } from "@replit/connectors-sdk";

/**
 * Transactional email delivery via the Resend connector.
 *
 * Sending is intentionally best-effort: a failure to deliver must never roll
 * back the underlying action (creating an invitation, adding a shareholder).
 * Callers get back a { ok, error } result so they can surface a warning while
 * still completing the write.
 *
 * The "from" address must be on a domain verified in Resend. For quick testing
 * Resend permits `onboarding@resend.dev` (delivers only to the Resend account
 * owner's address). Set EMAIL_FROM once a real domain is verified.
 */

const connectors = new ReplitConnectors();

const _emailFromRaw = process.env.EMAIL_FROM?.trim() || "";

// Guard against a common misconfiguration where a URL is pasted into EMAIL_FROM.
// A valid sender is an RFC 5321 address or "Display Name <addr@domain>" — never a URL.
if (_emailFromRaw && /^https?:\/\//i.test(_emailFromRaw)) {
  console.error(
    `[email] EMAIL_FROM is set to a URL ("${_emailFromRaw}") instead of an email address. ` +
    `All email delivery will fail until this is corrected. ` +
    `Set EMAIL_FROM to e.g. "TapasHub <noreply@yourdomain.com>".`
  );
}

const FROM = _emailFromRaw && !/^https?:\/\//i.test(_emailFromRaw)
  ? _emailFromRaw
  : "TapasHub <onboarding@resend.dev>";

/** Public URL of the web app, used for sign-in / call-to-action links. */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}/tapashub`;
  return "";
}

/** Escape a value for safe interpolation into HTML text or attribute context. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

async function send({ to, subject, html }: SendArgs): Promise<SendResult> {
  // Strip CR/LF from subject to prevent header injection attacks.
  subject = subject.replace(/[\r\n]+/g, " ").trim();
  try {
    const resp = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { ok: false, error: `Resend responded ${resp.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Shared HTML shell so every email looks like it comes from the same product. */
function layout(headline: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta && cta.url
    ? `<tr><td style="padding:8px 0 4px;">
         <a href="${esc(cta.url)}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;
            padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">${esc(cta.label)}</a>
       </td></tr>
       <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;">
         If the button doesn't work, copy this link:<br/><span style="color:#6d28d9;">${esc(cta.url)}</span>
       </td></tr>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0b0b0f;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#15151c;border:1px solid #26263200;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #24242e;">
        <span style="color:#a78bfa;font-size:18px;font-weight:700;letter-spacing:-0.02em;">TapasHub</span>
        <span style="color:#6b7280;font-size:12px;"> · Business OS</span>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;color:#f4f4f5;font-size:20px;">${headline}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:#cbd5e1;font-size:14px;line-height:1.6;">
          ${bodyHtml}
          ${button}
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #24242e;color:#6b7280;font-size:12px;">
        You received this email because someone at TapasHub added your address. If you weren't expecting it, you can ignore this message.
      </td></tr>
    </table>
  </body></html>`;
}

/** Invite a staff member to sign in and join the workspace. */
export function sendUserInviteEmail(args: {
  to: string;
  name?: string | null;
  roleLabel: string;
  inviterName?: string | null;
  companyNames?: string[];
}): Promise<SendResult> {
  const greeting = args.name ? `Hi ${esc(args.name)},` : "Hi there,";
  const who = args.inviterName ? `${esc(args.inviterName)} has` : "You've been";
  const companies = args.companyNames && args.companyNames.length
    ? `<tr><td style="padding:4px 0;">Companies: <strong style="color:#f4f4f5;">${esc(args.companyNames.join(", "))}</strong></td></tr>`
    : "";
  const url = appUrl();
  const body = `
    <tr><td style="padding:4px 0 12px;">${greeting}</td></tr>
    <tr><td style="padding:4px 0;">${who} invited to join the <strong style="color:#f4f4f5;">TapasHub</strong> workspace as <strong style="color:#f4f4f5;">${esc(args.roleLabel)}</strong>.</td></tr>
    ${companies}
    <tr><td style="padding:12px 0;">Sign in with the Google account tied to <strong style="color:#f4f4f5;">${esc(args.to)}</strong> to activate your access.</td></tr>`;
  return send({
    to: args.to,
    subject: "You've been invited to TapasHub",
    html: layout("You're invited to TapasHub", body, url ? { label: "Sign in to TapasHub", url } : undefined),
  });
}

/** Send a full AI executive report email (wider layout, plain-text fallback). */
export function sendExecutiveReportEmail(args: { to: string; subject: string; html: string }): Promise<SendResult> {
  return send({ to: args.to, subject: args.subject, html: args.html });
}

/** Notify a shareholder that they've been added, with a link to the portal. */
export function sendShareholderInviteEmail(args: {
  to: string;
  name?: string | null;
  companyName: string;
  shares: number;
  ownershipPercent: number;
}): Promise<SendResult> {
  const greeting = args.name ? `Hi ${esc(args.name)},` : "Hi there,";
  const url = appUrl();
  const pct = args.ownershipPercent > 0 ? `${args.ownershipPercent.toFixed(2)}%` : "—";
  const body = `
    <tr><td style="padding:4px 0 12px;">${greeting}</td></tr>
    <tr><td style="padding:4px 0;">You've been recorded as a shareholder of <strong style="color:#f4f4f5;">${esc(args.companyName)}</strong> on TapasHub.</td></tr>
    <tr><td style="padding:8px 0;">Shares held: <strong style="color:#f4f4f5;">${esc(args.shares.toLocaleString("en-IN"))}</strong> &nbsp;·&nbsp; Ownership: <strong style="color:#f4f4f5;">${pct}</strong></td></tr>
    <tr><td style="padding:8px 0;">If you have a TapasHub account, sign in with <strong style="color:#f4f4f5;">${esc(args.to)}</strong> to view your holding.</td></tr>`;
  return send({
    to: args.to,
    // Strip CR/LF so a company name can never inject extra email headers.
    subject: `You've been added as a shareholder of ${args.companyName}`.replace(/[\r\n]+/g, " "),
    html: layout("Your shareholding on TapasHub", body, url ? { label: "Open TapasHub", url } : undefined),
  });
}
