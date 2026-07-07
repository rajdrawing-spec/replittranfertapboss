import { Router } from "express";
import { db } from "@workspace/db";
import {
  ordersTable, customersTable, productsTable, companiesTable,
  vaultEntriesTable, documentsTable, shipmentsTable,
} from "@workspace/db";
import { or, and, eq, ilike, type SQL } from "drizzle-orm";

const router = Router();

// GET /api/search?q=...&companyId=...  — global search across all entities
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) { res.json({ results: [], query: q }); return; }
    const like = `%${q}%`;
    const limit = 6;
    const cidRaw = req.query.companyId as string | undefined;
    const cid = cidRaw ? parseInt(cidRaw) : null;

    // Combine a text-match clause with an optional company scope
    const scoped = (text: SQL, col?: any): SQL =>
      (cid != null && col) ? and(eq(col, cid), text)! : text;

    const [orders, customers, products, companies, vault, documents, shipments] = await Promise.all([
      db.select().from(ordersTable).where(scoped(or(ilike(ordersTable.orderNumber, like), ilike(ordersTable.customerName, like), ilike(ordersTable.customerPhone, like), ilike(ordersTable.customerEmail, like))!, ordersTable.companyId)).limit(limit),
      db.select().from(customersTable).where(scoped(or(ilike(customersTable.name, like), ilike(customersTable.phone, like), ilike(customersTable.email, like))!, customersTable.companyId)).limit(limit),
      db.select().from(productsTable).where(scoped(or(ilike(productsTable.name, like), ilike(productsTable.sku, like))!, productsTable.companyId)).limit(limit),
      // Companies are group-level; only searched in parent view (no companyId scope)
      cid != null ? Promise.resolve([] as typeof companiesTable.$inferSelect[]) : db.select().from(companiesTable).where(or(ilike(companiesTable.name, like), ilike(companiesTable.slug, like))).limit(limit),
      db.select().from(vaultEntriesTable).where(scoped(or(ilike(vaultEntriesTable.platform, like), ilike(vaultEntriesTable.email, like), ilike(vaultEntriesTable.phone, like), ilike(vaultEntriesTable.recoveryPhone, like), ilike(vaultEntriesTable.username, like))!, vaultEntriesTable.companyId)).limit(limit),
      db.select().from(documentsTable).where(scoped(or(ilike(documentsTable.name, like), ilike(documentsTable.referenceNumber, like))!, documentsTable.companyId)).limit(limit),
      db.select().from(shipmentsTable).where(scoped(or(ilike(shipmentsTable.trackingNumber, like), ilike(shipmentsTable.customerName, like), ilike(shipmentsTable.orderNumber, like))!, shipmentsTable.companyId)).limit(limit),
    ]);

    const results: Array<{ type: string; id: number; title: string; subtitle: string; href: string }> = [];
    orders.forEach(o => results.push({ type: "Order", id: o.id, title: o.orderNumber, subtitle: `${o.customerName} · ₹${o.totalAmount}`, href: "/orders" }));
    customers.forEach(c => results.push({ type: "Customer", id: c.id, title: c.name, subtitle: [c.phone, c.email].filter(Boolean).join(" · "), href: "/crm" }));
    products.forEach(p => results.push({ type: "Product", id: p.id, title: p.name, subtitle: `SKU ${p.sku ?? "—"} · ${p.stockQuantity} in stock`, href: "/inventory" }));
    companies.forEach(c => results.push({ type: "Brand", id: c.id, title: c.name, subtitle: c.slug, href: `/companies/${c.id}` }));
    vault.forEach(v => results.push({ type: "Vault", id: v.id, title: v.platform, subtitle: [v.email, v.phone].filter(Boolean).join(" · "), href: "/vault" }));
    documents.forEach(d => results.push({ type: "Document", id: d.id, title: d.name, subtitle: d.referenceNumber ?? d.category, href: "/documents" }));
    shipments.forEach(s => results.push({ type: "Shipment", id: s.id, title: s.trackingNumber ?? s.orderNumber ?? `#${s.id}`, subtitle: `${s.customerName} · ${s.status}`, href: "/shipping" }));

    res.json({ query: q, results });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Search failed" }); }
});

export default router;
