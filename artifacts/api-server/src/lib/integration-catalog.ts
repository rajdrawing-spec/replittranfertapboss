/**
 * Platform catalog — the single source of truth for supported integrations.
 * The UI renders entirely from this catalog (served via /api/integrations/catalog),
 * so adding a new platform here surfaces a fully working card with no UI changes.
 *
 * `secretKeys` are logical credential names. The actual Replit secret / env var
 * for a connection is namespaced per company as:
 *   INTEGRATION_<PLATFORM_KEY>_<COMPANY_ID>_<SECRET_KEY>   (all upper-case)
 * Values live in Replit Secrets and are read from process.env — never stored in the DB.
 *
 * `browserWorkspace: true` — platform requires a real browser session (no public API
 * covers all required operations).  TAPBOSS opens a server-side Chromium instance with
 * an isolated per-company profile and streams it back to the UI.
 *
 * `browserWorkspace: false` — platform has a sufficient API; data sync and operations
 * are handled via stored OAuth credentials without a browser session.
 */

export type IntegrationCategory =
  | "storefront" | "marketplace" | "social" | "ads"
  | "analytics" | "payments" | "shipping" | "accounting" | "messaging";

export interface CatalogQuickLink { label: string; url: string; }

export interface CatalogCapabilities {
  oauth: boolean;
  apiKey: boolean;
  webhook: boolean;
}

export interface CatalogPlatform {
  key: string;
  name: string;
  shortName: string;
  category: IntegrationCategory;
  description: string;
  logo: string;          // short initials for the avatar
  logoColor: string;     // tailwind bg class
  accent: string;        // tailwind text class
  url: string;
  capabilities: CatalogCapabilities;
  syncFeatures: string[]; // Orders, Products, Inventory, Customers, Finance, Analytics, Messages, Shipments
  secretKeys: string[];   // logical credential names required for a live connection
  quickLinks: CatalogQuickLink[];
  /**
   * When true: TAPBOSS opens an isolated browser workspace for this platform.
   * When false: operations are handled via API credentials stored in the DB.
   */
  browserWorkspace: boolean;
}

const q = (label: string, url: string): CatalogQuickLink => ({ label, url });

