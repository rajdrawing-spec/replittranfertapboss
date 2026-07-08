import { db } from "@workspace/db";
import {
  integrationConnectionsTable,
  integrationSyncHistoryTable,
  integrationErrorLogsTable,
  type IntegrationConnection,
} from "@workspace/db";
import { and, eq, lt, or, isNull } from "drizzle-orm";
import { getAdapter, type AdapterContext } from "./integration-adapters";
import { loadCredentials } from "./credential-store";
import { logger } from "./logger";

/**
 * Resolve secrets for a connection: DB-stored credentials (entered via UI)
 * take priority over process.env (manually set Replit Secrets), so moving a
 * credential from env to the UI doesn't require a server restart.
 */
async function resolveSecrets(
  connectionId: number,
  refs: string[],
): Promise<Record<string, string | undefined>> {
  // Start with env vars (legacy path — still works for secrets set manually)
  const out: Record<string, string | undefined> = {};
  for (const r of refs) out[r] = process.env[r];

  // Overlay with DB-stored credentials (from the Connect modal UI)
  try {
    const dbCreds = await loadCredentials(connectionId);
    for (const [k, v] of Object.entries(dbCreds)) out[k] = v;
  } catch (e) {
    logger.warn({ err: e, connectionId }, "Failed to load DB credentials for connection");
  }
  return out;
}

/**
 * Run a single sync for a connection, writing a history row and updating the
 * connection's last-sync state. On failure also writes an error-log row.
 */
export async function runSync(
  connection: IntegrationConnection,
  trigger: "manual" | "scheduled",
): Promise<{ status: string; recordsSynced: number; message: string }> {
  const started = Date.now();
  const secrets = await resolveSecrets(connection.id, connection.secretRefs ?? []);
  const ctx: AdapterContext = { connection, secrets };
  const adapter = getAdapter(connection.platformKey);

  let status = "failed";
  let recordsSynced = 0;
  let message = "";
  try {
    const result = await adapter.sync(ctx);
    status = result.status;
    recordsSynced = result.recordsSynced;
    message = result.message;
  } catch (e) {
    status = "failed";
    message = e instanceof Error ? e.message : "Unknown sync error";
  }
  const durationMs = Date.now() - started;

  await db.insert(integrationSyncHistoryTable).values({
    connectionId: connection.id,
    companyId: connection.companyId,
    platformKey: connection.platformKey,
    trigger,
    status,
    recordsSynced,
    durationMs,
    message,
  });

  await db.update(integrationConnectionsTable).set({
    lastSyncAt: new Date(),
    lastSyncStatus: status,
    lastError: status === "failed" ? message : null,
    status: status === "failed" ? "error" : connection.status,
    updatedAt: new Date(),
  }).where(eq(integrationConnectionsTable.id, connection.id));

  if (status === "failed") {
    await db.insert(integrationErrorLogsTable).values({
      connectionId: connection.id,
      companyId: connection.companyId,
      platformKey: connection.platformKey,
      level: "error",
      message: "Sync failed",
      detail: message,
    });
  }

  return { status, recordsSynced, message };
}

/** Re-test a connection using the latest credentials (env + DB). */
export async function retestConnection(connection: IntegrationConnection): Promise<{
  status: string; health: string; lastError: string | null;
}> {
  const refs = connection.secretRefs ?? [];
  const secrets = await resolveSecrets(connection.id, refs);
  const adapter = getAdapter(connection.platformKey);

  // Check if any credential at all is present
  const hasAnyCred = Object.values(secrets).some(Boolean);
  if (refs.length > 0 && !hasAnyCred) {
    return { status: "pending", health: "unknown", lastError: "No credentials configured. Enter your API credentials to activate this connection." };
  }

  try {
    const test = await adapter.testConnection({ connection, secrets });
    if (test.ok) return { status: "connected", health: test.health, lastError: null };
    return { status: "error", health: test.health, lastError: test.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Connection test failed";
    return { status: "error", health: "down", lastError: msg };
  }
}

const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let schedulerHandle: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const cutoff = new Date(Date.now() - AUTO_SYNC_INTERVAL_MS);
    const due = await db
      .select()
      .from(integrationConnectionsTable)
      .where(and(
        eq(integrationConnectionsTable.autoSync, true),
        eq(integrationConnectionsTable.status, "connected"),
        or(isNull(integrationConnectionsTable.lastSyncAt), lt(integrationConnectionsTable.lastSyncAt, cutoff)),
      ));
    for (const conn of due) {
      try { await runSync(conn, "scheduled"); }
      catch (e) { logger.error({ err: e, connectionId: conn.id }, "Scheduled integration sync failed"); }
    }
  } catch (e) {
    logger.error({ err: e }, "Integration scheduler tick failed");
  } finally {
    running = false;
  }
}

/** Start the background auto-sync scheduler (idempotent). */
export function startIntegrationScheduler(): void {
  if (schedulerHandle) return;
  schedulerHandle = setInterval(() => { void tick(); }, 5 * 60 * 1000);
  logger.info("Integration auto-sync scheduler started");
}
