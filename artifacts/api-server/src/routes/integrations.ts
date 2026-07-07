import { Router } from "express";
import { db } from "@workspace/db";
import {
  integrationConnectionsTable,
  integrationSyncHistoryTable,
  integrationErrorLogsTable,
  type IntegrationConnection,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { companyScope, canAccessCompany } from "../lib/company-scope";
import {
  INTEGRATION_CATALOG,
  getCatalogPlatform,
  requiredSecretRefs,
  missingSecretRefs,
} from "../lib/integration-catalog";
import { getAdapter } from "../lib/integration-adapters";
import { runSync } from "../lib/integration-sync";
import { emitNotification } from "../lib/notify";

const router = Router();

/** Catalog — static metadata that drives the UI. */
router.get("/integrations/catalog", (_req, res) => {
  res.json(INTEGRATION_CATALOG);
});

/** List connections, scoped to companies the caller may see. */
router.get("/integrations/connections", async (req, res) => {
  try {
    const scope = companyScope(req);
    const filterCompanyId = req.query.companyId ? parseInt(String(req.query.companyId), 10) : undefined;

    if (filterCompanyId !== undefined) {
      if (Number.isNaN(filterCompanyId) || !canAccessCompany(req, filterCompanyId)) {
        res.status(403).json({ error: "You do not have access to this company" });
        return;
      }
      const rows = await db.select().from(integrationConnectionsTable)
        .where(eq(integrationConnectionsTable.companyId, filterCompanyId))
        .orderBy(desc(integrationConnectionsTable.updatedAt));
      res.json(rows);
      return;
    }

    // No company filter: Super Admin sees all; scoped staff see only their companies.
    if (scope === null) {
      const rows = await db.select().from(integrationConnectionsTable).orderBy(desc(integrationConnectionsTable.updatedAt));
      res.json(rows);
      return;
    }
    if (scope.length === 0) { res.json([]); return; }
    const rows = await db.select().from(integrationConnectionsTable)
      .where(inArray(integrationConnectionsTable.companyId, scope))
      .orderBy(desc(integrationConnectionsTable.updatedAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list connections" }); }
});

/** Load a connection and verify the caller may access its company. */
async function loadOwned(req: any, res: any): Promise<IntegrationConnection | null> {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
  const [conn] = await db.select().from(integrationConnectionsTable).where(eq(integrationConnectionsTable.id, id)).limit(1);
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return null; }
  if (!canAccessCompany(req, conn.companyId)) { res.status(403).json({ error: "Forbidden" }); return null; }
  return conn;
}

const AUTH_TYPES = ["oauth", "api_key", "webhook", "manual"] as const;
type AuthType = (typeof AUTH_TYPES)[number];

/** Connect (or re-connect) a platform for a company. */
router.post("/integrations/connections", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = Number(body.companyId);
    const platformKey = typeof body.platformKey === "string" ? body.platformKey : "";
    const authType = body.authType as AuthType;
    const accountHandle = typeof body.accountHandle === "string" ? body.accountHandle.slice(0, 200) : undefined;
    if (!Number.isInteger(companyId) || companyId <= 0 || !platformKey || !AUTH_TYPES.includes(authType)) {
      res.status(400).json({ error: "Invalid input" }); return;
    }

    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "You do not have access to this company" }); return; }
    const platform = getCatalogPlatform(platformKey);
    if (!platform) { res.status(400).json({ error: "Unknown platform" }); return; }

    const refs = requiredSecretRefs(platformKey, companyId);
    const missing = missingSecretRefs(refs);
    const user = (req as any).localUser;

    // Determine live status honestly: connected only when all credentials exist
    // AND the adapter's test passes. Otherwise pending, with a clear reason.
    let status = "pending";
    let health = "unknown";
    let lastError: string | null = null;

    const base = {
      authType, accountHandle: accountHandle ?? null,
      secretRefs: refs,
      connectedUserId: user?.id ?? null,
      connectedUserName: user?.name ?? null,
      connectedUserEmail: user?.email ?? null,
      updatedAt: new Date(),
    };

    // Upsert the connection first so testConnection has a row to reference.
    const [existing] = await db.select().from(integrationConnectionsTable)
      .where(and(eq(integrationConnectionsTable.companyId, companyId), eq(integrationConnectionsTable.platformKey, platformKey)))
      .limit(1);

    let conn: IntegrationConnection;
    if (existing) {
      [conn] = await db.update(integrationConnectionsTable).set(base).where(eq(integrationConnectionsTable.id, existing.id)).returning();
    } else {
      const defaultSettings = Object.fromEntries(platform.syncFeatures.map((f) => [f, true]));
      [conn] = await db.insert(integrationConnectionsTable).values({
        companyId, platformKey, ...base, syncSettings: defaultSettings, status, health,
      }).returning();
    }

    if (missing.length > 0) {
      lastError = `Awaiting credentials. Add these secrets to activate: ${missing.join(", ")}`;
    } else {
      const test = await getAdapter(platformKey).testConnection({ connection: conn, secrets: Object.fromEntries(refs.map((r) => [r, process.env[r]])) });
      if (test.ok) { status = "connected"; health = test.health; }
      else { status = "error"; health = "down"; lastError = test.message; }
    }

    [conn] = await db.update(integrationConnectionsTable)
      .set({ status, health, lastError, updatedAt: new Date() })
      .where(eq(integrationConnectionsTable.id, conn.id)).returning();

    if (lastError && status !== "connected") {
      await db.insert(integrationErrorLogsTable).values({
        connectionId: conn.id, companyId, platformKey,
        level: status === "error" ? "error" : "warning",
        message: status === "error" ? "Connection test failed" : "Credentials required",
        detail: lastError,
      });
    }

    res.status(201).json(conn);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to connect" }); }
});

