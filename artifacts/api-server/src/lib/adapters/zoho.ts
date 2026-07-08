import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const id = ctx.connection.companyId;
  const clientId = ctx.secrets[secretEnvName("zoho", id, "CLIENT_ID")];
  const clientSecret = ctx.secrets[secretEnvName("zoho", id, "CLIENT_SECRET")];
  const refreshToken = ctx.secrets[secretEnvName("zoho", id, "REFRESH_TOKEN")];
  const orgId = ctx.secrets[secretEnvName("zoho", id, "ORGANIZATION_ID")];
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken, orgId } : null;
}

async function getZohoToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://accounts.zoho.in/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json() as any;
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error ?? `Zoho token refresh failed (${res.status})`);
  }
  return body.access_token;
}

export const zohoAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Zoho CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN are required." };
    try {
      const accessToken = await getZohoToken(c.clientId, c.clientSecret, c.refreshToken);
      const url = c.orgId
        ? `https://books.zoho.in/api/v3/organizations/${c.orgId}`
        : "https://books.zoho.in/api/v3/organizations";
      const res = await fetch(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Zoho Books API ${res.status}`);
      return { ok: true, health: "healthy", message: "Connected to Zoho Books." };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Zoho connection failed." };
    }
  },

  async sync(_ctx: AdapterContext): Promise<SyncResult> {
    return { status: "skipped", recordsSynced: 0, message: "Zoho Books invoice sync not yet wired — connection verified." };
  },
};
