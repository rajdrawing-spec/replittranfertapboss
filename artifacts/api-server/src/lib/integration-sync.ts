import { db } from "@workspace/db";
import {
  integrationConnectionsTable,
  integrationSyncHistoryTable,
  integrationErrorLogsTable,
  type IntegrationConnection,
} from "@workspace/db";
import { and, eq, lt, or, isNull } from "drizzle-orm";
import { getAdapter, type AdapterContext } from "./integration-adapters";
import { logger } from "./logger";

function resolveSecrets(refs: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const r of refs) out[r] = process.env[r];
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
  const ctx: AdapterContext = { connection, secrets: resolveSecrets(connection.secretRefs ?? []) };
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

const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let schedulerHandle: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // never overlap runs
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
      try {
        await runSync(conn, "scheduled");
      } catch (e) {
        logger.error({ err: e, connectionId: conn.id }, "Scheduled integration sync failed");
      }
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
  // Check every 5 minutes for connections due for their 15-minute auto-sync.
  schedulerHandle = setInterval(() => { void tick(); }, 5 * 60 * 1000);
  logger.info("Integration auto-sync scheduler started");
}
