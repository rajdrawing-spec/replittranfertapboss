import { pgTable, serial, text, real, integer, timestamp, index, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  barcode: text("barcode"),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  description: text("description"),
  shortDescription: text("short_description"),
  price: real("price").notNull().default(0),
  mrp: real("mrp").notNull().default(0),
  costPrice: real("cost_price").notNull().default(0),
  gst: real("gst").notNull().default(0),
  brand: text("brand"),
  weight: text("weight"),
  dimensions: text("dimensions"),
  hsn: text("hsn"),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(10),
  warehouseLocation: text("warehouse_location"),
  imageUrl: text("image_url"),
  status: text("status").notNull().default("active"), // active|discontinued|draft
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("products_company_id_idx").on(t.companyId),
  index("products_status_idx").on(t.status),
  index("products_sku_idx").on(t.sku),
]);

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const productVariantsTable = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  companyId: integer("company_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  barcode: text("barcode"),
  price: real("price").notNull().default(0),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  attributes: jsonb("attributes").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("product_variants_product_id_idx").on(t.productId),
  index("product_variants_company_id_idx").on(t.companyId),
  index("product_variants_sku_idx").on(t.sku),
]);

export const productImagesTable = pgTable("product_images", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  companyId: integer("company_id").notNull(),
  objectPath: text("object_path").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  altText: text("alt_text"),
  aiTags: jsonb("ai_tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("product_images_product_id_idx").on(t.productId),
  index("product_images_company_id_idx").on(t.companyId),
]);

export const productAiMetadataTable = pgTable("product_ai_metadata", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().unique(),
  companyId: integer("company_id").notNull(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  seoTags: jsonb("seo_tags").$type<string[]>().default([]),
  attributes: jsonb("attributes").$type<Record<string, string>>().default({}),
  healthScore: integer("health_score").default(0),
  aiAnalysis: jsonb("ai_analysis").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("product_ai_metadata_product_id_idx").on(t.productId),
  index("product_ai_metadata_company_id_idx").on(t.companyId),
]);

export const productMarketplaceTemplatesTable = pgTable("product_marketplace_templates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  marketplace: text("marketplace").notNull(),
  category: text("category").notNull(),
  template: jsonb("template").$type<Record<string, any>>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("product_marketplace_templates_company_id_idx").on(t.companyId),
  index("product_marketplace_templates_marketplace_idx").on(t.marketplace),
]);

export const productImportJobsTable = pgTable("product_import_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  status: text("status").notNull().default("pending"),
  filePath: text("file_path").notNull(),
  stats: jsonb("stats").$type<{ total: number; success: number; failed: number; errors: string[] }>().default({ total: 0, success: 0, failed: 0, errors: [] }),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("product_import_jobs_company_id_idx").on(t.companyId),
  index("product_import_jobs_status_idx").on(t.status),
]);

export const insertProductVariantSchema = createInsertSchema(productVariantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProductImageSchema = createInsertSchema(productImagesTable).omit({ id: true, createdAt: true });
export const insertProductAiMetadataSchema = createInsertSchema(productAiMetadataTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProductMarketplaceTemplateSchema = createInsertSchema(productMarketplaceTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProductImportJobSchema = createInsertSchema(productImportJobsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type ProductVariant = typeof productVariantsTable.$inferSelect;
export type NewProductVariant = typeof productVariantsTable.$inferInsert;
export type ProductImage = typeof productImagesTable.$inferSelect;
export type NewProductImage = typeof productImagesTable.$inferInsert;
export type ProductAiMetadata = typeof productAiMetadataTable.$inferSelect;
export type NewProductAiMetadata = typeof productAiMetadataTable.$inferInsert;
export type ProductMarketplaceTemplate = typeof productMarketplaceTemplatesTable.$inferSelect;
export type NewProductMarketplaceTemplate = typeof productMarketplaceTemplatesTable.$inferInsert;
export type ProductImportJob = typeof productImportJobsTable.$inferSelect;
export type NewProductImportJob = typeof productImportJobsTable.$inferInsert;
