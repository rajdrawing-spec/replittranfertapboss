import { Router } from "express";
import { db } from "@workspace/db";
import {
  shareholdersTable,
  shareTransactionsTable,
  companiesTable,
  insertShareholderSchema,
  insertShareTransactionSchema,
} from "@workspace/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { companyScope, canAccessCompany } from "../lib/company-scope";
import { writeAudit } from "../lib/audit";
import { sendShareholderInviteEmail } from "../lib/email";

const router = Router();

/**
 * Recompute every shareholder's ownership percentage for a company from the
 * company's total issued shares. Runs inside the caller's transaction so the
 * cap table is always internally consistent after any holding change.
 */
async function recomputeOwnership(tx: any, companyId: number): Promise<void> {
  const holders = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.companyId, companyId));
  const totalShares = holders.reduce((s: number, h: any) => s + (h.shares ?? 0), 0);
  for (const h of holders) {
    const pct = totalShares > 0 ? (h.shares / totalShares) * 100 : 0;
    if (Math.abs((h.ownershipPercent ?? 0) - pct) > 0.0001) {
      await tx.update(shareholdersTable).set({ ownershipPercent: pct, updatedAt: new Date() }).where(eq(shareholdersTable.id, h.id));
    }
  }
}

function actor(req: any) {
  const u = req.localUser;
  return { id: u?.id ?? null, email: u?.email ?? null };
}

// Allowed domain values. drizzle-zod only checks types, so enum/range rules are
// enforced here to keep equity data from being silently corrupted.
const HOLDER_TYPES = ["individual", "entity"];
const HOLDER_ROLES = ["founder", "investor", "employee", "advisor", "institutional"];
const HOLDER_STATUS = ["active", "exited"];
const TX_TYPES = ["purchase", "sale", "grant", "dividend", "transfer"];

/** Validate shareholder fields. `partial` skips presence checks for PATCH. */
function validateHolder(b: Record<string, unknown>, partial: boolean): string | null {
  const numFields: [string, boolean][] = [["shares", true], ["sharePrice", false], ["investmentAmount", false]];
  for (const [f, mustBeInt] of numFields) {
    if (f in b && b[f] !== undefined && b[f] !== null) {
      const v = Number(b[f]);
      if (!Number.isFinite(v) || v < 0) return `${f} must be a non-negative number`;
      if (mustBeInt && !Number.isInteger(v)) return `${f} must be a whole number`;
    }
  }
  if (b.type !== undefined && !HOLDER_TYPES.includes(String(b.type))) return "Invalid holder type";
  if (b.role !== undefined && !HOLDER_ROLES.includes(String(b.role))) return "Invalid role";
  if (b.status !== undefined && !HOLDER_STATUS.includes(String(b.status))) return "Invalid status";
  if (!partial && !String(b.name ?? "").trim()) return "Name is required";
  return null;
}

// GET /shareholders — list holdings the caller may see. Optional ?companyId=.
router.get("/shareholders", requirePermission("shareholders.view"), async (req, res) => {
  try {
    const scope = companyScope(req);
    const { companyId } = req.query as Record<string, string>;
    const conditions: any[] = [];

    if (companyId) {
      const cid = parseInt(companyId);
      if (!canAccessCompany(req, cid)) { res.status(403).json({ error: "Forbidden" }); return; }
      conditions.push(eq(shareholdersTable.companyId, cid));
    } else if (scope !== null) {
      if (scope.length === 0) { res.json([]); return; }
      conditions.push(inArray(shareholdersTable.companyId, scope));
    }

    const rows = await db
      .select()
      .from(shareholdersTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(shareholdersTable.shares));

    const companyNames = await companyNameMap(rows.map((r) => r.companyId));
    res.json(rows.map((r) => formatShareholder(r, companyNames)));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list shareholders" });
  }
});

// GET /shareholders/cap-table?companyId= — equity breakdown + valuation.
router.get("/shareholders/cap-table", requirePermission("shareholders.view"), async (req, res) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
    const cid = parseInt(companyId);
    if (!canAccessCompany(req, cid)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, cid));
    if (!company) { res.status(404).json({ error: "Company not found" }); return; }

    const holders = await db.select().from(shareholdersTable).where(eq(shareholdersTable.companyId, cid)).orderBy(desc(shareholdersTable.shares));
    const totalShares = holders.reduce((s, h) => s + (h.shares ?? 0), 0);
    // Company valuation = total issued shares × the latest (highest) share price
    // any holder paid. Falls back to 0 when no priced shares exist.
    const latestPrice = holders.reduce((p, h) => Math.max(p, h.sharePrice ?? 0), 0);
    const valuation = totalShares * latestPrice;
    const totalInvested = holders.reduce((s, h) => s + (h.investmentAmount ?? 0), 0);

    res.json({
      companyId: cid,
      companyName: company.name,
      totalShares,
      pricePerShare: latestPrice,
      valuation,
      totalInvested,
      shareholderCount: holders.length,
      holders: holders.map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
        type: h.type,
        shares: h.shares,
        ownershipPercent: h.ownershipPercent,
        investmentAmount: h.investmentAmount,
        // Equity value = the holder's slice of the current company valuation.
        equityValue: totalShares > 0 ? (h.shares / totalShares) * valuation : 0,
        status: h.status,
      })),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to build cap table" });
  }
});

