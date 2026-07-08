/**
 * Amazon Selling Partner API adapter.
 * Uses Login with Amazon (LWA) OAuth2 with a refresh token.
 * The user must have an SP-API developer account and a registered app.
 */
import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const id = ctx.connection.companyId;
  const clientId = ctx.secrets[secretEnvName("amazon", id, "LWA_CLIENT_ID")];
  const clientSecret = ctx.secrets[secretEnvName("amazon", id, "LWA_CLIENT_SECRET")];
  const refreshToken = ctx.secrets[secretEnvName("amazon", id, "REFRESH_TOKEN")];
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = await res.json() as any;
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error_description ?? body?.error ?? `Amazon LWA auth failed (${res.status})`);
  }
  return body.access_token;
}

export const amazonAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Amazon LWA_CLIENT_ID, LWA_CLIENT_SECRET, and REFRESH_TOKEN are required." };
    try {
      const accessToken = await getLwaToken(c.clientId, c.clientSecret, c.refreshToken);
      // Call the Sellers endpoint to verify marketplace participation
      const res = await fetch("https://sellingpartnerapi-fe.amazon.com/sellers/v1/marketplaceParticipations", {
        headers: { "x-amz-access-token": accessToken, "User-Agent": "TapasHub/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        // 403 can mean IAM role not configured — token is still valid
        if (res.status === 403) return { ok: true, health: "degraded", message: "Amazon token valid but marketplace access restricted — check SP-API IAM role." };
        throw new Error(`Amazon SP-API ${res.status}`);
      }
      return { ok: true, health: "healthy", message: "Connected to Amazon Selling Partner API." };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Amazon connection failed." };
    }
  },

  async sync(_ctx: AdapterContext): Promise<SyncResult> {
    return { status: "skipped", recordsSynced: 0, message: "Amazon SP-API order sync not yet wired — connection verified." };
  },
};