export const INTEGRATION_CATALOG: CatalogPlatform[] = [
  {
    key: "shopify", name: "Shopify", shortName: "Shopify", category: "storefront",
    description: "Online storefront — sync orders, products, inventory & customers.",
    logo: "SH", logoColor: "bg-green-600", accent: "text-green-400", url: "https://admin.shopify.com",
    capabilities: { oauth: true, apiKey: true, webhook: true },
    syncFeatures: ["Orders", "Products", "Inventory", "Customers", "Finance"],
    secretKeys: ["ADMIN_API_TOKEN", "STORE_DOMAIN"],
    quickLinks: [q("Admin", "https://admin.shopify.com"), q("Orders", "https://admin.shopify.com/orders"), q("Products", "https://admin.shopify.com/products")],
    browserWorkspace: false,
  },
  {
    key: "shopdeck", name: "Shopdeck", shortName: "Shopdeck", category: "storefront",
    description: "D2C storefront platform — orders, catalog & analytics.",
    logo: "SD", logoColor: "bg-orange-500", accent: "text-orange-400", url: "https://app.shopdeck.com",
    capabilities: { oauth: false, apiKey: true, webhook: true },
    syncFeatures: ["Orders", "Products", "Inventory", "Customers"],
    secretKeys: ["API_KEY"],
    quickLinks: [q("Dashboard", "https://app.shopdeck.com/dashboard"), q("Orders", "https://app.shopdeck.com/orders")],
    browserWorkspace: false,
  },
  {
    key: "amazon", name: "Amazon Seller", shortName: "Amazon", category: "marketplace",
    description: "Amazon Seller Central — orders, FBA inventory & settlements.",
    logo: "AZ", logoColor: "bg-yellow-500", accent: "text-yellow-400", url: "https://sellercentral.amazon.in",
    capabilities: { oauth: true, apiKey: true, webhook: false },
    syncFeatures: ["Orders", "Products", "Inventory", "Finance"],
    secretKeys: ["LWA_CLIENT_ID", "LWA_CLIENT_SECRET", "REFRESH_TOKEN"],
    quickLinks: [q("Orders", "https://sellercentral.amazon.in/orders-v3"), q("Inventory", "https://sellercentral.amazon.in/inventory")],
    browserWorkspace: true,
  },
  {
    key: "flipkart", name: "Flipkart Seller", shortName: "Flipkart", category: "marketplace",
    description: "Flipkart Seller Hub — order management, listings & payments.",
    logo: "FK", logoColor: "bg-blue-500", accent: "text-blue-400", url: "https://seller.flipkart.com",
    capabilities: { oauth: true, apiKey: true, webhook: false },
    syncFeatures: ["Orders", "Products", "Inventory", "Finance"],
    secretKeys: ["APP_ID", "APP_SECRET"],
    quickLinks: [q("Dashboard", "https://seller.flipkart.com/index.html"), q("Orders", "https://seller.flipkart.com/order-management")],
    browserWorkspace: true,
  },
  {
    key: "myntra", name: "Myntra Partner", shortName: "Myntra", category: "marketplace",
    description: "Myntra Partner Portal — fashion marketplace orders & catalog.",
    logo: "MY", logoColor: "bg-pink-600", accent: "text-pink-400", url: "https://partners.myntra.com",
    capabilities: { oauth: false, apiKey: true, webhook: false },
    syncFeatures: ["Orders", "Products", "Inventory"],
    secretKeys: ["API_KEY", "API_SECRET"],
    quickLinks: [q("Partner Portal", "https://partners.myntra.com")],
    browserWorkspace: true,
  },
  {
    key: "meta_business", name: "Meta Business", shortName: "Meta", category: "social",
    description: "Meta Business Suite — pages, catalog & commerce insights.",
    logo: "MB", logoColor: "bg-blue-700", accent: "text-blue-400", url: "https://business.facebook.com",
    capabilities: { oauth: true, apiKey: false, webhook: true },
    syncFeatures: ["Customers", "Analytics", "Messages"],
    secretKeys: ["APP_ID", "APP_SECRET", "ACCESS_TOKEN"],
    quickLinks: [q("Business Home", "https://business.facebook.com/home"), q("Insights", "https://business.facebook.com/latest/insights/overview")],
    browserWorkspace: true,
  },
  {
    key: "facebook", name: "Facebook Page", shortName: "Facebook", category: "social",
    description: "Facebook Page — posts, engagement & lead forms.",
    logo: "FB", logoColor: "bg-blue-600", accent: "text-blue-400", url: "https://facebook.com",
    capabilities: { oauth: true, apiKey: false, webhook: true },
    syncFeatures: ["Customers", "Analytics"],
    secretKeys: ["PAGE_ACCESS_TOKEN"],
    quickLinks: [q("Pages", "https://facebook.com/pages"), q("Ads Manager", "https://facebook.com/adsmanager")],
    browserWorkspace: true,
  },
  {
    key: "instagram", name: "Instagram", shortName: "Instagram", category: "social",
    description: "Instagram Business — content insights & direct messages.",
    logo: "IG", logoColor: "bg-gradient-to-br from-purple-500 to-pink-500", accent: "text-pink-400", url: "https://instagram.com",
    capabilities: { oauth: true, apiKey: false, webhook: true },
    syncFeatures: ["Customers", "Analytics", "Messages"],
    secretKeys: ["ACCESS_TOKEN"],
    quickLinks: [q("Profile", "https://instagram.com"), q("Insights", "https://instagram.com/dashboard")],
    browserWorkspace: true,
  },
  {
    key: "google_ads", name: "Google Ads", shortName: "Google Ads", category: "ads",
    description: "Google Ads — campaign spend, conversions & performance.",
    logo: "GA", logoColor: "bg-blue-500", accent: "text-blue-400", url: "https://ads.google.com",
    capabilities: { oauth: true, apiKey: false, webhook: false },
    syncFeatures: ["Analytics", "Finance"],
    secretKeys: ["DEVELOPER_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"],
    quickLinks: [q("Campaigns", "https://ads.google.com/aw/campaigns"), q("Reports", "https://ads.google.com/aw/reporting")],
    browserWorkspace: true,
  },
  {
    key: "google_analytics", name: "Google Analytics", shortName: "GA4", category: "analytics",
    description: "Google Analytics 4 — traffic, funnels & attribution.",
    logo: "G4", logoColor: "bg-orange-500", accent: "text-orange-400", url: "https://analytics.google.com",
    capabilities: { oauth: true, apiKey: false, webhook: false },
    syncFeatures: ["Analytics"],
    secretKeys: ["PROPERTY_ID", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"],
    quickLinks: [q("Reports", "https://analytics.google.com")],
    browserWorkspace: true,
  },
  {
    key: "google_business", name: "Google Business", shortName: "Google Biz", category: "social",
    description: "Google Business Profile — reviews, posts & local insights.",
    logo: "GB", logoColor: "bg-red-500", accent: "text-red-400", url: "https://business.google.com",
    capabilities: { oauth: true, apiKey: false, webhook: false },
    syncFeatures: ["Customers", "Analytics"],
    secretKeys: ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"],
    quickLinks: [q("Profile", "https://business.google.com/dashboard"), q("Reviews", "https://business.google.com/reviews")],
    browserWorkspace: true,
  },
  {
    key: "shiprocket", name: "Shiprocket", shortName: "Shiprocket", category: "shipping",
    description: "Shiprocket — shipping, tracking & NDR management.",
    logo: "SR", logoColor: "bg-orange-600", accent: "text-orange-400", url: "https://app.shiprocket.in",
    capabilities: { oauth: false, apiKey: true, webhook: true },
    syncFeatures: ["Orders", "Shipments"],
    secretKeys: ["EMAIL", "PASSWORD"],
    quickLinks: [q("Dashboard", "https://app.shiprocket.in/dashboard"), q("Shipments", "https://app.shiprocket.in/shipments")],
    browserWorkspace: false,
  },
  {
    key: "delhivery", name: "Delhivery", shortName: "Delhivery", category: "shipping",
    description: "Delhivery — pickups, shipping labels & tracking.",
    logo: "DL", logoColor: "bg-red-600", accent: "text-red-400", url: "https://www.delhivery.com",
    capabilities: { oauth: false, apiKey: true, webhook: true },
    syncFeatures: ["Shipments"],
    secretKeys: ["API_TOKEN"],
    quickLinks: [q("Track", "https://www.delhivery.com/tracking")],
    browserWorkspace: false,
  },
  {
    key: "razorpay", name: "Razorpay", shortName: "Razorpay", category: "payments",
    description: "Razorpay — payments, settlements & payouts.",
    logo: "RP", logoColor: "bg-blue-600", accent: "text-blue-400", url: "https://dashboard.razorpay.com",
    capabilities: { oauth: false, apiKey: true, webhook: true },
    syncFeatures: ["Finance", "Orders", "Customers"],
    secretKeys: ["KEY_ID", "KEY_SECRET"],
    quickLinks: [q("Payments", "https://dashboard.razorpay.com/app/payments"), q("Settlements", "https://dashboard.razorpay.com/app/settlements")],
    browserWorkspace: false,
  },
  {
    key: "zoho", name: "Zoho Books", shortName: "Zoho", category: "accounting",
    description: "Zoho Books — invoices, bills & accounting reports.",
    logo: "ZB", logoColor: "bg-red-600", accent: "text-red-400", url: "https://books.zoho.in",
    capabilities: { oauth: true, apiKey: false, webhook: true },
    syncFeatures: ["Finance", "Customers"],
    secretKeys: ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "ORGANIZATION_ID"],
    quickLinks: [q("Dashboard", "https://books.zoho.in/app"), q("Invoices", "https://books.zoho.in/app#/invoices")],
    browserWorkspace: false,
  },
  {
    key: "gmail", name: "Gmail", shortName: "Gmail", category: "messaging",
    description: "Gmail — customer email threads & notifications.",
    logo: "GM", logoColor: "bg-red-500", accent: "text-red-400", url: "https://mail.google.com",
    capabilities: { oauth: true, apiKey: false, webhook: true },
    syncFeatures: ["Messages", "Customers"],
    secretKeys: ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"],
    quickLinks: [q("Inbox", "https://mail.google.com")],
    browserWorkspace: true,
  },
  {
    key: "whatsapp", name: "WhatsApp Business", shortName: "WhatsApp", category: "messaging",
    description: "WhatsApp Business — customer chats & broadcast campaigns.",
    logo: "WA", logoColor: "bg-green-500", accent: "text-green-400", url: "https://business.whatsapp.com",
    capabilities: { oauth: false, apiKey: true, webhook: true },
    syncFeatures: ["Messages", "Customers"],
    secretKeys: ["PHONE_NUMBER_ID", "ACCESS_TOKEN"],
    quickLinks: [q("Manager", "https://business.facebook.com/wa/manage/home")],
    browserWorkspace: false,
  },
];

const BY_KEY = new Map(INTEGRATION_CATALOG.map((p) => [p.key, p]));

export function getCatalogPlatform(key: string): CatalogPlatform | undefined {
  return BY_KEY.get(key);
}

/** Env var name that holds a given credential for a given company connection. */
export function secretEnvName(platformKey: string, companyId: number, secretKey: string): string {
  return `INTEGRATION_${platformKey}_${companyId}_${secretKey}`.toUpperCase();
}

/** All env var names required for a live connection to this platform + company. */
export function requiredSecretRefs(platformKey: string, companyId: number): string[] {
  const p = getCatalogPlatform(platformKey);
  if (!p) return [];
  return p.secretKeys.map((k) => secretEnvName(platformKey, companyId, k));
}

/** Names of required secrets that are not currently present in the environment. */
export function missingSecretRefs(refs: string[]): string[] {
  return refs.filter((r) => !process.env[r]);
}
