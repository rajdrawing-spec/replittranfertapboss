import { db, productsTable, productAiMetadataTable, productImagesTable, productVariantsTable, productMarketplaceTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getActiveProvider, AiProvider, geminiProvider, getConfig } from "./ai-provider";
import { ObjectStorageService } from "./objectStorage";
import { randomUUID } from "crypto";
import sharp from "sharp";
import * as bwipjs from "bwip-js/node";
import * as XLSX from "xlsx";

const storage = new ObjectStorageService();

function isDataUrl(path: string): boolean {
  return typeof path === 'string' && path.startsWith('data:');
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([a-zA-Z0-9+/_.-]+);base64,(.*)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function dataUrlFromBuffer(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function normalizeObjectPath(path: string): string {
  if (!path) return "";
  if (path.startsWith("/objects/")) return path;
  if (path.startsWith("https://storage.googleapis.com/")) {
    return storage.normalizeObjectEntityPath(path);
  }
  return path;
}

async function downloadBuffer(objectPath: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (isDataUrl(objectPath)) {
    const parsed = parseDataUrl(objectPath);
    if (!parsed) return null;
    return { buffer: Buffer.from(parsed.base64, 'base64'), mimeType: parsed.mimeType };
  }
  try {
    const file = await storage.getObjectEntityFile(normalizeObjectPath(objectPath));
    const [metadata] = await file.getMetadata();
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    return { buffer, mimeType: metadata.contentType || "image/jpeg" };
  } catch (e) {
    return null;
  }
}

async function downloadBase64(objectPath: string): Promise<{ base64: string; mimeType: string } | null> {
  if (isDataUrl(objectPath)) {
    const parsed = parseDataUrl(objectPath);
    if (!parsed) return null;
    return { base64: parsed.base64, mimeType: parsed.mimeType };
  }
  const file = await downloadBuffer(objectPath);
  if (!file) return null;
  return { base64: file.buffer.toString("base64"), mimeType: file.mimeType };
}

async function chat(provider: AiProvider, system: string, prompt: string): Promise<string> {
  return provider.chat([{ role: "user", content: prompt }], system);
}

function parseJson(text: string): any {
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/);
    return JSON.parse(m ? m[1] : text);
  } catch {
    return null;
  }
}

function generateSku(name: string, category: string, companyId: number, existing: string[]): string {
  const prefix = category.slice(0, 3).toUpperCase() || "PRD";
  const slug = name.split(/[^a-zA-Z0-9]/).filter(Boolean).slice(0, 2).join("").toUpperCase();
  let sku = `${prefix}-${slug}-${companyId}`;
  let suffix = 1;
  while (existing.includes(sku)) sku = `${prefix}-${slug}-${companyId}-${suffix++}`;
  return sku;
}

export interface ImageQualityReport {
  score: number;
  issues: string[];
  resolutionOk: boolean;
  aspectRatioOk: boolean;
  whiteBackground: boolean;
  blur: boolean;
  brightnessOk: boolean;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
}

export interface ImageAnalysisResult {
  tags: string[];
  suggestedName: string;
  category: string;
  subcategory: string;
  attributes: Record<string, string>;
  keywords: string[];
  seoTags: string[];
  quality: ImageQualityReport;
  marketplaceReady: boolean;
  suggestions: string[];
}

export interface ProductGenerationResult {
  name: string;
  shortDescription: string;
  description: string;
  amazonDescription: string;
  flipkartDescription: string;
  shopifyDescription: string;
  seoDescription: string;
  seoTitle: string;
  keywords: string[];
  seoTags: string[];
  attributes: Record<string, string>;
  category: string;
  subcategory: string;
  suggestedPrice: number | null;
  mrp: number | null;
  brand: string;
  color: string;
  size: string;
  weight: string;
  dimensions: string;
  hsn: string;
  gst: number | null;
}

export interface MarketplaceTemplateResult {
  title: string;
  description: string;
  bulletPoints: string[];
  keywords: string[];
  category: string;
  imageRequirements: string[];
}

