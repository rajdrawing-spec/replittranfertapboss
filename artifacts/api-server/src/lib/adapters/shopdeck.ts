import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function apiKey(ctx: AdapterContext) {
  return ctx.secrets[secretEnvName("shopdeck", ctx.connection.companyId, "API_KEY")];
}

export const shopdeckAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const key = apiKey(ctx);
    if (!key) return { ok: false, health: "down", message: "Shopdeck API_KEY is required." };
    try {
      // Shopdeck public API: GET /api/v1/store-details
      const res = await fetch("https://api.shopdeck.com/api/v1/store-details", {
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, health: "down", message: "Invalid Shopdeck API key." };
      if (!res.ok) return { ok: false, health: "degraded", message: `Shopdeck API responded ${res.status}.` };
      const body = await res.json() as any;
      return { ok: true, health: "healthy", message: `Connected to Shopdeck store: ${body?.storeName ?? "verified"}.` };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Shopdeck connection failed." };
    }
  },

  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const key = apiKey(ctx);
    if (!key) return { status: "skipped", recordsSynced: 0, message: "Shopdeck credentials not configured." };
    try {
      const res = await fetch("https://api.shopdeck.com/api/v1/orders?limit=100&page=1", {
        headers: { "x-api-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Shopdeck orders API ${res.status}`);
      const body = await res.json() as any;
      const orders = body?.orders ?? body?.data ?? [];
      return {
        status: "success",
        recordsSynced: Array.isArray(orders) ? orders.length : 0,
        message: `Synced ${Array.isArray(orders) ? orders.length : 0} Shopdeck order(s).`,
      };
    } catch (e) {
      return { status: "failed", recordsSynced: 0, message: e instanceof Error ? e.message : "Shopdeck sync failed." };
    }
  },
};
