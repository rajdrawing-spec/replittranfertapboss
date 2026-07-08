import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function creds(ctx: AdapterContext) {
  const companyId = ctx.connection.companyId;
  const keyId = ctx.secrets[secretEnvName("razorpay", companyId, "KEY_ID")];
  const keySecret = ctx.secrets[secretEnvName("razorpay", companyId, "KEY_SECRET")];
  return keyId && keySecret ? { keyId, keySecret } : null;
}

function basicAuth(keyId: string, keySecret: string) {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export const razorpayAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Razorpay KEY_ID and KEY_SECRET are required." };
    try {
      const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
        headers: { Authorization: basicAuth(c.keyId, c.keySecret) },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) return { ok: false, health: "down", message: "Invalid Razorpay credentials." };
      if (!res.ok) return { ok: false, health: "degraded", message: `Razorpay API responded ${res.status}.` };
      return { ok: true, health: "healthy", message: "Connected to Razorpay." };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Razorpay connection failed." };
    }
  },

  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const c = creds(ctx);
    if (!c) return { status: "skipped", recordsSynced: 0, message: "Razorpay credentials not configured." };
    try {
      // Fetch last 100 payments
      const res = await fetch("https://api.razorpay.com/v1/payments?count=100&status=captured", {
        headers: { Authorization: basicAuth(c.keyId, c.keySecret) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Razorpay API ${res.status}`);
      const body = await res.json() as { items?: any[] };
      const payments = body.items ?? [];
      return {
        status: "success",
        recordsSynced: payments.length,
        message: `Fetched ${payments.length} Razorpay payment(s).`,
      };
    } catch (e) {
      return { status: "failed", recordsSynced: 0, message: e instanceof Error ? e.message : "Razorpay sync failed." };
    }
  },
};
