import { db, productsTable, productAiMetadataTable, productImagesTable, productVariantsTable, productMarketplaceTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getActiveProvider, AiProvider, getConfig } from "./ai-provider";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { ObjectStorageService } from "./objectStorage";
import { randomUUID } from "crypto";
import sharp from "sharp";

const storage = new ObjectStorageService();

function normalizeObjectPath(path: string): string {
  if (!path) return "";
  if (path.startsWith("/objects/")) return path;
  if (path.startsWith("https://storage.googleapis.com/")) {
    return storage.normalizeObjectEntityPath(path);
  }
  return path;
}

async function downloadBase64(objectPath: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const file = await storage.getObjectEntityFile(normalizeObjectPath(objectPath));
    const [metadata] = await file.getMetadata();
    const stream = file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    return { data: buffer.toString("base64"), mimeType: metadata.contentType || "image/jpeg" };
  } catch (e) {
    return null;
  }
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

export interface ImageAnalysisResult {
  tags: string[];
  suggestedName: string;
  category: string;
  subcategory: string;
  attributes: Record<string, string>;
  keywords: string[];
  seoTags: string[];
  quality: { score: number; issues: string[]; resolutionOk: boolean; aspectRatioOk: boolean; whiteBackground: boolean; blur: boolean; brightnessOk: boolean };
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

export async function analyzeProductImage(objectPath: string): Promise<ImageAnalysisResult> {
  const image = await downloadBase64(objectPath);
  if (!image) throw new Error("Image not found");

  const prompt = `Analyze this product image for an e-commerce catalog (India marketplaces: Amazon, Flipkart, Myntra, Shopify).
Return JSON only. Detect everything visible and be specific:
{
  "tags": [string],
  "suggestedName": string,
  "category": string,
  "subcategory": string,
  "attributes": {
    "Gender": "Men|Women|Kids|Unisex",
    "Color": string,
    "Material": string,
    "Pattern": string,
    "Sleeve Type": string,
    "Neck Type": string,
    "Occasion": string,
    "Season": string,
    "Fit": string,
    "Product Type": string
  },
  "keywords": [string],
  "seoTags": [string],
  "quality": {"score": 0-100, "issues": [string], "resolutionOk": boolean, "aspectRatioOk": boolean, "whiteBackground": boolean, "blur": boolean, "brightnessOk": boolean},
  "marketplaceReady": boolean,
  "suggestions": [string]
}`;

  const response = await geminiAi.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }] },
    ],
    config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 4096 },
  });

  const text = response.text ?? "";
  const parsed = parseJson(text) || {
    tags: [], suggestedName: "", category: "Uncategorized", subcategory: "",
    attributes: {}, keywords: [], seoTags: [],
    quality: { score: 0, issues: [], resolutionOk: false, aspectRatioOk: false, whiteBackground: false, blur: false, brightnessOk: false },
    marketplaceReady: false, suggestions: ["Could not analyze image"],
  };
  return parsed as ImageAnalysisResult;
}

export async function analyzeProductImages(objectPaths: string[]): Promise<ImageAnalysisResult> {
  if (objectPaths.length === 0) throw new Error("No images provided");
  if (objectPaths.length === 1) return analyzeProductImage(objectPaths[0]);

  const images = await Promise.all(objectPaths.map(downloadBase64));
  const parts = images.map((img, i) => img ? { inlineData: { mimeType: img.mimeType, data: img.data } } : null).filter(Boolean);
  if (parts.length === 0) throw new Error("No images found");

  const prompt = `Analyze these ${objectPaths.length} product images for an e-commerce catalog. They show the same product from different angles. Combine all views into one catalog entry.
Return JSON only. Detect everything visible and be specific:
{
  "tags": [string],
  "suggestedName": string,
  "category": string,
  "subcategory": string,
  "attributes": {
    "Gender": "Men|Women|Kids|Unisex",
    "Color": string,
    "Material": string,
    "Pattern": string,
    "Sleeve Type": string,
    "Neck Type": string,
    "Occasion": string,
    "Season": string,
    "Fit": string,
    "Product Type": string
  },
  "keywords": [string],
  "seoTags": [string],
  "quality": {"score": 0-100, "issues": [string], "resolutionOk": boolean, "aspectRatioOk": boolean, "whiteBackground": boolean, "blur": boolean, "brightnessOk": boolean},
  "marketplaceReady": boolean,
  "suggestions": [string]
}`;

  const response = await geminiAi.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: prompt }, ...(parts as any)] },
    ],
    config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 4096 },
  });

  const text = response.text ?? "";
  const parsed = parseJson(text) || {
    tags: [], suggestedName: "", category: "Uncategorized", subcategory: "",
    attributes: {}, keywords: [], seoTags: [],
    quality: { score: 0, issues: [], resolutionOk: false, aspectRatioOk: false, whiteBackground: false, blur: false, brightnessOk: false },
    marketplaceReady: false, suggestions: ["Could not analyze images"],
  };
  return parsed as ImageAnalysisResult;
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

export async function ensureUniqueSku(companyId: number, name: string, category: string): Promise<string> {
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

export function generateImageName(productName: string, angle: string, index: number): string {
  const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug}-${angle.toLowerCase().replace(/\s+/g, "-")}-${index + 1}.jpg`;
}

export interface ResizeResult {
  objectPath: string;
  width: number;
  height: number;
  originalSize: number;
  newSize: number;
}

export async function resizeProductImage(objectPath: string, width: number, height: number): Promise<ResizeResult> {
  const file = await storage.getObjectEntityFile(normalizeObjectPath(objectPath));
  const [metadata] = await file.getMetadata();
  const stream = file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const originalBuffer = Buffer.concat(chunks);

  const resized = await sharp(originalBuffer)
    .resize(width, height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .jpeg({ quality: 90 })
    .toBuffer();

  const uploadUrl = await storage.getObjectEntityUploadURL();
  const res = await fetch(uploadUrl, { method: "PUT", body: resized, headers: { "Content-Type": "image/jpeg" } });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const newPath = storage.normalizeObjectEntityPath(uploadUrl);
  return { objectPath: newPath, width, height, originalSize: originalBuffer.length, newSize: resized.length };
}

export interface BackgroundRemovalResult {
  objectPath: string;
  service: string;
}

export async function removeProductBackground(objectPath: string): Promise<BackgroundRemovalResult> {
  const apiKey = (await getConfig("remove_bg_api_key")) || process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new Error("remove.bg API key is not configured. Add it in AI Settings as remove_bg_api_key or set REMOVE_BG_API_KEY.");

  const file = await storage.getObjectEntityFile(normalizeObjectPath(objectPath));
  const stream = file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const imageBuffer = Buffer.concat(chunks);

  const formData = new FormData();
  formData.append("image_file", new Blob([imageBuffer], { type: "image/jpeg" }), "image.jpg");
  formData.append("size", "auto");

  const res = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: formData,
  });
  if (!res.ok) throw new Error(`remove.bg API error: ${res.status} ${await res.text().catch(() => "")}`);
  const resultBuffer = Buffer.from(await res.arrayBuffer());
  const uploadUrl = await storage.getObjectEntityUploadURL();
  const uploadRes = await fetch(uploadUrl, { method: "PUT", body: resultBuffer, headers: { "Content-Type": "image/png" } });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
  const newPath = storage.normalizeObjectEntityPath(uploadUrl);
  return { objectPath: newPath, service: "remove.bg" };
}


export function generateBarcode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase();
}

export { normalizeObjectPath };