/** Update connection settings (auto-sync toggle, per-feature sync toggles, handle). */
router.patch("/integrations/connections/:id", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<typeof integrationConnectionsTable.$inferInsert> = {};
    if (typeof body.autoSync === "boolean") patch.autoSync = body.autoSync;
    if (body.accountHandle === null || typeof body.accountHandle === "string") {
      patch.accountHandle = body.accountHandle === null ? null : String(body.accountHandle).slice(0, 200);
    }
    if (body.syncSettings && typeof body.syncSettings === "object") {
      const raw = body.syncSettings as Record<string, unknown>;
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") clean[k] = v;
      patch.syncSettings = clean;
    }
    const [updated] = await db.update(integrationConnectionsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(integrationConnectionsTable.id, conn.id)).returning();
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update connection" }); }
});

/** Disconnect — clears live status and auto-sync but keeps history/logs. */
router.post("/integrations/connections/:id/disconnect", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const [updated] = await db.update(integrationConnectionsTable).set({
      status: "disconnected", health: "unknown", autoSync: false, lastError: null,
      connectedUserId: null, connectedUserName: null, connectedUserEmail: null,
      updatedAt: new Date(),
    }).where(eq(integrationConnectionsTable.id, conn.id)).returning();
    void emitNotification({
      type: "integration", severity: "warning", companyId: conn.companyId,
      title: "API Disconnected",
      message: `${conn.platformKey} was disconnected and will no longer sync.`,
      actionUrl: "/integrations",
    });
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to disconnect" }); }
});

/** Sync now — run the adapter immediately and record the attempt. */
router.post("/integrations/connections/:id/sync", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    if (conn.status === "disconnected") { res.status(409).json({ error: "Connect the platform before syncing" }); return; }
    const result = await runSync(conn, "manual");
    const [fresh] = await db.select().from(integrationConnectionsTable).where(eq(integrationConnectionsTable.id, conn.id)).limit(1);
    res.json({ result, connection: fresh });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to sync" }); }
});

/** Sync history for a connection. */
router.get("/integrations/connections/:id/history", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const rows = await db.select().from(integrationSyncHistoryTable)
      .where(eq(integrationSyncHistoryTable.connectionId, conn.id))
      .orderBy(desc(integrationSyncHistoryTable.createdAt)).limit(50);
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load history" }); }
});

/** Error logs for a connection. */
router.get("/integrations/connections/:id/errors", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const rows = await db.select().from(integrationErrorLogsTable)
      .where(eq(integrationErrorLogsTable.connectionId, conn.id))
      .orderBy(desc(integrationErrorLogsTable.createdAt)).limit(50);
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load error logs" }); }
});

export default router;
