import { Router } from "express";
import { z } from "zod";
import { db, productsTable, productAiMetadataTable, productImagesTable, productVariantsTable, productImportJobsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { isAiProductsEnabled } from "../lib/features";
import {
  analyzeProductImages, generateProductContent, generateMarketplaceTemplate,
  computeHealthScore, saveAiMetadata, generateBarcode, ensureUniqueSku, generateImageName,
  resizeProductImage, removeProductBackground, generateBarcodeImage, generateMarketplaceImages,
  importProductsXlsx, exportProductsXlsx,
} from "../lib/product-ai.service";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();

const IdParam = z.object({ productId: z.coerce.number() });
const MarketplaceParam = z.object({ productId: z.coerce.number(), marketplace: z.string() });
function parseParams(params: any) {
  return { productId: String(params.productId), marketplace: params.marketplace ? String(params.marketplace) : undefined };
}

function gate(req: any, res: any) {
  if (!isAiProductsEnabled()) { res.status(404).json({ error: "AI products module is disabled" }); return false; }
  return true;
}

function ensureCompany(req: any, res: any, companyId?: number) {
  if (companyId == null) { res.status(400).json({ error: "Missing companyId" }); return false; }
  if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

router.post("/ai-products/:productId/analyze-images", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const { objectPaths } = z.object({ objectPaths: z.array(z.string()) }).parse(req.body);
    if (!objectPaths.length) { res.status(400).json({ error: "At least one image is required" }); return; }
    const [product] = await db.select({ companyId: productsTable.companyId, name: productsTable.name, brand: productsTable.brand, category: productsTable.category, subcategory: productsTable.subcategory, weight: productsTable.weight, dimensions: productsTable.dimensions }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;

    const result = await analyzeProductImages(objectPaths);
    await saveAiMetadata(productId, {
      keywords: result.keywords,
      seoTags: result.seoTags,
      attributes: result.attributes,
      aiAnalysis: result as any,
    });

    const brand = result.attributes?.Brand || product.brand || "";
    const category = result.category || product.category || "";
    const color = result.attributes?.Color || "";
    const images = await Promise.all(
      objectPaths.map((objectPath, i) => {
        const angle = i === 0 ? "front" : i === 1 ? "back" : i === 2 ? "side" : `angle-${i}`;
        return db.insert(productImagesTable).values({
          productId,
          companyId: product.companyId,
          objectPath,
          aiTags: result.tags,
          altText: generateImageName(product.name, brand, category, color, angle, i),
          isPrimary: i === 0,
        }).returning();
      })
    );
    const score = await computeHealthScore(productId);
    await saveAiMetadata(productId, { healthScore: score });
    const autoFill = {
      name: result.suggestedName || product.name,
      category: result.category || product.category,
      subcategory: result.subcategory || product.subcategory,
      brand: result.attributes?.Brand || product.brand,
      attributes: result.attributes,
      keywords: result.keywords,
      seoTags: result.seoTags,
      color: result.attributes?.Color || "",
      size: result.attributes?.Size || "",
      weight: result.attributes?.Weight || product.weight,
      dimensions: result.attributes?.Dimensions || product.dimensions,
      material: result.attributes?.Material || "",
      sleeveType: result.attributes?.["Sleeve Type"] || "",
      neckType: result.attributes?.["Neck Type"] || "",
      pattern: result.attributes?.Pattern || "",
      occasion: result.attributes?.Occasion || "",
      season: result.attributes?.Season || "",
      fit: result.attributes?.Fit || "",
      length: result.attributes?.Length || "",
      style: result.attributes?.Style || "",
      gender: result.attributes?.Gender || "",
      ageGroup: result.attributes?.["Age Group"] || "",
    };
    res.json({ ...result, autoFill, imageIds: images.map(img => img[0]?.id), healthScore: score });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Image analysis failed" }); }
});

router.post("/ai-products/:productId/generate-content", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { hint } = z.object({ hint: z.string().optional() }).parse(req.body);
    const result = await generateProductContent(productId, hint);
    res.json(result);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Content generation failed" }); }
});

router.post("/ai-products/:productId/apply-content", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { name, shortDescription, description, seoTitle, seoDescription, keywords, seoTags, attributes, category, subcategory, suggestedPrice, mrp, brand, weight, dimensions, hsn, gst } = z.object({
      name: z.string().optional(), shortDescription: z.string().optional(), description: z.string().optional(),
      seoTitle: z.string().optional(), seoDescription: z.string().optional(),
      keywords: z.array(z.string()).optional(), seoTags: z.array(z.string()).optional(),
      attributes: z.record(z.string(), z.string()).optional(), category: z.string().optional(), subcategory: z.string().optional(),
      suggestedPrice: z.number().nullable().optional(), mrp: z.number().nullable().optional(),
      brand: z.string().optional(), weight: z.string().optional(), dimensions: z.string().optional(),
      hsn: z.string().optional(), gst: z.number().nullable().optional(),
    }).parse(req.body);

    await db.update(productsTable).set({
      name: name ?? undefined, shortDescription: shortDescription ?? undefined, description: description ?? undefined,
      category: category ?? undefined, subcategory: subcategory ?? undefined,
      price: suggestedPrice ?? undefined, mrp: mrp ?? undefined,
      brand: brand ?? undefined, weight: weight ?? undefined, dimensions: dimensions ?? undefined,
      hsn: hsn ?? undefined, gst: gst ?? undefined,
      updatedAt: new Date(),
    }).where(eq(productsTable.id, productId));
    await saveAiMetadata(productId, { seoTitle, seoDescription, keywords, seoTags, attributes });
    const score = await computeHealthScore(productId);
    await saveAiMetadata(productId, { healthScore: score });
    res.json({ ok: true, healthScore: score });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to apply content" }); }
});

