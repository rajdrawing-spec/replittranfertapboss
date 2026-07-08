import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function token(ctx: AdapterContext) {
  return ctx.secrets[secretEnvName("delhivery", ctx.connection.companyId, "API_TOKEN")];
}

export const delhiveryAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const t = token(ctx);
    if (!t) return { ok: false, health: "down", message: "Delhivery API_TOKEN is required." };
    try {
      // Delhivery ping endpoint
      const res = await fetch("https://track.delhivery.com/api/p/client?format=json", {
        headers: { Authorization: `Token ${t}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, health: "down", message: "Invalid Delhivery API token." };
      if (!res.ok) return { ok: false, health: "degraded", message: `Delhivery API responded ${res.status}.` };
      return { ok: true, health: "healthy", message: "Connected to Delhivery." };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Delhivery connection failed." };
    }
  },

  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const t = token(ctx);
    if (!t) return { status: "skipped", recordsSynced: 0, message: "Delhivery credentials not configured." };
    try {
      const res = await fetch("https://track.delhivery.com/api/p/packing_slip?format=json&count=100", {
        headers: { Authorization: `Token ${t}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Delhivery API ${res.status}`);
      const body = await res.json() as { objects?: any[] };
      const items = body.objects ?? [];
      return {
        status: "success",
        recordsSynced: items.length,
        message: `Synced ${items.length} Delhivery shipment(s).`,
      };
    } catch (e) {
      return { status: "failed", recordsSynced: 0, message: e instanceof Error ? e.message : "Delhivery sync failed." };
    }
  },
};
