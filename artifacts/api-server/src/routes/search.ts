import { Router } from "express";
import { db } from "@workspace/db";
import {
  ordersTable, customersTable, productsTable, companiesTable,
  accountDirectoryTable, documentsTable, shipmentsTable, usersTable,
} from "@workspace/db";
import { or, and, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";

const router = Router();

const GROUP_ROLES = ["super_admin", "founder", "director", "finance", "ca"];

async function getUser(userId: number): Promise<{ role: string; companyIds: number[] } | null> {
  const [u] = await db
    .select({ role: usersTable.role, companyIds: usersTable.companyIds })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!u) return null;
  return { role: u.role, companyIds: (u.companyIds as number[]) ?? [] };
}

// GET /api/search?q=...&companyId=...  — global search across all entities
router.get("/search", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const q = (req.query.q as string || "").trim();
    if (q.length < 2) { res.json({ results: [], query: q }); return; }
    const like = `%${q}%`;
    const limit = 6;
    const isGroup = GROUP_ROLES.includes(user.role);
    const allowed = user.companyIds;
    const cidRaw = req.query.companyId as string | undefined;
    const cid = cidRaw ? parseInt(cidRaw) : null;

    // Company scope for tables whose companyId is NOT NULL. The caller's role/companyIds
    // are authoritative — a requested companyId can only narrow within the allowed set,
    // never widen it.
    const companyScope = (col: any): SQL | undefined => {
      if (isGroup) return cid != null ? eq(col, cid) : undefined;
      if (allowed.length === 0) return sql`1 = 0`;
      if (cid != null && allowed.includes(cid)) return eq(col, cid);
      return inArray(col, allowed);
    };

    // Account directory allows group-level rows (companyId null) to be visible to everyone.
    const accountScope = (col: any): SQL | undefined => {
      if (isGroup) return cid != null ? eq(col, cid) : undefined;
      if (cid != null && allowed.includes(cid)) return or(eq(col, cid), isNull(col))!;
      return allowed.length ? or(inArray(col, allowed), isNull(col))! : isNull(col);
    };

    const scoped = (text: SQL, scope: SQL | undefined): SQL => (scope ? and(scope, text)! : text);

    // Companies are group-level entities (no companyId). Non-group users only see their own.
    const companyText = or(ilike(companiesTable.name, like), ilike(companiesTable.slug, like))!;
    const companiesQuery = isGroup
      ? (cid != null ? Promise.resolve([] as typeof companiesTable.$inferSelect[]) : db.select().from(companiesTable).where(companyText).limit(limit))
      : (allowed.length ? db.select().from(companiesTable).where(and(inArray(companiesTable.id, allowed), companyText)!).limit(limit) : Promise.resolve([] as typeof companiesTable.$inferSelect[]));

    const [orders, customers, products, companies, accounts, documents, shipments] = await Promise.all([
      db.select().from(ordersTable).where(scoped(or(ilike(ordersTable.orderNumber, like), ilike(ordersTable.customerName, like), ilike(ordersTable.customerPhone, like), ilike(ordersTable.customerEmail, like))!, companyScope(ordersTable.companyId))).limit(limit),
      db.select().from(customersTable).where(scoped(or(ilike(customersTable.name, like), ilike(customersTable.phone, like), ilike(customersTable.email, like))!, companyScope(customersTable.companyId))).limit(limit),
      db.select().from(productsTable).where(scoped(or(ilike(productsTable.name, like), ilike(productsTable.sku, like))!, companyScope(productsTable.companyId))).limit(limit),
      companiesQuery,
      // Account directory — match by platform, email, phone, owner, OR the company name.
      db
        .select({ acct: accountDirectoryTable, companyName: companiesTable.name })
        .from(accountDirectoryTable)
        .leftJoin(companiesTable, eq(accountDirectoryTable.companyId, companiesTable.id))
        .where(scoped(or(
          ilike(accountDirectoryTable.platform, like),
          ilike(accountDirectoryTable.loginEmail, like),
          ilike(accountDirectoryTable.recoveryEmail, like),
          ilike(accountDirectoryTable.phone, like),
          ilike(accountDirectoryTable.recoveryPhone, like),
          ilike(accountDirectoryTable.accountOwner, like),
          ilike(companiesTable.name, like),
        )!, accountScope(accountDirectoryTable.companyId)))
        .limit(limit),
      db.select().from(documentsTable).where(scoped(or(ilike(documentsTable.name, like), ilike(documentsTable.referenceNumber, like))!, companyScope(documentsTable.companyId))).limit(limit),
      db.select().from(shipmentsTable).where(scoped(or(ilike(shipmentsTable.trackingNumber, like), ilike(shipmentsTable.customerName, like), ilike(shipmentsTable.orderNumber, like))!, companyScope(shipmentsTable.companyId))).limit(limit),
    ]);

    const results: Array<{ type: string; id: number; title: string; subtitle: string; href: string }> = [];
    orders.forEach(o => results.push({ type: "Order", id: o.id, title: o.orderNumber, subtitle: `${o.customerName} · ₹${o.totalAmount}`, href: "/orders" }));
    customers.forEach(c => results.push({ type: "Customer", id: c.id, title: c.name, subtitle: [c.phone, c.email].filter(Boolean).join(" · "), href: "/crm" }));
    products.forEach(p => results.push({ type: "Product", id: p.id, title: p.name, subtitle: `SKU ${p.sku ?? "—"} · ${p.stockQuantity} in stock`, href: "/inventory" }));
    companies.forEach(c => results.push({ type: "Brand", id: c.id, title: c.name, subtitle: c.slug, href: `/companies/${c.id}` }));
    accounts.forEach(({ acct: a, companyName }) => results.push({ type: "Account", id: a.id, title: a.platform, subtitle: [a.loginEmail, a.phone, companyName].filter(Boolean).join(" · "), href: "/accounts" }));
    documents.forEach(d => results.push({ type: "Document", id: d.id, title: d.name, subtitle: d.referenceNumber ?? d.category, href: "/documents" }));
    shipments.forEach(s => results.push({ type: "Shipment", id: s.id, title: s.trackingNumber ?? s.orderNumber ?? `#${s.id}`, subtitle: `${s.customerName} · ${s.status}`, href: "/shipping" }));

    res.json({ query: q, results });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Search failed" }); }
});

export default router;