router.post("/ai-products/:productId/generate-sku", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) {
      // Allow SKU generation for a new product when the body contains name/category/companyId.
      const { name, category, companyId } = z.object({ name: z.string(), category: z.string(), companyId: z.number() }).parse(req.body);
      if (!ensureCompany(req, res, companyId)) return;
      const sku = await ensureUniqueSku(companyId, name, category);
      res.json({ sku });
      return;
    }
    const sku = await ensureUniqueSku(product.companyId, product.name, product.category);
    res.json({ sku });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "SKU generation failed" }); }
});

router.post("/ai-products/:productId/generate-barcode", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    res.json({ barcode: generateBarcode() });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Barcode generation failed" }); }
});

router.post("/ai-products/:productId/marketplace/:marketplace", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId, marketplace } = MarketplaceParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const result = await generateMarketplaceTemplate(productId, marketplace);
    res.json(result);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Marketplace template generation failed" }); }
});

router.post("/ai-products/:productId/images/:imageIndex/resize", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId, imageIndex } = z.object({ productId: z.coerce.number(), imageIndex: z.coerce.number() }).parse(req.params);
    const { width, height } = z.object({ width: z.number(), height: z.number() }).parse(req.body);
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const images = await db.select({ objectPath: productImagesTable.objectPath }).from(productImagesTable).where(eq(productImagesTable.productId, productId)).orderBy(productImagesTable.id).limit(50);
    const img = images[imageIndex];
    if (!img) { res.status(404).json({ error: "Image not found" }); return; }
    const result = await resizeProductImage(img.objectPath, width, height);
    const [newImg] = await db.insert(productImagesTable).values({ productId, companyId: product.companyId, objectPath: result.objectPath, altText: `${width}x${height}` }).returning();
    res.json({ ...result, imageId: newImg.id });
  } catch (e) { req.log.error(e); res.status(500).json({ error: (e as Error).message }); }
});

router.post("/ai-products/:productId/images/:imageIndex/remove-background", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId, imageIndex } = z.object({ productId: z.coerce.number(), imageIndex: z.coerce.number() }).parse(req.params);
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const images = await db.select({ objectPath: productImagesTable.objectPath }).from(productImagesTable).where(eq(productImagesTable.productId, productId)).orderBy(productImagesTable.id).limit(50);
    const img = images[imageIndex];
    if (!img) { res.status(404).json({ error: "Image not found" }); return; }
    const result = await removeProductBackground(img.objectPath);
    const [newImg] = await db.insert(productImagesTable).values({ productId, companyId: product.companyId, objectPath: result.objectPath, altText: "no-bg" }).returning();
    res.json({ ...result, imageId: newImg.id });
  } catch (e) { req.log.error(e); res.status(500).json({ error: (e as Error).message }); }
});

