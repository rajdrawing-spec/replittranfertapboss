import { Router } from "express";
import { db } from "@workspace/db";
import {
  ordersTable, customersTable, productsTable, companiesTable,
  accountDirectoryTable, documentsTable, shipmentsTable, usersTable,
  generatedTasksTable, meetingsTable, chatChannelsTable, chatMessagesTable,
  employeesTable, taskTemplatesTable,
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

// GET /api/search?q=...&companyId=...&type=...  — global search across all entities
router.get("/search", async (req, res) => {
  try {
    const user = await getUser((req as any).userId);
    if (!user) { res.status(403).json({ error: "Not authorized" }); return; }

    const q = (req.query.q as string || "").trim();
    if (q.length < 2) { res.json({ results: [], query: q }); return; }
    const like = `%${q}%`;
    const limit = 6;
    // Optional type filter lets the frontend request only the categories it needs,
    // cutting the number of heavy ILIKE queries drastically.
    const requestedType = (req.query.type as string | undefined)?.toLowerCase();
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

    // Helper: only run the requested category when a type filter is supplied.
    const run = <T,>(type: string, fn: () => Promise<T>): Promise<T> => {
      if (requestedType && requestedType !== type.toLowerCase()) return Promise.resolve([] as T);
      return fn();
    };

    const [orders, customers, products, companies, accounts, documents, shipments, tasks, meetings, channels, messages, employees, templates] = await Promise.all([
      run("Order", () => db.select().from(ordersTable).where(scoped(or(ilike(ordersTable.orderNumber, like), ilike(ordersTable.customerName, like), ilike(ordersTable.customerPhone, like), ilike(ordersTable.customerEmail, like))!, companyScope(ordersTable.companyId))).limit(limit)),
      run("Customer", () => db.select().from(customersTable).where(scoped(or(ilike(customersTable.name, like), ilike(customersTable.phone, like), ilike(customersTable.email, like))!, companyScope(customersTable.companyId))).limit(limit)),
      run("Product", () => db.select().from(productsTable).where(scoped(or(ilike(productsTable.name, like), ilike(productsTable.sku, like))!, companyScope(productsTable.companyId))).limit(limit)),
      run("Brand", () => companiesQuery),
      run("Account", () => db.select({ acct: accountDirectoryTable, companyName: companiesTable.name }).from(accountDirectoryTable).leftJoin(companiesTable, eq(accountDirectoryTable.companyId, companiesTable.id)).where(scoped(or(ilike(accountDirectoryTable.platform, like), ilike(accountDirectoryTable.loginEmail, like), ilike(accountDirectoryTable.recoveryEmail, like), ilike(accountDirectoryTable.phone, like), ilike(accountDirectoryTable.recoveryPhone, like), ilike(accountDirectoryTable.accountOwner, like), ilike(companiesTable.name, like))!, accountScope(accountDirectoryTable.companyId))).limit(limit)),
      run("Document", () => db.select().from(documentsTable).where(scoped(or(ilike(documentsTable.name, like), ilike(documentsTable.referenceNumber, like))!, companyScope(documentsTable.companyId))).limit(limit)),
      run("Shipment", () => db.select().from(shipmentsTable).where(scoped(or(ilike(shipmentsTable.trackingNumber, like), ilike(shipmentsTable.customerName, like), ilike(shipmentsTable.orderNumber, like))!, companyScope(shipmentsTable.companyId))).limit(limit)),
      run("Task", () => db.select().from(generatedTasksTable).where(scoped(or(ilike(generatedTasksTable.title, like), ilike(generatedTasksTable.description, like))!, companyScope(generatedTasksTable.companyId))).limit(limit)),
      run("Meeting", () => db.select().from(meetingsTable).where(scoped(or(ilike(meetingsTable.title, like), ilike(meetingsTable.meetingId, like))!, companyScope(meetingsTable.companyId))).limit(limit)),
      run("Channel", () => db.select().from(chatChannelsTable).where(scoped(or(ilike(chatChannelsTable.name, like))!, companyScope(chatChannelsTable.companyId))).limit(limit)),
      run("Chat", () => db.select({ msg: chatMessagesTable, companyId: chatChannelsTable.companyId }).from(chatMessagesTable).leftJoin(chatChannelsTable, eq(chatMessagesTable.channelId, chatChannelsTable.id)).where(scoped(or(ilike(chatMessagesTable.content, like), ilike(chatMessagesTable.displayName, like))!, companyScope(chatChannelsTable.companyId))).limit(limit)),
      run("Employee", () => db.select().from(employeesTable).where(scoped(or(ilike(employeesTable.firstName, like), ilike(employeesTable.lastName, like), ilike(employeesTable.email, like), ilike(employeesTable.department, like))!, companyScope(employeesTable.companyId))).limit(limit)),
      run("Template", () => db.select().from(taskTemplatesTable).where(scoped(or(ilike(taskTemplatesTable.titleTemplate, like), ilike(taskTemplatesTable.descriptionTemplate, like))!, companyScope(taskTemplatesTable.companyId))).limit(limit)),
    ]);

    const results: Array<{ type: string; id: number; title: string; subtitle: string; href: string }> = [];
    orders.forEach(o => results.push({ type: "Order", id: o.id, title: o.orderNumber, subtitle: `${o.customerName} · ₹${o.totalAmount}`, href: "/orders" }));
    customers.forEach(c => results.push({ type: "Customer", id: c.id, title: c.name, subtitle: [c.phone, c.email].filter(Boolean).join(" · "), href: "/crm" }));
    products.forEach(p => results.push({ type: "Product", id: p.id, title: p.name, subtitle: `SKU ${p.sku ?? "—"} · ${p.stockQuantity} in stock`, href: "/inventory" }));
    companies.forEach(c => results.push({ type: "Brand", id: c.id, title: c.name, subtitle: c.slug, href: `/companies/${c.id}` }));
    accounts.forEach(({ acct: a, companyName }) => results.push({ type: "Account", id: a.id, title: a.platform, subtitle: [a.loginEmail, a.phone, companyName].filter(Boolean).join(" · "), href: "/accounts" }));
    documents.forEach(d => results.push({ type: "Document", id: d.id, title: d.name, subtitle: d.referenceNumber ?? d.category, href: "/documents" }));
    shipments.forEach(s => results.push({ type: "Shipment", id: s.id, title: s.trackingNumber ?? s.orderNumber ?? `#${s.id}`, subtitle: `${s.customerName} · ${s.status}`, href: "/shipping" }));
    tasks.forEach(t => results.push({ type: "Task", id: t.id, title: t.title, subtitle: t.priority, href: "/ai-tasks" }));
    meetings.forEach(m => results.push({ type: "Meeting", id: m.id, title: m.title, subtitle: m.status, href: "/meetings" }));
    channels.forEach(c => results.push({ type: "Channel", id: c.id, title: c.name, subtitle: c.type, href: "/chat" }));
    messages.forEach(({ msg: m }) => results.push({ type: "Chat", id: m.id, title: m.displayName, subtitle: m.content.slice(0, 60), href: "/chat" }));
    employees.forEach(e => results.push({ type: "Employee", id: e.id, title: `${e.firstName} ${e.lastName}`, subtitle: `${e.department} · ${e.designation}`, href: "/hr" }));
    templates.forEach(t => results.push({ type: "Template", id: t.id, title: t.titleTemplate, subtitle: t.descriptionTemplate?.slice(0, 60) ?? "", href: "/ai-tasks" }));

    res.json({ query: q, results });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Search failed" }); }
});

export default router;
