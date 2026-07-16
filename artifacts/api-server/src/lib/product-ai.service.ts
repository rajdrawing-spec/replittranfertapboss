import { db, productsTable, productAiMetadataTable, productImagesTable, productVariantsTable, productMarketplaceTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getActiveProvider, AiProvider } from "./ai-provider";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { ObjectStorageService } from "./objectStorage";
import { randomUUID } from "crypto";

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
  category: string;
  attributes: Record<string, string>;
  quality: { score: number; issues: string[] };
  marketplaceReady: boolean;
  suggestions: string[];
}

export interface ProductGenerationResult {
  name: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
  attributes: Record<string, string>;
  category: string;
  suggestedPrice: number | null;
}

export interface MarketplaceTemplateResult {
  title: string;
  description: string;
  bulletPoints: string[];
  keywords: string[];
  category: string;
  imageRequirements: string[];
}

export async function analyzeProductImage(productId: number, objectPath: string): Promise<ImageAnalysisResult> {
  const image = await downloadBase64(objectPath);
  if (!image) throw new Error("Image not found");

  const prompt = `Analyze this product image for an e-commerce catalog. Return JSON only: {
    "tags": [string],
    "category": string,
    "attributes": {key: string value},
    "quality": {"score": 0-100, "issues": [string]},
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
    tags: [], category: "Uncategorized", attributes: {}, quality: { score: 0, issues: [] },
    marketplaceReady: false, suggestions: ["Could not analyze image"],
  };
  return parsed as ImageAnalysisResult;
}

export async function generateProductContent(productId: number, promptHint?: string): Promise<ProductGenerationResult> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) throw new Error("Product not found");

  const provider = await getActiveProvider();
  const system = "You are an e-commerce copywriter. Return only valid JSON.";
  const prompt = `Write a product listing for "${product.name}" (category: ${product.category}, price: ${product.price}).
Additional context: ${promptHint || "none"}.
Return JSON: {
  "name": string,
  "description": string,
  "seoTitle": string,
  "seoDescription": string,
  "keywords": [string],
  "attributes": {key: string value},
  "category": string,
  "suggestedPrice": number | null
}`;

  const text = await chat(provider, system, prompt);
  const parsed = parseJson(text) || {
    name: product.name, description: product.description || "", seoTitle: product.name,
    seoDescription: product.description || "", keywords: [], attributes: {}, category: product.category, suggestedPrice: null,
  };
  parsed.suggestedPrice = typeof parsed.suggestedPrice === "number" ? parsed.suggestedPrice : null;
  return parsed as ProductGenerationResult;
}

export async function ensureUniqueSku(productId: number, name: string, category: string): Promise<string> {
  const rows = await db.select({ sku: productsTable.sku }).from(productsTable).where(eq(productsTable.companyId, productId as any));
  const existing = rows.map(r => r.sku);
  return generateSku(name, category, productId, existing);
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
  if (product.name && product.name.length > 3) score += 15;
  if (product.description && product.description.length > 20) score += 15;
  if (product.sku) score += 10;
  if (product.barcode) score += 10;
  if (product.price > 0 && product.costPrice > 0) score += 10;
  if (images.length > 0) score += 15;
  if (images.some(i => i.isPrimary)) score += 5;
  if (meta?.keywords?.length) score += 10;
  if (meta?.seoTitle && meta?.seoDescription) score += 10;
  if (variants.length > 0) score += 10;
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

export function generateBarcode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase();
}

export { normalizeObjectPath };
