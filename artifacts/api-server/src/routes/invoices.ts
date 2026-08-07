import { Router } from "express";
import { db } from "@workspace/db";
import {
  invoicesTable, invoiceItemsTable, invoiceCustomersTable, invoiceSettingsTable,
  companiesTable, productsTable,
} from "@workspace/db";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/authz";
import { companyScope, canAccessCompany } from "../lib/company-scope";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function actor(req: any) {
  const u = req.localUser;
  return { id: u?.id ?? null };
}

/** Recalculate subtotal/taxTotal/total from items and update the invoice row. */
async function recalcInvoice(tx: any, invoiceId: number) {
  const items = await tx.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
  let subtotal = 0, discountTotal = 0, taxTotal = 0;
  for (const it of items) {
    const base = Number(it.quantity) * Number(it.rate);
    const disc = base * (Number(it.discountPercent) / 100);
    const amt = base - disc;
    const tax = amt * (Number(it.taxRate) / 100);
    subtotal += base;
    discountTotal += disc;
    taxTotal += tax;
  }
  const total = subtotal - discountTotal + taxTotal;
  await tx.update(invoicesTable).set({
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    total: Math.round(total * 100) / 100,
    updatedAt: new Date(),
  }).where(eq(invoicesTable.id, invoiceId));
  return { subtotal, discountTotal, taxTotal, total };
}

/** Parse a finite, non-negative number; returns def when invalid. */
function safeNum(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const VALID_TAX_TYPES = ["gst", "igst", "none"];

/** Sanitize a raw line item into validated numeric fields. */
function sanitizeItem(it: any) {
  const qty = safeNum(it.quantity, 1);
  const rate = safeNum(it.rate, 0);
  const discPct = Math.max(0, Math.min(100, safeNum(it.discountPercent, 0)));
  const taxType = VALID_TAX_TYPES.includes(String(it.taxType)) ? String(it.taxType) : "gst";
  const taxRate = taxType === "none" ? 0 : Math.max(0, Math.min(100, safeNum(it.taxRate, 0)));
  const base = qty * rate;
  const disc = base * discPct / 100;
  const amt = base - disc;
  const taxAmt = amt * taxRate / 100;
  return { qty, rate, discPct, taxType, taxRate, amt, taxAmt };
}

/** Verify optional customerId belongs to companyId; returns validated id or undefined. Throws on mismatch. */
async function checkCustomerOwnership(tx: any, customerId: unknown, companyId: number): Promise<number | undefined> {
  if (!customerId) return undefined;
  const id = parseInt(String(customerId));
  if (!Number.isFinite(id)) return undefined;
  const [row] = await tx.select({ id: invoiceCustomersTable.id }).from(invoiceCustomersTable)
    .where(and(eq(invoiceCustomersTable.id, id), eq(invoiceCustomersTable.companyId, companyId)));
  if (!row) throw Object.assign(new Error("Customer not found in this company"), { statusCode: 400 });
  return id;
}

/** Verify optional productId belongs to companyId; returns validated id or undefined. Throws on mismatch. */
async function checkProductOwnership(tx: any, productId: unknown, companyId: number): Promise<number | undefined> {
  if (!productId) return undefined;
  const id = parseInt(String(productId));
  if (!Number.isFinite(id)) return undefined;
  const [row] = await tx.select({ id: productsTable.id }).from(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.companyId, companyId)));
  if (!row) throw Object.assign(new Error("Product not found in this company"), { statusCode: 400 });
  return id;
}

/** Get-or-create invoice settings for a company. */
async function getSettings(companyId: number) {
  const [existing] = await db.select().from(invoiceSettingsTable).where(eq(invoiceSettingsTable.companyId, companyId));
  if (existing) return existing;
  const [created] = await db.insert(invoiceSettingsTable).values({ companyId }).returning();
  return created;
}