router.post("/ai-products/:productId/health-score", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const score = await computeHealthScore(productId);
    await saveAiMetadata(productId, { healthScore: score });
    res.json({ score });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Health score failed" }); }
});

router.get("/ai-products/:productId/ai-metadata", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const [meta] = await db.select().from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
    const images = await db.select().from(productImagesTable).where(eq(productImagesTable.productId, productId));
    const variants = await db.select().from(productVariantsTable).where(eq(productVariantsTable.productId, productId));
    res.json({ metadata: meta || null, images, variants });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to load metadata" }); }
});

router.post("/products/:productId/variants", requirePermission("inventory.write"), async (req, res) => {
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { sku, name, barcode, price, stockQuantity, attributes } = z.object({
      sku: z.string(), name: z.string(), barcode: z.string().optional(), price: z.number(), stockQuantity: z.number(), attributes: z.record(z.string(), z.string()).optional(),
    }).parse(req.body);
    const [v] = await db.insert(productVariantsTable).values({ productId, companyId: product.companyId, sku, name, barcode, price, stockQuantity, attributes }).returning();
    res.status(201).json(v);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to create variant" }); }
});

router.delete("/products/:productId/variants/:variantId", requirePermission("inventory.write"), async (req, res) => {
  try {
    const variantId = parseInt(String(req.params.variantId));
    const [variant] = await db.delete(productVariantsTable).where(eq(productVariantsTable.id, variantId)).returning();
    if (!variant) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete variant" }); }
});

router.post("/products/:productId/images", requirePermission("inventory.write"), async (req, res) => {
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { objectPath, altText, isPrimary } = z.object({ objectPath: z.string(), altText: z.string().optional(), isPrimary: z.boolean().default(false) }).parse(req.body);
    if (isPrimary) await db.update(productImagesTable).set({ isPrimary: false }).where(eq(productImagesTable.productId, productId));
    const [img] = await db.insert(productImagesTable).values({ productId, companyId: product.companyId, objectPath, altText, isPrimary }).returning();
    res.status(201).json(img);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to add image" }); }
});

router.delete("/products/:productId/images/:imageId", requirePermission("inventory.write"), async (req, res) => {
  try {
    const imageId = parseInt(String(req.params.imageId));
    const [img] = await db.delete(productImagesTable).where(eq(productImagesTable.id, imageId)).returning();
    if (!img) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to delete image" }); }
});

router.post("/ai-products/:productId/import-csv", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const { objectPath } = z.object({ objectPath: z.string() }).parse(req.body);
    const [job] = await db.insert(productImportJobsTable).values({ companyId: product.companyId, filePath: objectPath, status: "pending" }).returning();
    res.json({ jobId: job.id, status: "pending" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import failed" }); }
});

router.post("/ai-products/import-csv", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { companyId, objectPath, csv } = z.object({
      companyId: z.number(),
      objectPath: z.string().optional(),
      csv: z.string().optional(),
    }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;

    // If CSV content is sent directly, process synchronously (avoids object-storage upload issues).
    if (csv != null) {
      const csvText = csv.replace(/^\uFEFF/, "");
      const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
      if (records.length === 0) {
        res.json({ total: 0, success: 0, failed: 0, errors: [] });
        return;
      }
      const normalizedRecords = records.map(row => {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          const normalizedKey = key.replace(/^\uFEFF/, "").trim().toLowerCase();
          next[normalizedKey] = value;
        }
        return next;
      });
      const requiredHeaders = ["name", "sku", "category", "price"];
      const missingHeaders = requiredHeaders.filter(h => !(h in normalizedRecords[0]));
      if (missingHeaders.length > 0) {
        res.status(400).json({ error: `Missing required headers: ${missingHeaders.join(", ")}` });
        return;
      }

      let success = 0, failed = 0;
      const errors: string[] = [];
      for (const row of normalizedRecords) {
        try {
          const name = row.name?.trim() || "Untitled";
          if (name === "Untitled" && !row.name?.trim()) throw new Error("Name is required");
          await db.insert(productsTable).values({
            companyId, name, sku: row.sku?.trim() || generateBarcode(), brand: row.brand?.trim(),
            category: row.category?.trim() || "General", subcategory: row.subcategory?.trim(),
            description: row.description?.trim(), shortDescription: row.shortdescription?.trim(),
            price: cleanNumber(row.price), mrp: cleanNumber(row.mrp), costPrice: cleanNumber(row.costprice),
            gst: cleanNumber(row.gst), stockQuantity: cleanInteger(row.stockquantity), reorderLevel: cleanInteger(row.reorderlevel) || 10,
            weight: row.weight?.trim(), dimensions: row.dimensions?.trim(), hsn: row.hsn?.trim(),
            warehouseLocation: row.warehouselocation?.trim(), status: row.status?.trim() || "active",
          });
          success++;
        } catch (err: any) {
          failed++;
          errors.push(`${row.name || "row"}: ${err.message}`);
        }
      }
      res.json({ total: normalizedRecords.length, success, failed, errors });
      return;
    }

    // Legacy flow: object-storage file path provided.
    if (!objectPath) { res.status(400).json({ error: "Missing csv or objectPath" }); return; }
    const [job] = await db.insert(productImportJobsTable).values({ companyId, filePath: objectPath, status: "pending" }).returning();
    res.json({ jobId: job.id, status: "pending" });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import failed" }); }
});

function cleanNumber(value: string | undefined): number {
  if (!value) return 0;
  // Remove currency symbols, commas, and whitespace; keep digits, decimal point, and minus sign.
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function cleanInteger(value: string | undefined): number {
  const num = Math.round(cleanNumber(value));
  return Number.isFinite(num) ? num : 0;
}

router.post("/ai-products/import-jobs/:jobId/process", requirePermission("inventory.write"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const jobId = parseInt(String(req.params.jobId));
    const [job] = await db.select().from(productImportJobsTable).where(eq(productImportJobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Not found" }); return; }
    if (!ensureCompany(req, res, job.companyId)) return;

    await db.update(productImportJobsTable).set({ status: "running", updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
    let csv: string;
    if (job.filePath.startsWith("data:")) {
      const base64 = job.filePath.split(",")[1] || "";
      csv = Buffer.from(base64, "base64").toString("utf-8").replace(/^\uFEFF/, "");
    } else {
      const file = await storage.getObjectEntityFile(job.filePath);
      const stream = file.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      csv = Buffer.concat(chunks).toString("utf-8").replace(/^\uFEFF/, "");
    }
    const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    if (records.length === 0) {
      await db.update(productImportJobsTable).set({ status: "completed", stats: { total: 0, success: 0, failed: 0, errors: [] }, updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
      res.json({ total: 0, success: 0, failed: 0, errors: [] });
      return;
    }

    // Normalize headers to lower-case and strip leading BOM char if present.
    const normalizedRecords = records.map(row => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = key.replace(/^\uFEFF/, "").trim().toLowerCase();
        next[normalizedKey] = value;
      }
      return next;
    });

    const requiredHeaders = ["name", "sku", "category", "price"];
    const firstRow = normalizedRecords[0];
    const missingHeaders = requiredHeaders.filter(h => !(h in firstRow));
    if (missingHeaders.length > 0) {
      await db.update(productImportJobsTable).set({ status: "failed", error: `Missing required headers: ${missingHeaders.join(", ")}`, updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
      res.status(400).json({ error: `Missing required headers: ${missingHeaders.join(", ")}` });
      return;
    }

    let success = 0, failed = 0;
    const errors: string[] = [];
    for (const row of normalizedRecords) {
      try {
        const name = row.name?.trim() || "Untitled";
        const sku = row.sku?.trim() || generateBarcode();
        const price = cleanNumber(row.price);
        const costPrice = cleanNumber(row.costprice);
        if (name === "Untitled" && !row.name?.trim()) {
          throw new Error("Name is required");
        }
        await db.insert(productsTable).values({
          companyId: job.companyId,
          name, sku, brand: row.brand?.trim(), category: row.category?.trim() || "General", subcategory: row.subcategory?.trim(),
          description: row.description?.trim(), shortDescription: row.shortdescription?.trim(),
          price, mrp: cleanNumber(row.mrp), costPrice,
          gst: cleanNumber(row.gst), stockQuantity: cleanInteger(row.stockquantity),
          reorderLevel: cleanInteger(row.reorderlevel) || 10,
          weight: row.weight?.trim(), dimensions: row.dimensions?.trim(), hsn: row.hsn?.trim(),
          warehouseLocation: row.warehouselocation?.trim(),
          status: row.status?.trim() || "active",
        });
        success++;
      } catch (err: any) {
        failed++;
        errors.push(`${row.name || "row"}: ${err.message}`);
      }
    }
    await db.update(productImportJobsTable).set({ status: "completed", stats: { total: normalizedRecords.length, success, failed, errors }, updatedAt: new Date() }).where(eq(productImportJobsTable.id, jobId));
    res.json({ total: normalizedRecords.length, success, failed, errors });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Import processing failed" }); }
});

router.post("/ai-products/export-csv", requirePermission("inventory.read"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const { companyId } = z.object({ companyId: z.number() }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;
    const items = await db.select().from(productsTable).where(eq(productsTable.companyId, companyId));
    const rows = items.map(p => ({
      name: p.name, sku: p.sku, barcode: p.barcode, brand: p.brand, category: p.category, subcategory: p.subcategory,
      description: p.description, shortDescription: p.shortDescription,
      price: p.price, mrp: p.mrp, costPrice: p.costPrice, gst: p.gst,
      stockQuantity: p.stockQuantity, reorderLevel: p.reorderLevel,
      weight: p.weight, dimensions: p.dimensions, hsn: p.hsn,
      warehouseLocation: p.warehouseLocation, status: p.status,
    }));
    const csv = stringify(rows, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products.csv");
    res.send(csv);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Export failed" }); }
});

router.get("/ai-products/import-jobs", requirePermission("inventory.read"), async (req, res) => {
  if (!gate(req, res)) return;
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
    if (companyId != null && !ensureCompany(req, res, companyId)) return;
    const where = companyId != null ? eq(productImportJobsTable.companyId, companyId) : undefined;
    const jobs = await db.select().from(productImportJobsTable).where(where).orderBy(desc(productImportJobsTable.createdAt)).limit(50);
    res.json(jobs);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Failed to list jobs" }); }
});

// ── Barcode image (bwip-js) ─────────────────────────────────────────────────
router.post("/ai-products/:productId/barcode-image", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const [product] = await db.select({ companyId: productsTable.companyId, barcode: productsTable.barcode }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const barcode = product.barcode || generateBarcode();
    if (!product.barcode) await db.update(productsTable).set({ barcode, updatedAt: new Date() }).where(eq(productsTable.id, productId));
    const { objectPath } = await generateBarcodeImage(barcode, "code128");
    res.json({ barcode, objectPath });
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Barcode image generation failed" }); }
});

// ── Marketplace image variants (auto-resize for Amazon, Flipkart, etc.) ──────
router.post("/ai-products/:productId/generate-marketplace-images", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { productId } = IdParam.parse(parseParams(req.params));
    const { imageIndex = 0 } = z.object({ imageIndex: z.number().optional() }).parse(req.body);
    const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
    if (!product || !ensureCompany(req, res, product.companyId)) return;
    const images = await db.select({ objectPath: productImagesTable.objectPath }).from(productImagesTable).where(eq(productImagesTable.productId, productId)).orderBy(productImagesTable.id).limit(50);
    const img = images[imageIndex];
    if (!img) { res.status(404).json({ error: "Image not found" }); return; }
    const results = await generateMarketplaceImages(img.objectPath);
    const stored = await Promise.all(results.map((r) => db.insert(productImagesTable).values({ productId, companyId: product.companyId, objectPath: r.objectPath, altText: r.purpose }).returning()));
    res.json({ results, imageIds: stored.map((s) => s[0].id) });
  } catch (e) { req.log.error(e); res.status(500).json({ error: (e as Error).message }); }
});

// ── Excel import/export ─────────────────────────────────────────────────────
router.post("/ai-products/import-xlsx", requirePermission("inventory.write"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { companyId, base64 } = z.object({ companyId: z.number(), base64: z.string() }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;
    const buffer = Buffer.from(base64, "base64");
    const stats = await importProductsXlsx(companyId, buffer);
    res.json(stats);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Excel import failed" }); }
});

router.post("/ai-products/export-xlsx", requirePermission("inventory.read"), async (req: any, res: any) => {
  if (!gate(req, res)) return;
  try {
    const { companyId } = z.object({ companyId: z.number() }).parse(req.body);
    if (!ensureCompany(req, res, companyId)) return;
    const buffer = await exportProductsXlsx(companyId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
    res.send(buffer);
  } catch (e) { req.log.error(e); res.status(500).json({ error: "Excel export failed" }); }
});

export default router;
