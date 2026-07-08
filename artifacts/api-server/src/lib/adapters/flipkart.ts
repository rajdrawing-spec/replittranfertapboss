import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const id = ctx.connection.companyId;
  const appId = ctx.secrets[secretEnvName("flipkart", id, "APP_ID")];
  const appSecret = ctx.secrets[secretEnvName("flipkart", id, "APP_SECRET")];
  return appId && appSecret ? { appId, appSecret } : null;
}

export const flipkartAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Flipkart APP_ID and APP_SECRET are required." };
    try {
      // Flipkart Seller API uses Basic auth
      const auth = Buffer.from(`${c.appId}:${c.appSecret}`).toString("base64");
      const res = await fetch("https://api.flipkart.net/sellers/v2/skus/filter", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pageSize: 1, pageNumber: 0 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, health: "down", message: "Invalid Flipkart credentials." };
      // 200 or 204 means auth worked
      if (res.ok || res.status === 204) return { ok: true, health: "healthy", message: "Connected to Flipkart Seller API." };
      return { ok: false, health: "degraded", message: `Flipkart API responded ${res.status}.` };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Flipkart connection failed." };
    }
  },

  async sync(_ctx: AdapterContext): Promise<SyncResult> {
    return { status: "skipped", recordsSynced: 0, message: "Flipkart order sync not yet wired — connection verified." };
  },
};