/** Atomically claim the next invoice number for a company (FOR UPDATE). */
async function claimInvoiceNumber(tx: any, companyId: number, type: string): Promise<string> {
  const [settings] = await tx
    .select()
    .from(invoiceSettingsTable)
    .where(eq(invoiceSettingsTable.companyId, companyId))
    .for("update")
    .limit(1);

  let prefix = settings?.prefix ?? "INV";
  // Override prefix per doc type for clarity
  if (type === "quotation") prefix = (settings?.prefix ?? "QT");
  if (type === "proforma") prefix = (settings?.prefix ?? "PRO");
  if (type === "purchase_order") prefix = (settings?.prefix ?? "PO");
  if (type === "sales_order") prefix = (settings?.prefix ?? "SO");
  if (type === "credit_note") prefix = (settings?.prefix ?? "CN");
  if (type === "debit_note") prefix = (settings?.prefix ?? "DN");
  if (type === "receipt") prefix = (settings?.prefix ?? "REC");
  if (type === "delivery_challan") prefix = (settings?.prefix ?? "DC");

  const nextNum = settings?.nextNumber ?? 1;
  const year = new Date().getFullYear();
  const num = String(nextNum).padStart(5, "0");
  const invoiceNumber = `${prefix}-${year}-${num}`;

  if (settings) {
    await tx.update(invoiceSettingsTable)
      .set({ nextNumber: nextNum + 1, updatedAt: new Date() })
      .where(eq(invoiceSettingsTable.companyId, companyId));
  } else {
    await tx.insert(invoiceSettingsTable).values({ companyId, nextNumber: 2 });
  }

  return invoiceNumber;
}

function fmtInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    id: inv.id,
    companyId: inv.companyId,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    status: inv.status,
    customerId: inv.customerId,
    customerName: inv.customerName,
    customerEmail: inv.customerEmail,
    customerPhone: inv.customerPhone,
    customerGstin: inv.customerGstin,
    customerPan: inv.customerPan,
    billingAddress: inv.billingAddress,
    shippingAddress: inv.shippingAddress,
    placeOfSupply: inv.placeOfSupply,
    currency: inv.currency,
    subtotal: inv.subtotal,
    discountTotal: inv.discountTotal,
    taxTotal: inv.taxTotal,
    total: inv.total,
    paidAmount: inv.paidAmount,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    paymentTerms: inv.paymentTerms,
    reference: inv.reference,
    notes: inv.notes,
    terms: inv.terms,
    createdBy: inv.createdBy,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

function fmtItem(it: typeof invoiceItemsTable.$inferSelect) {
  return {
    id: it.id,
    invoiceId: it.invoiceId,
    productId: it.productId,
    description: it.description,
    hsnCode: it.hsnCode,
    quantity: it.quantity,
    rate: it.rate,
    discountPercent: it.discountPercent,
    taxType: it.taxType,
    taxRate: it.taxRate,
    amount: it.amount,
    taxAmount: it.taxAmount,
    lineTotal: it.lineTotal,
    sortOrder: it.sortOrder,
  };
}

function fmtCustomer(c: typeof invoiceCustomersTable.$inferSelect) {
  return {
    id: c.id,
    companyId: c.companyId,
    name: c.name,
    email: c.email,
    phone: c.phone,
    gstin: c.gstin,
    pan: c.pan,
    billingAddress: c.billingAddress,
    shippingAddress: c.shippingAddress,
    state: c.state,
    creditLimit: c.creditLimit,
    outstanding: c.outstanding,
    createdAt: c.createdAt.toISOString(),
  };
}

// ── Dashboard stats ──────────────────────────────────────────────────────────