// GET /shareholders/:id — profile + investment history.
router.get("/shareholders/:id", requirePermission("shareholders.view"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [h] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
    if (!h) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, h.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const history = await db
      .select()
      .from(shareTransactionsTable)
      .where(eq(shareTransactionsTable.shareholderId, id))
      .orderBy(desc(shareTransactionsTable.date), desc(shareTransactionsTable.id));

    const names = await companyNameMap([h.companyId]);
    res.json({ ...formatShareholder(h, names), history: history.map(formatShareTx) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get shareholder" });
  }
});

// POST /shareholders — add a holder.
router.post("/shareholders", requirePermission("shareholders.manage"), async (req, res) => {
  try {
    const parsed = insertShareholderSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
    const vErr = validateHolder(req.body ?? {}, false);
    if (vErr) { res.status(400).json({ error: vErr }); return; }
    if (!canAccessCompany(req, parsed.data.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(shareholdersTable).values(parsed.data).returning();
      await recomputeOwnership(tx, row.companyId);
      const [fresh] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, row.id));
      return fresh;
    });

    void writeAudit({
      ...actor(req),
      action: "shareholder.created",
      targetType: "shareholder",
      targetId: String(created.id),
      description: `Added shareholder ${created.name}`,
      metadata: { companyId: created.companyId, shares: created.shares },
    });

    const names = await companyNameMap([created.companyId]);
    res.status(201).json(formatShareholder(created, names));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create shareholder" });
  }
});

const UPDATABLE = ["name", "email", "type", "role", "shares", "sharePrice", "investmentAmount", "status", "joinedDate", "notes"] as const;

// PATCH /shareholders/:id — edit a holder; recomputes ownership if shares change.
router.patch("/shareholders/:id", requirePermission("shareholders.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const vErr = validateHolder(body, true);
    if (vErr) { res.status(400).json({ error: vErr }); return; }
    const updates: Record<string, unknown> = {};
    for (const f of UPDATABLE) {
      if (f in body && body[f] !== undefined) {
        // Coerce numeric columns so a string like "100" can't reach the DB.
        updates[f] = (f === "shares" || f === "sharePrice" || f === "investmentAmount") && body[f] !== null
          ? Number(body[f])
          : body[f];
      }
    }
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updatable fields provided" }); return; }

    const updated = await db.transaction(async (tx) => {
      await tx.update(shareholdersTable).set({ ...updates, updatedAt: new Date() }).where(eq(shareholdersTable.id, id));
      await recomputeOwnership(tx, existing.companyId);
      const [fresh] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
      return fresh;
    });

    const names = await companyNameMap([updated.companyId]);
    res.json(formatShareholder(updated, names));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update shareholder" });
  }
});

// DELETE /shareholders/:id
router.delete("/shareholders/:id", requirePermission("shareholders.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    await db.transaction(async (tx) => {
      await tx.delete(shareTransactionsTable).where(eq(shareTransactionsTable.shareholderId, id));
      await tx.delete(shareholdersTable).where(eq(shareholdersTable.id, id));
      await recomputeOwnership(tx, existing.companyId);
    });

    void writeAudit({
      ...actor(req),
      action: "shareholder.deleted",
      targetType: "shareholder",
      targetId: String(id),
      description: `Removed shareholder ${existing.name}`,
      metadata: { companyId: existing.companyId },
    });

    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete shareholder" });
  }
});

// POST /shareholders/:id/invite — email the shareholder about their holding.
router.post("/shareholders/:id/invite", requirePermission("shareholders.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!existing.email) { res.status(400).json({ error: "This shareholder has no email address" }); return; }

    const names = await companyNameMap([existing.companyId]);
    const mail = await sendShareholderInviteEmail({
      to: existing.email,
      name: existing.name,
      companyName: names[existing.companyId] ?? "your company",
      shares: existing.shares,
      ownershipPercent: existing.ownershipPercent,
    });
    // Best-effort: log the failure but always stamp invitedAt so the action is
    // recorded regardless of email delivery. The client receives emailSent=false
    // and can show a warning without treating it as a hard error.
    if (!mail.ok) {
      req.log.error({ err: mail.error }, "Shareholder invite email failed to send");
    }

    const [updated] = await db.update(shareholdersTable)
      .set({ invitedAt: new Date(), updatedAt: new Date() })
      .where(eq(shareholdersTable.id, id)).returning();

    void writeAudit({
      ...actor(req),
      action: "shareholder.invited",
      targetType: "shareholder",
      targetId: String(id),
      description: `Shareholder invite attempted to ${existing.email} (emailSent=${mail.ok})`,
      metadata: { companyId: existing.companyId },
    });

    res.json({ ...formatShareholder(updated, names), emailSent: mail.ok, emailError: mail.ok ? undefined : mail.error });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to send invite" });
  }
});

