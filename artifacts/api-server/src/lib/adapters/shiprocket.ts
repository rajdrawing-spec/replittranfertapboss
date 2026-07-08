import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const id = ctx.connection.companyId;
  const email = ctx.secrets[secretEnvName("shiprocket", id, "EMAIL")];
  const password = ctx.secrets[secretEnvName("shiprocket", id, "PASSWORD")];
  return email && password ? { email, password } : null;
}

async function getToken(email: string, password: string): Promise<string> {
  const res = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Shiprocket auth failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const body = await res.json() as { token?: string };
  if (!body.token) throw new Error("Shiprocket did not return an auth token.");
  return body.token;
}

export const shiprocketAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Shiprocket EMAIL and PASSWORD are required." };
    try {
      await getToken(c.email, c.password);
      return { ok: true, health: "healthy", message: "Connected to Shiprocket." };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Shiprocket connection failed." };
    }
  },

  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const c = creds(ctx);
    if (!c) return { status: "skipped", recordsSynced: 0, message: "Shiprocket credentials not configured." };
    try {
      const token = await getToken(c.email, c.password);
      const res = await fetch("https://apiv2.shiprocket.in/v1/external/shipments?per_page=100&page=1", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Shiprocket shipments API ${res.status}`);
      const body = await res.json() as { data?: { data?: any[] } };
      const shipments = body.data?.data ?? [];
      return {
        status: "success",
        recordsSynced: shipments.length,
        message: `Synced ${shipments.length} Shiprocket shipment(s).`,
      };
    } catch (e) {
      return { status: "failed", recordsSynced: 0, message: e instanceof Error ? e.message : "Shiprocket sync failed." };
    }
  },
};
