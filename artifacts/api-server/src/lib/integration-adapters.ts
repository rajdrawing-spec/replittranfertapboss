import type { IntegrationConnection } from "@workspace/db";
import { getCatalogPlatform } from "./integration-catalog";

export interface AdapterContext {
  connection: IntegrationConnection;
  /** Resolved credential values, keyed by env var name. Present only when set. */
  secrets: Record<string, string | undefined>;
}

export interface TestResult {
  ok: boolean;
  health: "healthy" | "degraded" | "down";
  message: string;
}

export interface SyncResult {
  status: "success" | "skipped" | "failed";
  recordsSynced: number;
  message: string;
}

export interface IntegrationAdapter {
  testConnection(ctx: AdapterContext): Promise<TestResult>;
  sync(ctx: AdapterContext): Promise<SyncResult>;
}

/**
 * Default stub adapter used until a provider's real API client is implemented.
 * It performs NO fabrication: it never invents synced records. It only reports
 * whether credentials are present and marks syncs as "skipped" so history stays
 * honest.
 */
function makeStubAdapter(platformKey: string): IntegrationAdapter {
  const label = getCatalogPlatform(platformKey)?.name ?? platformKey;
  return {
    async testConnection(ctx) {
      const refs = ctx.connection.secretRefs ?? [];
      const missing = refs.filter((r) => !ctx.secrets[r]);
      if (refs.length > 0 && missing.length === 0) {
        return { ok: true, health: "healthy", message: `${label} credentials detected. Live sync is not implemented yet.` };
      }
      return {
        ok: false,
        health: "unknown" as never,
        message: `Awaiting credentials for ${label}: ${missing.join(", ") || "none configured"}.`,
      };
    },
    async sync() {
      return { status: "skipped", recordsSynced: 0, message: `Live API for ${label} is not wired yet — nothing synced.` };
    },
  };
}

/**
 * Real per-provider adapters register here as their APIs are implemented.
 * Anything not registered falls back to the honest stub adapter.
 */
const REGISTRY: Record<string, IntegrationAdapter> = {};

export function getAdapter(platformKey: string): IntegrationAdapter {
  return REGISTRY[platformKey] ?? makeStubAdapter(platformKey);
}

export function registerAdapter(platformKey: string, adapter: IntegrationAdapter): void {
  REGISTRY[platformKey] = adapter;
}
