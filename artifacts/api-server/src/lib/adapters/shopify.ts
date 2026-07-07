import { db, ordersTable, productsTable } from "@workspace/db";
import type { Order } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { IntegrationAdapter, AdapterContext, TestResult, SyncResult } from "../integration-adapters";
import { secretEnvName } from "../integration-catalog";
import { syncOrderRevenue } from "../order-revenue-sync";
import { logger } from "../logger";

const API_VERSION = "2024-10";
const PAGE_LIMIT = 250;
const MAX_PAGES = 20; // safety cap: up to 5,000 records/entity per sync

/** Pull the two Shopify credentials for this connection out of resolved secrets. */
function creds(ctx: AdapterContext): { domain: string; token: string } | null {
  const companyId = ctx.connection.companyId;
  const domainRef = secretEnvName("shopify", companyId, "STORE_DOMAIN");
  const tokenRef = secretEnvName("shopify", companyId, "ADMIN_API_TOKEN");
  const rawDomain = ctx.secrets[domainRef];
  const token = ctx.secrets[tokenRef];
  if (!rawDomain || !token) return null;
  // Accept "store.myshopify.com", "https://store.myshopify.com", or with a slash.
  const domain = rawDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return { domain, token };
}

async function shopifyGet(
  domain: string,
  token: string,
  path: string,
): Promise<{ body: any; nextInfo: string | null }> {
  const url = path.startsWith("http")
    ? path
    : `https://${domain}/admin/api/${API_VERSION}/${path}`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify API ${res.status} ${res.statusText} for ${path}: ${text.slice(0, 300)}`);
  }
  // REST pagination lives in the Link header: <...page_info=xyz>; rel="next"
  const link = res.headers.get("link") ?? res.headers.get("Link");
  let nextInfo: string | null = null;
  if (link) {
    const m = link.split(",").find((s) => s.includes('rel="next"'));
    if (m) {
      const urlMatch = m.match(/<([^>]+)>/);
      if (urlMatch) nextInfo = urlMatch[1];
    }
  }
  return { body: await res.json(), nextInfo };
}

/** Follow Link-header pagination, collecting an array field from each page. */
async function paginate(
  domain: string,
  token: string,
  firstPath: string,
  field: string,
): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = `${firstPath}${firstPath.includes("?") ? "&" : "?"}limit=${PAGE_LIMIT}`;
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const { body, nextInfo } = await shopifyGet(domain, token, next);
    const items = Array.isArray(body?.[field]) ? body[field] : [];
    out.push(...items);
    next = nextInfo;
    pages++;
  }
  return out;
}

/**
 * Map a Shopify order's financial/fulfillment state to our order status enum.
 * IMPORTANT: only "delivered" triggers revenue recognition downstream, so it
 * must require BOTH fulfillment complete AND money actually received — an order
 * that is fulfilled but unpaid must never be recognised as revenue.
 */
export function mapOrderStatus(o: any): string {
  if (o.cancelled_at) return "cancelled";
  const fin = String(o.financial_status ?? "");
  if (fin === "refunded") return "refunded";
  // A partial refund still nets as paid; we don't auto-reverse it here because
  // our reversal books the full amount (proportional refunds are out of scope).
  const paid = fin === "paid" || fin === "partially_refunded";
  const ful = String(o.fulfillment_status ?? "");
  // Shopify's REST API exposes fulfillment, not delivery. A fully fulfilled AND
  // paid order is our closest proxy for "delivered" (revenue recognised).
  if (ful === "fulfilled") return paid ? "delivered" : "shipped";
  if (ful === "partial") return "shipped";
  if (paid) return "confirmed";
  return "processing";
}

async function upsertProducts(companyId: number, products: any[]): Promise<number> {
  let count = 0;
  for (const p of products) {
    const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [{}];
    for (const v of variants) {
      const sku = String(v.sku || `shopify-${p.id}-${v.id ?? "0"}`);
      const variantLabel = v.title && v.title !== "Default Title" ? ` - ${v.title}` : "";
      const values = {
        companyId,
        name: `${p.title ?? "Untitled"}${variantLabel}`,
        sku,
        category: String(p.product_type || "Uncategorized"),
        description: typeof p.body_html === "string" ? p.body_html.replace(/<[^>]*>/g, "").slice(0, 500) : null,
        price: v.price != null ? parseFloat(v.price) || 0 : 0,
        stockQuantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : 0,
        imageUrl: p.image?.src ?? null,
        status: p.status === "active" ? "active" : p.status === "draft" ? "draft" : "active",
      };
      const [existing] = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(and(eq(productsTable.companyId, companyId), eq(productsTable.sku, sku)))
        .limit(1);
      if (existing) {
        await db.update(productsTable)
          .set({ name: values.name, category: values.category, description: values.description, price: values.price, stockQuantity: values.stockQuantity, imageUrl: values.imageUrl, status: values.status, updatedAt: new Date() })
          .where(eq(productsTable.id, existing.id));
      } else {
        await db.insert(productsTable).values(values);
      }
      count++;
    }
  }
  return count;
}

async function upsertOrders(companyId: number, orders: any[]): Promise<number> {
  let count = 0;
  for (const o of orders) {
    // order.name is the human ref like "#1001"; order_number is the numeric part.
    const orderNumber = `SH-${companyId}-${o.order_number ?? o.id}`;
    const cust = o.customer ?? {};
    const customerName = [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim()
      || o.shipping_address?.name || "Guest";
    const status = mapOrderStatus(o);
    const itemCount = Array.isArray(o.line_items)
      ? o.line_items.reduce((s: number, li: any) => s + (Number(li.quantity) || 0), 0)
      : 1;
    const sa = o.shipping_address;
    const shippingAddress = sa
      ? [sa.address1, sa.address2, sa.city, sa.province, sa.zip, sa.country].filter(Boolean).join(", ")
      : null;
    const values = {
      orderNumber,
      companyId,
      customerName,
      customerEmail: o.email ?? cust.email ?? null,
      customerPhone: o.phone ?? cust.phone ?? sa?.phone ?? null,
      status,
      totalAmount: parseFloat(o.total_price) || 0,
      itemCount: itemCount || 1,
      channel: "shopify",
      shippingAddress,
    };

    const [existing] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderNumber, orderNumber))
      .limit(1);

    let row: Order;
    if (existing) {
      const [updated] = await db.update(ordersTable)
        .set({ customerName: values.customerName, customerEmail: values.customerEmail, customerPhone: values.customerPhone, status: values.status, totalAmount: values.totalAmount, itemCount: values.itemCount, shippingAddress: values.shippingAddress, updatedAt: new Date() })
        .where(eq(ordersTable.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db.insert(ordersTable).values(values).returning();
      row = inserted;
    }
    count++;
    // Recognise / reverse revenue based on the mapped status. Idempotent.
    await syncOrderRevenue(row);
  }
  return count;
}

export const shopifyAdapter: IntegrationAdapter = {
  async testConnection(ctx: AdapterContext): Promise<TestResult> {
    const c = creds(ctx);
    if (!c) return { ok: false, health: "down", message: "Shopify store domain and admin API token are required." };
    try {
      await shopifyGet(c.domain, c.token, "shop.json");
      return { ok: true, health: "healthy", message: `Connected to ${c.domain}.` };
    } catch (e) {
      return { ok: false, health: "down", message: e instanceof Error ? e.message : "Shopify connection test failed." };
    }
  },

  async sync(ctx: AdapterContext): Promise<SyncResult> {
    const c = creds(ctx);
    if (!c) return { status: "skipped", recordsSynced: 0, message: "Shopify credentials not configured." };
    const companyId = ctx.connection.companyId;
    try {
      const products = await paginate(c.domain, c.token, "products.json", "products");
      const productCount = await upsertProducts(companyId, products);
      const orders = await paginate(c.domain, c.token, "orders.json?status=any", "orders");
      const orderCount = await upsertOrders(companyId, orders);
      return {
        status: "success",
        recordsSynced: productCount + orderCount,
        message: `Synced ${productCount} product(s) and ${orderCount} order(s) from ${c.domain}.`,
      };
    } catch (e) {
      logger.error({ err: e, companyId }, "Shopify sync failed");
      return { status: "failed", recordsSynced: 0, message: e instanceof Error ? e.message : "Shopify sync failed." };
    }
  },
};
