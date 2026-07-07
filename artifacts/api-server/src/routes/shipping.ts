import { Router } from "express";
import { db } from "@workspace/db";
import { shipmentsTable, insertShipmentSchema, integrationConnectionsTable } from "@workspace/db";
import { eq, and, desc, or, ilike, isNotNull } from "drizzle-orm";
import { getAdapter, type AdapterContext } from "../lib/integration-adapters";
import { getCatalogPlatform } from "../lib/integration-catalog";
import { emitNotification } from "../lib/notify";

const router = Router();

/** Maps a free-text courier name to a catalog integration platformKey, if one exists. */
const COURIER_PLATFORM_KEYS: Record<string, string> = {
  shiprocket: "shiprocket",
  delhivery: "delhivery",
};
function courierPlatformKey(courier: string | null | undefined): string | null {
  if (!courier) return null;
  return COURIER_PLATFORM_KEYS[courier.trim().toLowerCase()] ?? null;
}

function resolveSecrets(refs: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const r of refs) out[r] = process.env[r];
  return out;
}

router.get("/shipments", async (req, res) => {
  try {
    const { companyId, status, q, view } = req.query as Record<string, string>;
    const conds = [];
    if (companyId) conds.push(eq(shipmentsTable.companyId, parseInt(companyId)));
    if (status && status !== "all") conds.push(eq(shipmentsTable.status, status));
    if (view === "returns") {
      conds.push(or(isNotNull(shipmentsTable.returnedAt), eq(shipmentsTable.status, "returned"), eq(shipmentsTable.status, "rto"))!);
    }
    if (q) {
      const like = `%${q}%`;
      conds.push(or(ilike(shipmentsTable.trackingNumber, like), ilike(shipmentsTable.customerName, like), ilike(shipmentsTable.orderNumber, like))!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(shipmentsTable).where(where).orderBy(desc(shipmentsTable.createdAt));
    res.json(rows);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list shipments" }); }
});

router.post("/shipments", async (req, res) => {
  try {
    const parsed = insertShipmentSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const [s] = await db.insert(shipmentsTable).values(parsed.data).returning();
    res.status(201).json(s);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create shipment" }); }
});

router.patch("/shipments/:id", async (req, res) => {
  try {
    const { id: _id, createdAt: _c, updatedAt: _u, companyId: _cid, ...body } = req.body ?? {};
    const [prev] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, parseInt(req.params.id)));
    if (!prev) { res.status(404).json({ error: "Not found" }); return; }
    const [s] = await db.update(shipmentsTable).set({ ...body, updatedAt: new Date() }).where(eq(shipmentsTable.id, parseInt(req.params.id))).returning();
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    if (s.status === "delivered" && prev.status !== "delivered") {
      void emitNotification({
        type: "shipping",
        severity: "success",
        companyId: s.companyId,
        title: "Shipment Delivered",
        message: `Shipment ${s.trackingNumber || s.id} was delivered.`,
        actionUrl: "/shipping",
      });
    }
    res.json(s);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to update shipment" }); }
});

// Mark a shipment as returned — captures returnReason, sets returnedAt & status.
router.post("/shipments/:id/return", async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) { res.status(400).json({ error: "Return reason is required" }); return; }
    const [s] = await db.update(shipmentsTable).set({
      status: "returned",
      returnReason: reason,
      returnedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(shipmentsTable.id, parseInt(req.params.id))).returning();
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    res.json(s);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to mark returned" }); }
});

// Sync tracking/status via the courier's integration connection (honest — no fabrication).
router.post("/shipments/:id/sync-tracking", async (req, res) => {
  try {
    const [s] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.id, parseInt(req.params.id)));
    if (!s) { res.status(404).json({ error: "Not found" }); return; }

    const platformKey = courierPlatformKey(s.courier);
    if (!platformKey) {
      res.json({ ok: false, connected: false, message: `${s.courier} has no tracking integration available yet. Live tracking sync is only supported for couriers with a platform integration.` });
      return;
    }

    const [conn] = await db.select().from(integrationConnectionsTable).where(and(
      eq(integrationConnectionsTable.companyId, s.companyId),
      eq(integrationConnectionsTable.platformKey, platformKey),
    ));
    const label = getCatalogPlatform(platformKey)?.name ?? s.courier;

    if (!conn || conn.status !== "connected") {
      res.json({ ok: false, connected: false, message: `${label} is not connected for this workspace. Connect the ${label} integration first to sync tracking.` });
      return;
    }

    const ctx: AdapterContext = { connection: conn, secrets: resolveSecrets(conn.secretRefs ?? []) };
    const adapter = getAdapter(platformKey);
    const result = await adapter.sync(ctx);

    // Only record a sync timestamp when the courier actually refreshed tracking.
    // Stub adapters return "skipped", so lastSyncedAt stays honest (not updated).
    let shipment = s;
    if (result.status === "success") {
      [shipment] = await db.update(shipmentsTable).set({
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(shipmentsTable.id, s.id)).returning();
    }

    res.json({ ok: result.status === "success", connected: true, status: result.status, message: result.message, shipment });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to sync tracking" }); }
});

router.delete("/shipments/:id", async (req, res) => {
  try {
    const [s] = await db.delete(shipmentsTable).where(eq(shipmentsTable.id, parseInt(req.params.id))).returning();
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete shipment" }); }
});

export default router;
