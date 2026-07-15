import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  companyId: integer("company_id").notNull(),
  customerId: integer("customer_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  status: text("status").notNull().default("pending"), // pending|confirmed|processing|shipped|delivered|cancelled|returned|refunded
  totalAmount: real("total_amount").notNull().default(0),
  itemCount: integer("item_count").notNull().default(1),
  channel: text("channel").notNull().default("direct"), // shopify|shopdeck|baapstore|website|whatsapp|direct
  shippingAddress: text("shipping_address"),
  trackingNumber: text("tracking_number"),
  courierName: text("courier_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("orders_company_id_idx").on(t.companyId),
  index("orders_customer_id_idx").on(t.customerId),
  index("orders_created_at_idx").on(t.createdAt),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