const VISION_PROMPT = `Analyze this product image for an e-commerce catalog (India marketplaces: Amazon, Flipkart, Myntra, Shopify, Ajio).
Return JSON only. Detect everything visible and be specific:
{
  "tags": [string],
  "suggestedName": string,
  "category": string,
  "subcategory": string,
  "attributes": {
    "Gender": "Men|Women|Kids|Unisex",
    "Color": string,
    "Secondary Color": string,
    "Material": string,
    "Fabric": string,
    "Pattern": string,
    "Sleeve Type": string,
    "Neck Type": string,
    "Occasion": string,
    "Season": string,
    "Fit": string,
    "Length": string,
    "Style": string,
    "Product Type": string,
    "Age Group": "Adult|Kids|Teen|Baby"
  },
  "keywords": [string],
  "seoTags": [string],
  "marketplaceReady": boolean,
  "suggestions": [string]
}`;

function mergeQuality(local: ImageQualityReport, ai: Partial<ImageQualityReport>): ImageQualityReport {
  const width = local.width;
  const height = local.height;
  const resolutionOk = width >= 1000 && height >= 1000;
  const aspectRatioOk = Math.abs(width / height - 1) < 0.2;
  const whiteBackground = ai.whiteBackground ?? local.whiteBackground;
  const blur = local.blur;
  const brightnessOk = local.brightnessOk;
  const issues = Array.from(new Set([...(local.issues || []), ...(ai.issues || [])]));
  const score = Math.round((local.score + (ai.score ?? 0)) / 2);
  return { score, issues, resolutionOk, aspectRatioOk, whiteBackground, blur, brightnessOk, width, height, brightness: local.brightness, contrast: local.contrast };
}

export async function analyzeImageQuality(objectPath: string): Promise<ImageQualityReport> {
  const image = await downloadBuffer(objectPath);
  if (!image) throw new Error("Image not found");
  const { data, info } = await sharp(image.buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;

  const totalPixels = width * height;
  let sumR = 0, sumG = 0, sumB = 0;
  let variance = 0;
  let whiteCount = 0;
  const gray = new Float32Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    sumR += r; sumG += g; sumB += b;
    const l = (r + g + b) / 3;
    gray[i] = l;
    if (r > 240 && g > 240 && b > 240) whiteCount++;
  }

  const meanR = sumR / totalPixels;
  const meanG = sumG / totalPixels;
  const meanB = sumB / totalPixels;
  const brightness = Math.round((meanR + meanG + meanB) / 3);
  for (let i = 0; i < totalPixels; i++) variance += Math.pow(gray[i] - brightness, 2);
  const contrast = Math.round(Math.sqrt(variance / totalPixels));

  let lapSum = 0, lapSq = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i] * 4 - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      lapSum += v;
      lapSq += v * v;
    }
  }
  const lapVar = (lapSq - (lapSum * lapSum) / (totalPixels - 1)) / (totalPixels - 1);
  const blur = lapVar < 100;

  const whiteBackground = whiteCount / totalPixels > 0.5;
  const resolutionOk = width >= 1000 && height >= 1000;
  const aspectRatioOk = Math.abs(width / height - 1) < 0.2;
  const brightnessOk = brightness > 80 && brightness < 220;

  const issues: string[] = [];
  if (!resolutionOk) issues.push(`Resolution ${width}x${height} is below 1000x1000`);
  if (!aspectRatioOk) issues.push(`Aspect ratio not square (1:1 recommended for marketplaces)`);
  if (!brightnessOk) issues.push(brightness < 80 ? "Too dark" : "Too bright");
  if (blur) issues.push("Image appears blurry");
  if (!whiteBackground) issues.push("Background is not white");
  if (contrast < 30) issues.push("Low contrast");

  let score = 100;
  score -= !resolutionOk ? 20 : 0;
  score -= !aspectRatioOk ? 10 : 0;
  score -= !brightnessOk ? 15 : 0;
  score -= blur ? 20 : 0;
  score -= !whiteBackground ? 10 : 0;
  score -= contrast < 30 ? 10 : 0;
  score = Math.max(0, score);

  return { score, issues, resolutionOk, aspectRatioOk, whiteBackground, blur, brightnessOk, width, height, brightness, contrast };
}