// POST /shareholders/:id/transactions — record an investment/share event and
// fold it into the holder's position, then recompute the cap table.
router.post("/shareholders/:id/transactions", requirePermission("shareholders.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    // Canonicalize the event server-side — never trust client-supplied signs.
    const type = String(req.body?.type ?? "");
    if (!TX_TYPES.includes(type)) { res.status(400).json({ error: "Invalid transaction type" }); return; }
    const rawShares = Number(req.body?.shares);
    const rawAmount = Number(req.body?.amount);
    const rawPrice = Number(req.body?.pricePerShare);
    const shareMag = Number.isFinite(rawShares) ? Math.abs(Math.trunc(rawShares)) : 0;
    const amountMag = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
    const isCashOnly = type === "dividend";
    // A sale removes shares; every other share-moving event adds them. Dividends
    // never move shares. Amount magnitude is always non-negative; direction is
    // derived from the type, so a "sale" can never inflate a holding.
    const signedShares = isCashOnly ? 0 : type === "sale" ? -shareMag : shareMag;
    if (!isCashOnly && signedShares === 0 && amountMag === 0) {
      res.status(400).json({ error: "Enter a share count or an amount" }); return;
    }

    const parsed = insertShareTransactionSchema.safeParse({
      shareholderId: id,
      companyId: existing.companyId,
      type,
      shares: signedShares,
      pricePerShare: price,
      amount: amountMag,
      date: String(req.body?.date ?? "").trim() || new Date().toISOString().slice(0, 10),
      note: req.body?.note ? String(req.body.note) : null,
    });
    if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

    const result = await db.transaction(async (tx) => {
      // Re-read the holding INSIDE the transaction with a row lock so concurrent
      // transactions can't compute from a stale balance and lose an update.
      const [locked] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, id)).for("update").limit(1);
      const [txRow] = await tx.insert(shareTransactionsTable).values(parsed.data).returning();
      if (!isCashOnly && locked) {
        const nextShares = Math.max(0, (locked.shares ?? 0) + signedShares);
        // Invested capital rises on buy-in/grant, falls on sale (never below 0).
        const delta = type === "sale" ? -amountMag : amountMag;
        const nextInvested = Math.max(0, (locked.investmentAmount ?? 0) + delta);
        const nextPrice = price > 0 ? price : locked.sharePrice;
        await tx.update(shareholdersTable).set({
          shares: nextShares,
          investmentAmount: nextInvested,
          sharePrice: nextPrice,
          updatedAt: new Date(),
        }).where(eq(shareholdersTable.id, id));
      }
      await recomputeOwnership(tx, existing.companyId);
      const [fresh] = await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
      return { txRow, fresh };
    });

    const names = await companyNameMap([existing.companyId]);
    res.status(201).json({ transaction: formatShareTx(result.txRow), shareholder: formatShareholder(result.fresh, names) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to record transaction" });
  }
});

async function companyNameMap(ids: number[]): Promise<Record<number, string>> {
  const unique = Array.from(new Set(ids)).filter((n) => Number.isFinite(n));
  if (unique.length === 0) return {};
  const rows = await db.select({ id: companiesTable.id, name: companiesTable.name }).from(companiesTable).where(inArray(companiesTable.id, unique));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

function formatShareholder(h: typeof shareholdersTable.$inferSelect, names: Record<number, string>) {
  return {
    id: h.id,
    companyId: h.companyId,
    companyName: names[h.companyId] ?? "Unknown",
    name: h.name,
    email: h.email,
    type: h.type,
    role: h.role,
    shares: h.shares,
    sharePrice: h.sharePrice,
    investmentAmount: h.investmentAmount,
    ownershipPercent: h.ownershipPercent,
    status: h.status,
    joinedDate: h.joinedDate,
    notes: h.notes,
    invitedAt: h.invitedAt ? h.invitedAt.toISOString() : null,
    createdAt: h.createdAt.toISOString(),
  };
}

function formatShareTx(t: typeof shareTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    shareholderId: t.shareholderId,
    companyId: t.companyId,
    type: t.type,
    shares: t.shares,
    pricePerShare: t.pricePerShare,
    amount: t.amount,
    date: t.date,
    note: t.note,
    createdAt: t.createdAt.toISOString(),
  };
}

export default router;