router.get("/invoices/dashboard", requirePermission("finance.view"), async (req, res) => {
  try {
    const scope = companyScope(req);
    const reqCompany = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    if (reqCompany != null && !canAccessCompany(req, reqCompany)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    if (scope && scope.length === 0) {
      res.json({ totalRevenue: 0, pendingAmount: 0, paidCount: 0, overdueCount: 0, draftCount: 0, recentInvoices: [] });
      return;
    }
    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;
    const filter = ids ? inArray(invoicesTable.companyId, ids) : undefined;
    const typeFilter = and(filter, eq(invoicesTable.type, "invoice"));

    const [totals] = await db.select({
      total: sql<number>`coalesce(sum(total), 0)`,
      paid: sql<number>`coalesce(sum(paid_amount), 0)`,
    }).from(invoicesTable).where(and(typeFilter, inArray(invoicesTable.status, ["paid", "partially_paid", "sent", "viewed", "overdue"])));

    const [paidCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable).where(and(typeFilter, eq(invoicesTable.status, "paid")));
    const [overdueCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable).where(and(typeFilter, eq(invoicesTable.status, "overdue")));
    const [draftCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(invoicesTable).where(and(typeFilter, eq(invoicesTable.status, "draft")));

    const recentInvoices = await db.select()
      .from(invoicesTable)
      .where(and(filter, eq(invoicesTable.type, "invoice")))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(5);

    res.json({
      totalRevenue: Number(totals?.total ?? 0),
      collectedAmount: Number(totals?.paid ?? 0),
      pendingAmount: Number(totals?.total ?? 0) - Number(totals?.paid ?? 0),
      paidCount: Number(paidCount?.count ?? 0),
      overdueCount: Number(overdueCount?.count ?? 0),
      draftCount: Number(draftCount?.count ?? 0),
      recentInvoices: recentInvoices.map(fmtInvoice),
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// ── Invoice settings ─────────────────────────────────────────────────────────

router.get("/invoice-settings", requirePermission("finance.view"), async (req, res) => {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const settings = await getSettings(companyId);
    res.json(settings);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

router.patch("/invoice-settings", requirePermission("finance.manage"), async (req, res) => {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const UPDATABLE = ["prefix", "bankName", "bankAccount", "bankIfsc", "bankBranch", "upiId",
      "defaultPaymentTerms", "defaultNotes", "defaultTerms", "signatureUrl"] as const;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const f of UPDATABLE) {
      if (f in body) updates[f] = body[f];
    }

    const [existing] = await db.select().from(invoiceSettingsTable).where(eq(invoiceSettingsTable.companyId, companyId));
    let result;
    if (existing) {
      [result] = await db.update(invoiceSettingsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(invoiceSettingsTable.companyId, companyId))
        .returning();
    } else {
      [result] = await db.insert(invoiceSettingsTable)
        .values({ companyId, ...updates })
        .returning();
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ── Invoice CRUD ─────────────────────────────────────────────────────────────

router.get("/invoices", requirePermission("finance.view"), async (req, res) => {
  try {
    const scope = companyScope(req);
    const reqCompany = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    const reqType = req.query.type as string | undefined;
    const reqStatus = req.query.status as string | undefined;

    if (reqCompany != null && !canAccessCompany(req, reqCompany)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    if (scope && scope.length === 0) { res.json([]); return; }

    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;
    const conditions: any[] = [];
    if (ids) conditions.push(inArray(invoicesTable.companyId, ids));
    if (reqType) conditions.push(eq(invoicesTable.type, reqType));
    if (reqStatus) conditions.push(eq(invoicesTable.status, reqStatus));

    const rows = await db.select().from(invoicesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(invoicesTable.createdAt));
    res.json(rows.map(fmtInvoice));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list invoices" });
  }
});

router.post("/invoices", requirePermission("finance.manage"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = parseInt(String(body.companyId ?? "0"));
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!String(body.customerName ?? "").trim()) {
      res.status(400).json({ error: "customerName required" }); return;
    }

    const docType = String(body.type ?? "invoice");
    const items: any[] = Array.isArray(body.items) ? body.items : [];

    const created = await db.transaction(async (tx) => {
      const invoiceNumber = await claimInvoiceNumber(tx, companyId, docType);
      const validCustomerId = await checkCustomerOwnership(tx, body.customerId, companyId);
      const [inv] = await tx.insert(invoicesTable).values({
        companyId,
        invoiceNumber,
        type: docType,
        status: String(body.status ?? "draft"),
        customerId: validCustomerId,
        customerName: String(body.customerName),
        customerEmail: body.customerEmail ? String(body.customerEmail) : undefined,
        customerPhone: body.customerPhone ? String(body.customerPhone) : undefined,
        customerGstin: body.customerGstin ? String(body.customerGstin) : undefined,
        customerPan: body.customerPan ? String(body.customerPan) : undefined,
        billingAddress: body.billingAddress ? String(body.billingAddress) : undefined,
        shippingAddress: body.shippingAddress ? String(body.shippingAddress) : undefined,
        placeOfSupply: body.placeOfSupply ? String(body.placeOfSupply) : undefined,
        currency: String(body.currency ?? "INR"),
        issueDate: String(body.issueDate ?? new Date().toISOString().slice(0, 10)),
        dueDate: body.dueDate ? String(body.dueDate) : undefined,
        paymentTerms: body.paymentTerms ? String(body.paymentTerms) : undefined,
        reference: body.reference ? String(body.reference) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
        terms: body.terms ? String(body.terms) : undefined,
        createdBy: actor(req).id ?? undefined,
      }).returning();

      // Insert line items
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const s = sanitizeItem(it);
        const validProductId = await checkProductOwnership(tx, it.productId, companyId);
        await tx.insert(invoiceItemsTable).values({
          invoiceId: inv.id,
          productId: validProductId,
          description: String(it.description ?? ""),
          hsnCode: it.hsnCode ? String(it.hsnCode) : undefined,
          quantity: s.qty,
          rate: s.rate,
          discountPercent: s.discPct,
          taxType: s.taxType,
          taxRate: s.taxRate,
          amount: Math.round(s.amt * 100) / 100,
          taxAmount: Math.round(s.taxAmt * 100) / 100,
          lineTotal: Math.round((s.amt + s.taxAmt) * 100) / 100,
          sortOrder: i,
        });
      }

      await recalcInvoice(tx, inv.id);
      const [fresh] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id));
      const freshItems = await tx.select().from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, inv.id))
        .orderBy(invoiceItemsTable.sortOrder);
      return { invoice: fresh, items: freshItems };
    });

    res.status(201).json({ ...fmtInvoice(created.invoice), items: created.items.map(fmtItem) });
  } catch (e) {
    req.log.error(e);
    const sc = (e as any)?.statusCode;
    if (sc === 400) { res.status(400).json({ error: (e as Error).message }); return; }
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

router.get("/invoices/:id", requirePermission("finance.view"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!inv) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, inv.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const items = await db.select().from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, id))
      .orderBy(invoiceItemsTable.sortOrder);

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, inv.companyId));
    const settings = await getSettings(inv.companyId);

    res.json({
      ...fmtInvoice(inv),
      items: items.map(fmtItem),
      company: company ? {
        id: company.id, name: company.name, logoUrl: company.logoUrl,
        gstNumber: company.gstNumber, panNumber: company.panNumber,
        address: company.address, city: company.city, state: company.state,
        website: company.website, currency: company.currency,
        brandColor: company.brandColor,
      } : null,
      settings: {
        bankName: settings.bankName, bankAccount: settings.bankAccount,
        bankIfsc: settings.bankIfsc, bankBranch: settings.bankBranch,
        upiId: settings.upiId, defaultTerms: settings.defaultTerms,
      },
    });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get invoice" });
  }
});

const INV_UPDATABLE = [
  "customerName", "customerEmail", "customerPhone", "customerGstin", "customerPan",
  "billingAddress", "shippingAddress", "placeOfSupply", "currency",
  "issueDate", "dueDate", "paymentTerms", "reference", "notes", "terms",
] as const;

router.patch("/invoices/:id", requirePermission("finance.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const f of INV_UPDATABLE) {
      if (f in body) updates[f] = body[f] ?? null;
    }
    if ("customerId" in body) {
      updates.customerId = await checkCustomerOwnership(db, body.customerId, existing.companyId);
    }

    const items: any[] | undefined = Array.isArray(body.items) ? body.items : undefined;

    const result = await db.transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx.update(invoicesTable).set({ ...updates, updatedAt: new Date() }).where(eq(invoicesTable.id, id));
      }
      if (items !== undefined) {
        // Replace all items
        await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const s = sanitizeItem(it);
          const validProductId = await checkProductOwnership(tx, it.productId, existing.companyId);
          await tx.insert(invoiceItemsTable).values({
            invoiceId: id,
            productId: validProductId,
            description: String(it.description ?? ""),
            hsnCode: it.hsnCode ? String(it.hsnCode) : undefined,
            quantity: s.qty, rate: s.rate, discountPercent: s.discPct,
            taxType: s.taxType, taxRate: s.taxRate,
            amount: Math.round(s.amt * 100) / 100,
            taxAmount: Math.round(s.taxAmt * 100) / 100,
            lineTotal: Math.round((s.amt + s.taxAmt) * 100) / 100,
            sortOrder: i,
          });
        }
        await recalcInvoice(tx, id);
      }
      const [fresh] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
      const freshItems = await tx.select().from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, id))
        .orderBy(invoiceItemsTable.sortOrder);
      return { invoice: fresh, items: freshItems };
    });

    res.json({ ...fmtInvoice(result.invoice), items: result.items.map(fmtItem) });
  } catch (e) {
    req.log.error(e);
    const sc = (e as any)?.statusCode;
    if (sc === 400) { res.status(400).json({ error: (e as Error).message }); return; }
    res.status(500).json({ error: "Failed to update invoice" });
  }
});