async function analyzeWithProvider(objectPaths: string[]): Promise<ImageAnalysisResult> {
  const provider = await getActiveProvider();
  const images = await Promise.all(objectPaths.map(downloadBase64));
  const valid = images.filter((img): img is { base64: string; mimeType: string } => !!img);
  if (!valid.length) throw new Error("No images found");

  const promptText = objectPaths.length === 1
    ? VISION_PROMPT
    : `Analyze these ${objectPaths.length} product images for an e-commerce catalog. They show the same product from different angles. Combine all views into one catalog entry.\n${VISION_PROMPT}`;

  const system = "You are an expert e-commerce product cataloger. Return only valid JSON.";
  const vision = provider.chatVision ? provider.chatVision.bind(provider) : geminiProvider.chatVision!.bind(geminiProvider);
  const text = await vision({ role: "user", text: promptText, images: valid }, system);

  const parsed = parseJson(text) || {};
  return {
    tags: parsed.tags || [],
    suggestedName: parsed.suggestedName || "",
    category: parsed.category || "Uncategorized",
    subcategory: parsed.subcategory || "",
    attributes: parsed.attributes || {},
    keywords: parsed.keywords || [],
    seoTags: parsed.seoTags || [],
    quality: parsed.quality || { score: 0, issues: [], resolutionOk: false, aspectRatioOk: false, whiteBackground: false, blur: false, brightnessOk: false },
    marketplaceReady: parsed.marketplaceReady ?? false,
    suggestions: parsed.suggestions || ["Could not analyze image"],
  };
}

export async function analyzeProductImage(objectPath: string): Promise<ImageAnalysisResult> {
  const [ai, local] = await Promise.all([
    analyzeWithProvider([objectPath]),
    analyzeImageQuality(objectPath),
  ]);
  ai.quality = mergeQuality(local, ai.quality);
  return ai;
}

export async function analyzeProductImages(objectPaths: string[]): Promise<ImageAnalysisResult> {
  if (objectPaths.length === 0) throw new Error("No images provided");
  if (objectPaths.length === 1) return analyzeProductImage(objectPaths[0]);

  const [ai, localReports] = await Promise.all([
    analyzeWithProvider(objectPaths),
    Promise.all(objectPaths.map((p) => analyzeImageQuality(p))),
  ]);
  const bestLocal = localReports.reduce((best, current) => (current.score > best.score ? current : best), localReports[0]);
  ai.quality = mergeQuality(bestLocal, ai.quality);
  return ai;
}

export async function generateProductContent(productId: number, promptHint?: string): Promise<ProductGenerationResult> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) throw new Error("Product not found");
  const meta = await db.select().from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
  const m = meta[0];

  const provider = await getActiveProvider();
  const system = "You are an e-commerce copywriter for Indian marketplaces. Return only valid JSON.";
  const prompt = `Write a complete product listing for "${product.name}" (category: ${product.category}, subcategory: ${product.subcategory || "none"}, price: ₹${product.price}, MRP: ₹${product.mrp || product.price}).
Existing attributes: ${JSON.stringify(m?.attributes || {})}. Keywords: ${m?.keywords?.join(", ") || "none"}. SEO tags: ${m?.seoTags?.join(", ") || "none"}.
Additional context: ${promptHint || "none"}.
Return JSON:
{
  "name": "catchy product name",
  "shortDescription": "30-50 word description",
  "description": "long HTML/marketing description",
  "amazonDescription": "Amazon India style description",
  "flipkartDescription": "Flipkart style description",
  "shopifyDescription": "Shopify style description",
  "seoDescription": "150-160 character meta description",
  "seoTitle": "SEO title under 70 chars",
  "keywords": [string],
  "seoTags": [string],
  "attributes": {key: string value},
  "category": string,
  "subcategory": string,
  "suggestedPrice": number | null,
  "mrp": number | null,
  "brand": string,
  "color": string,
  "size": string,
  "weight": string,
  "dimensions": string,
  "hsn": string,
  "gst": number | null
}`;

  const text = await chat(provider, system, prompt);
  const parsed = parseJson(text) || {
    name: product.name, shortDescription: product.description || "", description: product.description || "",
    amazonDescription: product.description || "", flipkartDescription: product.description || "",
    shopifyDescription: product.description || "", seoDescription: product.description || "", seoTitle: product.name,
    keywords: [], seoTags: [], attributes: {}, category: product.category, subcategory: product.subcategory || "",
    suggestedPrice: null, mrp: null, brand: product.brand || "", color: "", size: "", weight: product.weight || "",
    dimensions: product.dimensions || "", hsn: product.hsn || "", gst: null,
  };
  parsed.suggestedPrice = typeof parsed.suggestedPrice === "number" ? parsed.suggestedPrice : null;
  parsed.mrp = typeof parsed.mrp === "number" ? parsed.mrp : null;
  parsed.gst = typeof parsed.gst === "number" ? parsed.gst : null;
  return parsed as ProductGenerationResult;
}

