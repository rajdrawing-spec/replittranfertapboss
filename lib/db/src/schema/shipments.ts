import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shipmentsTable = pgTable("shipments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  courier: text("courier").notNull().default("Shiprocket"), // Shiprocket|Delhivery|Blue Dart|DTDC
  trackingNumber: text("tracking_number"),
  status: text("status").notNull().default("processing"), // processing|picked_up|in_transit|out_for_delivery|delivered|rto|returned
  customerName: text("customer_name").notNull(),
  destination: text("destination"),
  weightKg: real("weight_kg"),
  shippingCost: real("shipping_cost").default(0),
  shippedAt: timestamp("shipped_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;