router.post("/invoices/:id/status", requirePermission("finance.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const status = String(req.body?.status ?? "");
    const VALID = ["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "refunded"];
    if (!VALID.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }

    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "paid") {
      updates.paidAmount = existing.total;
    } else if (req.body?.paidAmount !== undefined) {
      updates.paidAmount = Math.min(safeNum(req.body.paidAmount, 0), Number(existing.total ?? 0));
    }

    const [updated] = await db.update(invoicesTable).set(updates).where(eq(invoicesTable.id, id)).returning();
    const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id)).orderBy(invoiceItemsTable.sortOrder);
    res.json({ ...fmtInvoice(updated), items: items.map(fmtItem) });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update status" });
  }
});

router.delete("/invoices/:id", requirePermission("finance.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!["draft", "cancelled"].includes(existing.status)) {
      res.status(400).json({ error: "Only draft or cancelled invoices can be deleted" }); return;
    }
    await db.transaction(async (tx) => {
      await tx.delete(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, id));
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
    });
    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
});

// ── Customer CRUD ─────────────────────────────────────────────────────────────

router.get("/invoice-customers", requirePermission("finance.view"), async (req, res) => {
  try {
    const scope = companyScope(req);
    const reqCompany = req.query.companyId ? parseInt(req.query.companyId as string) : null;
    if (reqCompany != null && !canAccessCompany(req, reqCompany)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    if (scope && scope.length === 0) { res.json([]); return; }
    const ids: number[] | null = reqCompany != null ? [reqCompany] : scope;
    const rows = await db.select().from(invoiceCustomersTable)
      .where(ids ? inArray(invoiceCustomersTable.companyId, ids) : undefined)
      .orderBy(invoiceCustomersTable.name);
    res.json(rows.map(fmtCustomer));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

router.post("/invoice-customers", requirePermission("finance.manage"), async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = parseInt(String(body.companyId ?? "0"));
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    if (!String(body.name ?? "").trim()) { res.status(400).json({ error: "name required" }); return; }
    const [created] = await db.insert(invoiceCustomersTable).values({
      companyId,
      name: String(body.name),
      email: body.email ? String(body.email) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      gstin: body.gstin ? String(body.gstin) : undefined,
      pan: body.pan ? String(body.pan) : undefined,
      billingAddress: body.billingAddress ? String(body.billingAddress) : undefined,
      shippingAddress: body.shippingAddress ? String(body.shippingAddress) : undefined,
      state: body.state ? String(body.state) : undefined,
      creditLimit: body.creditLimit ? Number(body.creditLimit) : 0,
    }).returning();
    res.status(201).json(fmtCustomer(created));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

const CUST_UPDATABLE = ["name", "email", "phone", "gstin", "pan", "billingAddress", "shippingAddress", "state", "creditLimit"] as const;

router.patch("/invoice-customers/:id", requirePermission("finance.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(invoiceCustomersTable).where(eq(invoiceCustomersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const f of CUST_UPDATABLE) { if (f in body) updates[f] = body[f]; }
    const [updated] = await db.update(invoiceCustomersTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(invoiceCustomersTable.id, id)).returning();
    res.json(fmtCustomer(updated));
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

router.delete("/invoice-customers/:id", requirePermission("finance.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id));
    const [existing] = await db.select().from(invoiceCustomersTable).where(eq(invoiceCustomersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
    await db.delete(invoiceCustomersTable).where(eq(invoiceCustomersTable.id, id));
    res.status(204).end();
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

export default router;