export async function ensureUniqueSku(companyId: number, name: string, category: string, brand?: string): Promise<string> {
  const rows = await db.select({ sku: productsTable.sku }).from(productsTable).where(eq(productsTable.companyId, companyId));
  const existing = rows.map(r => r.sku);
  return generateSku(name, category, companyId, existing);
}

export async function generateMarketplaceTemplate(productId: number, marketplace: string): Promise<MarketplaceTemplateResult> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) throw new Error("Product not found");
  const meta = await db.select().from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
  const m = meta[0];

  const provider = await getActiveProvider();
  const system = "You are an e-commerce marketplace listing specialist. Return only valid JSON.";
  const prompt = `Create a ${marketplace} listing for "${product.name}" (category: ${product.category}, price: ${product.price}).
Description: ${product.description || "none"}. Keywords: ${m?.keywords?.join(", ") || "none"}. Attributes: ${JSON.stringify(m?.attributes || {})}.
Return JSON: {
  "title": string,
  "description": string,
  "bulletPoints": [string],
  "keywords": [string],
  "category": string,
  "imageRequirements": [string]
}`;

  const text = await chat(provider, system, prompt);
  const parsed = parseJson(text) || {
    title: product.name, description: product.description || "", bulletPoints: [],
    keywords: m?.keywords || [], category: product.category, imageRequirements: [],
  };
  return parsed as MarketplaceTemplateResult;
}

export async function computeHealthScore(productId: number): Promise<number> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return 0;
  const [meta] = await db.select().from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
  const images = await db.select().from(productImagesTable).where(eq(productImagesTable.productId, productId));
  const variants = await db.select().from(productVariantsTable).where(eq(productVariantsTable.productId, productId));

  let score = 0;
  if (product.name && product.name.length > 3) score += 10;
  if (product.description && product.description.length > 20) score += 10;
  if (product.shortDescription && product.shortDescription.length > 10) score += 5;
  if (product.sku) score += 10;
  if (product.barcode) score += 10;
  if (product.brand) score += 5;
  if (product.hsn) score += 5;
  if (product.weight) score += 5;
  if (product.dimensions) score += 5;
  if (product.price > 0 && product.mrp > 0) score += 10;
  if (images.length > 0) score += 10;
  if (images.some(i => i.isPrimary)) score += 5;
  if (meta?.keywords?.length) score += 5;
  if (meta?.seoTags?.length) score += 5;
  if (meta?.seoTitle && meta?.seoDescription) score += 5;
  if (variants.length > 0) score += 5;
  return Math.min(100, score);
}

export async function saveAiMetadata(productId: number, data: Partial<typeof productAiMetadataTable.$inferInsert>) {
  const [product] = await db.select({ companyId: productsTable.companyId }).from(productsTable).where(eq(productsTable.id, productId));
  if (!product) throw new Error("Product not found");
  const existing = await db.select({ id: productAiMetadataTable.id }).from(productAiMetadataTable).where(eq(productAiMetadataTable.productId, productId));
  if (existing.length > 0) {
    await db.update(productAiMetadataTable).set({ ...data, updatedAt: new Date() }).where(eq(productAiMetadataTable.productId, productId));
  } else {
    await db.insert(productAiMetadataTable).values({ productId, companyId: product.companyId, ...data });
  }
}

