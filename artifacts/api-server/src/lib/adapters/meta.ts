/**
 * Adapter shared by meta_business, facebook, and instagram.
 * All three use the Meta Graph API with an access token.
 */
import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";

function makeMetaAdapter(platformKey: string, accessTokenSecretKey: string): IntegrationAdapter {
  function token(ctx: AdapterContext) {
    return ctx.secrets[secretEnvName(platformKey, ctx.connection.companyId, accessTokenSecretKey)];
  }

  return {
    async testConnection(ctx: AdapterContext): Promise<TestResult> {
      const t = token(ctx);
      if (!t) return { ok: false, health: "down", message: `${accessTokenSecretKey} is required.` };
      try {
        const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${t}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => ({})) as any;
          return { ok: false, health: "down", message: body?.error?.message ?? "Invalid access token." };
        }
        if (!res.ok) return { ok: false, health: "degraded", message: `Meta Graph API ${res.status}.` };
        const body = await res.json() as any;
        return { ok: true, health: "healthy", message: `Connected as ${body.name ?? body.id}.` };
      } catch (e) {
        return { ok: false, health: "down", message: e instanceof Error ? e.message : "Meta connection failed." };
      }
    },

    async sync(_ctx: AdapterContext): Promise<SyncResult> {
      // Analytics/insights sync requires additional scopes and a dedicated sync pipeline.
      return { status: "skipped", recordsSynced: 0, message: "Meta insights sync requires page/ad-account scope — configure full sync via webhook." };
    },
  };
}

export const metaBusinessAdapter = makeMetaAdapter("meta_business", "ACCESS_TOKEN");
export const facebookAdapter = makeMetaAdapter("facebook", "PAGE_ACCESS_TOKEN");
export const instagramAdapter = makeMetaAdapter("instagram", "ACCESS_TOKEN");
