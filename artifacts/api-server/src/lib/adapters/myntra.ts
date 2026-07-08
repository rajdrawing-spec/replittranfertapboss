import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const id = ctx.connection.companyId;
  const key = ctx.secrets[secretEnvName("myntra", id, "API_KEY")];
  const secret = ctx.secrets[secretEnvName("myntra", id, "API_SECRET")];
  return key && secret ? { key, secret } : null;
}

export const myntraAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Myntra API_KEY and API_SECRET are required." };
    try {
      // Myntra Partner API — test with inventory endpoint
      const auth = Buffer.from(`${c.key}:${c.secret}`).toString("base64");
      const res = await fetch("https://api.myntra.com/v2/inventory/get", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ skuList: [] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, health: "down", message: "Invalid Myntra credentials." };
      // 200 or 400 (empty sku list) means auth passed
      if (res.ok || res.status === 400) return { ok: true, health: "healthy", message: "Connected to Myntra Partner API." };
      return { ok: false, health: "degraded", message: `Myntra API responded ${res.status}.` };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Myntra connection failed." };
    }
  },

  async sync(_ctx: AdapterContext): Promise<SyncResult> {
    return { status: "skipped", recordsSynced: 0, message: "Myntra order sync not yet wired — connection verified." };
  },
};