export function generateImageName(productName: string, brand: string, category: string, color: string, angle: string, index: number): string {
  const parts = [brand, category, color, productName, angle]
    .filter(Boolean)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .slice(0, 5);
  const slug = parts.join("-").slice(0, 80);
  return `${slug}-${index + 1}.jpg`;
}

export interface ResizeResult {
  objectPath: string;
  width: number;
  height: number;
  originalSize: number;
  newSize: number;
  purpose: string;
}

export interface MarketplaceSpec {
  width: number;
  height: number;
  format: "webp" | "jpeg" | "png";
  quality: number;
  purpose: string;
}

export const MARKETPLACE_SPECS: MarketplaceSpec[] = [
  { width: 2000, height: 2000, format: "jpeg", quality: 90, purpose: "amazon" },
  { width: 1000, height: 1000, format: "webp", quality: 85, purpose: "flipkart" },
  { width: 1080, height: 1350, format: "webp", quality: 85, purpose: "myntra" },
  { width: 1080, height: 1440, format: "webp", quality: 85, purpose: "ajio" },
  { width: 2048, height: 2048, format: "webp", quality: 90, purpose: "shopify" },
  { width: 1080, height: 1080, format: "webp", quality: 80, purpose: "instagram" },
  { width: 1200, height: 628, format: "jpeg", quality: 80, purpose: "facebook" },
  { width: 800, height: 800, format: "webp", quality: 80, purpose: "whatsapp-catalog" },
  { width: 300, height: 300, format: "webp", quality: 80, purpose: "thumbnail" },
];

export async function resizeProductImage(objectPath: string, width: number, height: number, purpose = "custom", format: "webp" | "jpeg" | "png" = "jpeg", quality = 90): Promise<ResizeResult> {
  const source = await downloadBuffer(objectPath);
  if (!source) throw new Error("Image not found");
  const { buffer: originalBuffer, mimeType: originalMimeType } = source;

  let pipeline = sharp(originalBuffer).resize(width, height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } });
  if (format === "webp") pipeline = pipeline.webp({ quality });
  else if (format === "png") pipeline = pipeline.png();
  else pipeline = pipeline.jpeg({ quality });
  const resized = await pipeline.toBuffer();
  const contentType = format === "webp" ? "image/webp" : format === "png" ? "image/png" : "image/jpeg";

  const newPath = dataUrlFromBuffer(resized, contentType);
  return { objectPath: newPath, width, height, originalSize: originalBuffer.length, newSize: resized.length, purpose };
}

export async function generateMarketplaceImages(objectPath: string): Promise<ResizeResult[]> {
  return Promise.all(MARKETPLACE_SPECS.map((spec) => resizeProductImage(objectPath, spec.width, spec.height, spec.purpose, spec.format, spec.quality)));
}

export interface BackgroundRemovalResult {
  objectPath: string;
  service: string;
}

export async function removeProductBackground(objectPath: string): Promise<BackgroundRemovalResult> {
  const apiKey = (await getConfig("remove_bg_api_key")) || process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new Error("remove.bg API key is not configured. Add it in AI Settings as remove_bg_api_key or set REMOVE_BG_API_KEY.");

  const source = await downloadBuffer(objectPath);
  if (!source) throw new Error("Image not found");
  const imageBuffer = source.buffer;

  const formData = new FormData();
  formData.append("image_file", new Blob([new Uint8Array(imageBuffer)], { type: source.mimeType || "image/jpeg" }), "image.jpg");
  formData.append("size", "auto");

  const res = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: formData,
  });
  if (!res.ok) throw new Error(`remove.bg API error: ${res.status} ${await res.text().catch(() => "")}`);
  const resultBuffer = Buffer.from(await res.arrayBuffer());
  const newPath = dataUrlFromBuffer(resultBuffer, "image/png");
  return { objectPath: newPath, service: "remove.bg" };
}

