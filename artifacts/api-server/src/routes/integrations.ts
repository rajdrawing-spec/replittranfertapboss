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
  secretEnvName,
} from "../lib/integration-catalog";
import { getAdapter } from "../lib/integration-adapters";
import { runSync, retestConnection } from "../lib/integration-sync";
import { saveCredentials } from "../lib/credential-store";
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
        res.status(403).json({ error: "You do not have access to this company" }); return;
      }
      const rows = await db.select().from(integrationConnectionsTable)
        .where(eq(integrationConnectionsTable.companyId, filterCompanyId))
        .orderBy(desc(integrationConnectionsTable.updatedAt));
      res.json(rows); return;
    }

    if (scope === null) {
      const rows = await db.select().from(integrationConnectionsTable).orderBy(desc(integrationConnectionsTable.updatedAt));
      res.json(rows); return;
    }
    if (scope.length === 0) { res.json([]); return; }
    const rows = await db.select().from(integrationConnectionsTable)
      .where(inArray(integrationConnectionsTable.companyId, scope))
      .orderBy(desc(integrationConnectionsTable.updatedAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list connections" }); }
});

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

/** Connect (or re-connect) a platform for a company. Accepts inline credentials. */
router.post("/integrations/connections", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = Number(body.companyId);
    const platformKey = typeof body.platformKey === "string" ? body.platformKey : "";
    const authType = body.authType as AuthType;
    const accountHandle = typeof body.accountHandle === "string" ? body.accountHandle.slice(0, 200) : undefined;
    // Inline credentials entered directly in the UI { "ADMIN_API_TOKEN": "...", ... }
    const inlineCreds = body.credentials && typeof body.credentials === "object"
      ? body.credentials as Record<string, string>
      : {};

    if (!Number.isInteger(companyId) || companyId <= 0 || !platformKey || !AUTH_TYPES.includes(authType)) {
      res.status(400).json({ error: "Invalid input" }); return;
    }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "You do not have access to this company" }); return; }
    const platform = getCatalogPlatform(platformKey);
    if (!platform) { res.status(400).json({ error: "Unknown platform" }); return; }

    const refs = requiredSecretRefs(platformKey, companyId);
    const user = (req as any).localUser;

    const base = {
      authType, accountHandle: accountHandle ?? null,
      secretRefs: refs,
      connectedUserId: user?.id ?? null,
      connectedUserName: user?.name ?? null,
      connectedUserEmail: user?.email ?? null,
      updatedAt: new Date(),
    };

    // Upsert the connection row
    const [existing] = await db.select().from(integrationConnectionsTable)
      .where(and(eq(integrationConnectionsTable.companyId, companyId), eq(integrationConnectionsTable.platformKey, platformKey)))
      .limit(1);

    let conn: IntegrationConnection;
    if (existing) {
      [conn] = await db.update(integrationConnectionsTable).set(base).where(eq(integrationConnectionsTable.id, existing.id)).returning();
    } else {
      const defaultSettings = Object.fromEntries(platform.syncFeatures.map((f) => [f, true]));
      [conn] = await db.insert(integrationConnectionsTable).values({
        companyId, platformKey, ...base, syncSettings: defaultSettings, status: "pending", health: "unknown",
      }).returning();
    }

    // Persist inline credentials to the encrypted DB store
    if (Object.keys(inlineCreds).length > 0) {
      const envMap: Record<string, string> = {};
      for (const [logicalKey, value] of Object.entries(inlineCreds)) {
        if (value) envMap[secretEnvName(platformKey, companyId, logicalKey)] = value;
      }
      await saveCredentials(conn.id, companyId, platformKey, envMap);
    }

    // Test and update status
    const { status, health, lastError } = await retestConnection(conn);

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
    } else if (status === "connected") {
      void emitNotification({
        type: "integration", severity: "info", companyId,
        title: "Integration Connected",
        message: `${platform.name} is now connected and syncing.`,
        actionUrl: "/integrations",
      });
    }

    res.status(201).json(conn);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to connect" }); }
});

/** Save / update credentials for an existing connection (re-test after). */
router.post("/integrations/connections/:id/credentials", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const body = (req.body ?? {}) as Record<string, string>;

    // Build env-name keyed map from logical key names in the request
    const envMap: Record<string, string> = {};
    for (const [logicalKey, value] of Object.entries(body)) {
      if (typeof value === "string" && value) {
        envMap[secretEnvName(conn.platformKey, conn.companyId, logicalKey)] = value;
      }
    }
    if (Object.keys(envMap).length === 0) {
      res.status(400).json({ error: "No credentials provided" }); return;
    }

    await saveCredentials(conn.id, conn.companyId, conn.platformKey, envMap);

    const { status, health, lastError } = await retestConnection(conn);
    const [updated] = await db.update(integrationConnectionsTable)
      .set({ status, health, lastError, updatedAt: new Date() })
      .where(eq(integrationConnectionsTable.id, conn.id)).returning();

    if (status === "connected") {
      void emitNotification({
        type: "integration", severity: "info", companyId: conn.companyId,
        title: "Integration Connected",
        message: `${conn.platformKey} credentials verified and connection is live.`,
        actionUrl: "/integrations",
      });
    }
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to save credentials" }); }
});

/** Re-test an existing connection with whatever credentials are currently stored. */
router.post("/integrations/connections/:id/retest", async (req, res) => {
  try {
    const conn = await loadOwned(req, res);
    if (!conn) return;
    const { status, health, lastError } = await retestConnection(conn);
    const [updated] = await db.update(integrationConnectionsTable)
      .set({ status, health, lastError, updatedAt: new Date() })
      .where(eq(integrationConnectionsTable.id, conn.id)).returning();
    res.json(updated);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to retest connection" }); }
});

/**
 * Embed-check: server-side HEAD request to see if a URL allows iframe embedding.
 * Returns { embeddable: boolean, reason: string }.
 * Must be server-side because browsers block reading response headers cross-origin.
 */
router.get("/integrations/embed-check", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : "";
  if (!url || !url.startsWith("https://")) {
    res.status(400).json({ error: "Valid https URL required" }); return;
  }
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TapasHub/1.0)" },
      redirect: "follow",
    });
    const xfo = response.headers.get("x-frame-options") ?? "";
    const csp = response.headers.get("content-security-policy") ?? "";

    const blocked =
      /deny|sameorigin/i.test(xfo) ||
      /frame-ancestors\s+['"](none|self)['"]/i.test(csp) ||
      /frame-ancestors\s+(?!.*\*)/i.test(csp);

    res.json({
      embeddable: !blocked,
      reason: blocked
        ? xfo ? `X-Frame-Options: ${xfo}` : "Content-Security-Policy blocks framing"
        : "No frame restrictions detected",
      xFrameOptions: xfo || null,
      csp: csp ? csp.slice(0, 200) : null,
    });
  } catch (e) {
    // Network error or timeout — assume not embeddable to be safe
    res.json({
      embeddable: false,
      reason: e instanceof Error && e.name === "TimeoutError" ? "Embed check timed out" : `Embed check failed: ${e instanceof Error ? e.message : "network error"}`,
      xFrameOptions: null, csp: null,
    });
  }
});

/** Update connection settings. */
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

/** Disconnect — clears live status but keeps history/logs. */
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

/** Sync now. */
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

/** Sync history. */
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

/** Error logs. */
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
