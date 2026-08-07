import { pgTable, serial, text, real, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Per-company invoice settings: prefix, numbering, bank details, etc.
export const invoiceSettingsTable = pgTable("invoice_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().unique(),
  prefix: text("prefix").notNull().default("INV"), // e.g. HUG, UTG, INV
  nextNumber: integer("next_number").notNull().default(1),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  bankIfsc: text("bank_ifsc"),
  bankBranch: text("bank_branch"),
  upiId: text("upi_id"),
  defaultPaymentTerms: text("default_payment_terms").default("30"), // days
  defaultNotes: text("default_notes"),
  defaultTerms: text("default_terms"),
  signatureUrl: text("signature_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Billing contacts per company (customers & vendors)
export const invoiceCustomersTable = pgTable("invoice_customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  gstin: text("gstin"),
  pan: text("pan"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  state: text("state"), // for GST place-of-supply determination
  creditLimit: real("credit_limit").notNull().default(0),
  outstanding: real("outstanding").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// The main document table: invoice / quotation / proforma / PO / SO etc.
export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  // type: what kind of document this is
  type: text("type").notNull().default("invoice"),
  // status lifecycle
  status: text("status").notNull().default("draft"),
  // customer info (denormalised for PDF stability even after customer edits)
  customerId: integer("customer_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  customerGstin: text("customer_gstin"),
  customerPan: text("customer_pan"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  placeOfSupply: text("place_of_supply"), // state code for CGST+SGST vs IGST
  // financials
  currency: text("currency").notNull().default("INR"),
  subtotal: real("subtotal").notNull().default(0),
  discountTotal: real("discount_total").notNull().default(0),
  taxTotal: real("tax_total").notNull().default(0),
  total: real("total").notNull().default(0),
  paidAmount: real("paid_amount").notNull().default(0),
  // dates
  issueDate: text("issue_date").notNull(), // YYYY-MM-DD
  dueDate: text("due_date"),
  // meta
  paymentTerms: text("payment_terms"),
  reference: text("reference"), // PO number, etc.
  notes: text("notes"),
  terms: text("terms"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Line items for an invoice
export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  productId: integer("product_id"), // optional — links to products table
  description: text("description").notNull(),
  hsnCode: text("hsn_code"),
  quantity: real("quantity").notNull().default(1),
  rate: real("rate").notNull().default(0),
  discountPercent: real("discount_percent").notNull().default(0),
  // tax: "none" | "gst" | "igst" | "vat"
  taxType: text("tax_type").notNull().default("gst"),
  taxRate: real("tax_rate").notNull().default(0), // percentage e.g. 18
  amount: real("amount").notNull().default(0), // final incl. discount, excl. tax
  taxAmount: real("tax_amount").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0), // amount + taxAmount
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Zod schemas ────────────────────────────────────────────────────────────────

export const insertInvoiceSettingsSchema = createInsertSchema(invoiceSettingsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertInvoiceSettings = z.infer<typeof insertInvoiceSettingsSchema>;
export type InvoiceSettings = typeof invoiceSettingsTable.$inferSelect;

export const insertInvoiceCustomerSchema = createInsertSchema(invoiceCustomersTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertInvoiceCustomer = z.infer<typeof insertInvoiceCustomerSchema>;
export type InvoiceCustomer = typeof invoiceCustomersTable.$inferSelect;

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({
  id: true, createdAt: true,
});
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