export function generateBarcode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase();
}

export async function generateBarcodeImage(barcode: string, format: "code128" | "ean13" | "upca" = "code128"): Promise<{ objectPath: string; buffer: Buffer }> {
  const buffer = await bwipjs.toBuffer({ bcid: format, text: barcode, scale: 3, height: 10, includetext: true, textxalign: "center" });
  const objectPath = dataUrlFromBuffer(buffer, "image/png");
  return { objectPath, buffer };
}

export async function importProductsXlsx(companyId: number, buffer: Buffer): Promise<{ total: number; success: number; failed: number; errors: string[] }> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as any[];
  const stats = { total: rows.length, success: 0, failed: 0, errors: [] as string[] };
  const existing = await db.select({ sku: productsTable.sku }).from(productsTable).where(eq(productsTable.companyId, companyId));
  const existingSkus = new Set(existing.map(r => r.sku));

  for (const row of rows) {
    try {
      const name = String(row.name || row["Product Name"] || "").trim();
      const category = String(row.category || row["Category"] || "Uncategorized").trim();
      if (!name) throw new Error("Missing product name");
      let sku = String(row.sku || row["SKU"] || "").trim();
      if (!sku) sku = generateSku(name, category, companyId, Array.from(existingSkus));
      if (existingSkus.has(sku)) { stats.errors.push(`Duplicate SKU skipped: ${sku}`); stats.failed++; continue; }
      existingSkus.add(sku);
      const price = parseFloat(row.price || row["Price"] || "0") || 0;
      const mrp = parseFloat(row.mrp || row["MRP"] || row["Mrp"] || "0") || 0;
      const stockQuantity = parseInt(row.stockQuantity || row["Stock"] || row["Stock Quantity"] || "0", 10) || 0;
      await db.insert(productsTable).values({
        companyId,
        name,
        sku,
        category,
        subcategory: String(row.subcategory || row["Subcategory"] || "").trim() || undefined,
        brand: String(row.brand || row["Brand"] || "").trim() || undefined,
        description: String(row.description || row["Description"] || "").trim() || undefined,
        shortDescription: String(row.shortDescription || row["Short Description"] || "").trim() || undefined,
        price,
        mrp: mrp || price,
        costPrice: parseFloat(row.costPrice || row["Cost Price"] || "0") || 0,
        gst: parseFloat(row.gst || row["GST"] || "0") || 0,
        stockQuantity,
        reorderLevel: parseInt(row.reorderLevel || row["Reorder Level"] || "10", 10) || 10,
        weight: String(row.weight || row["Weight"] || "").trim() || undefined,
        dimensions: String(row.dimensions || row["Dimensions"] || "").trim() || undefined,
        hsn: String(row.hsn || row["HSN"] || "").trim() || undefined,
        barcode: String(row.barcode || row["Barcode"] || "").trim() || undefined,
        status: "active",
      });
      stats.success++;
    } catch (e: any) {
      stats.failed++;
      stats.errors.push(`Row ${stats.success + stats.failed}: ${e.message}`);
    }
  }
  return stats;
}

export async function exportProductsXlsx(companyId: number): Promise<Buffer> {
  const rows = await db.select().from(productsTable).where(eq(productsTable.companyId, companyId));
  const data = rows.map((p) => ({
    "Product Name": p.name,
    "SKU": p.sku,
    "Barcode": p.barcode || "",
    "Brand": p.brand || "",
    "Category": p.category,
    "Subcategory": p.subcategory || "",
    "Description": p.description || "",
    "Short Description": p.shortDescription || "",
    "Price": p.price,
    "MRP": p.mrp,
    "Cost Price": p.costPrice,
    "GST (%)": p.gst,
    "Stock Quantity": p.stockQuantity,
    "Reorder Level": p.reorderLevel,
    "Weight": p.weight || "",
    "Dimensions": p.dimensions || "",
    "HSN": p.hsn || "",
    "Warehouse Location": p.warehouseLocation || "",
    "Status": p.status,
    "Created At": p.createdAt.toISOString(),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export { normalizeObjectPath };
