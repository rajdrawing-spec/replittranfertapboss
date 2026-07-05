/* ─────────────────────────────────────────────────────
   Platform catalogue + per-company assignment
───────────────────────────────────────────────────── */

export interface Platform {
  id: string
  name: string
  shortName: string
  logo: string
  logoColor: string
  category: "E-commerce" | "Marketplace" | "Social" | "Payments" | "Logistics" | "Accounting" | "Compliance" | "Messaging"
  url: string
  syncFeatures: string[]
  quickLinks: { label: string; url: string }[]
  colorClass: {
    bg: string
    border: string
    badge: string
    pill: string
  }
}

export interface IntegrationState {
  connected: boolean
  lastSync: string | null
  autoSync: boolean
  syncProducts: boolean
  syncOrders: boolean
  syncInventory: boolean
  syncCustomers: boolean
  syncFinance: boolean
}

export const defaultState = (): IntegrationState => ({
  connected: false,
  lastSync: null,
  autoSync: false,
  syncProducts: true,
  syncOrders: true,
  syncInventory: true,
  syncCustomers: true,
  syncFinance: true,
})

/* ─── Platform catalogue ─── */
export const ALL_PLATFORMS: Record<string, Platform> = {
  shopdeck: {
    id: "shopdeck",
    name: "Shopdeck",
    shortName: "Shopdeck",
    logo: "SD",
    logoColor: "bg-orange-500",
    category: "E-commerce",
    url: "https://app.shopdeck.com",
    syncFeatures: ["Orders", "Products", "Inventory", "Customers", "Analytics"],
    quickLinks: [
      { label: "Dashboard", url: "https://app.shopdeck.com/dashboard" },
      { label: "Orders", url: "https://app.shopdeck.com/orders" },
      { label: "Products", url: "https://app.shopdeck.com/products" },
      { label: "Analytics", url: "https://app.shopdeck.com/analytics" },
    ],
    colorClass: { bg: "from-orange-500/15 to-orange-600/5", border: "border-orange-500/30", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20", pill: "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 text-orange-400" },
  },
  shopify: {
    id: "shopify",
    name: "Shopify",
    shortName: "Shopify",
    logo: "SH",
    logoColor: "bg-green-600",
    category: "E-commerce",
    url: "https://admin.shopify.com",
    syncFeatures: ["Orders", "Products", "Inventory", "Customers", "Finance"],
    quickLinks: [
      { label: "Dashboard", url: "https://admin.shopify.com" },
      { label: "Orders", url: "https://admin.shopify.com/orders" },
      { label: "Products", url: "https://admin.shopify.com/products" },
      { label: "Analytics", url: "https://admin.shopify.com/analytics" },
    ],
    colorClass: { bg: "from-green-500/15 to-green-600/5", border: "border-green-500/30", badge: "bg-green-500/10 text-green-400 border-green-500/20", pill: "bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-400" },
  },
  amazon: {
    id: "amazon",
    name: "Amazon Seller",
    shortName: "Amazon",
    logo: "AZ",
    logoColor: "bg-yellow-500",
    category: "Marketplace",
    url: "https://sellercentral.amazon.in",
    syncFeatures: ["Orders", "Products", "Inventory", "Customers", "Finance"],
    quickLinks: [
      { label: "Orders", url: "https://sellercentral.amazon.in/orders-v3" },
      { label: "Inventory", url: "https://sellercentral.amazon.in/inventory" },
      { label: "Payments", url: "https://sellercentral.amazon.in/payments/dashboard" },
      { label: "Reports", url: "https://sellercentral.amazon.in/gp/payments-account/settlement-report-summary.html" },
    ],
    colorClass: { bg: "from-yellow-500/15 to-yellow-600/5", border: "border-yellow-500/30", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", pill: "bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/30 text-yellow-400" },
  },
  flipkart: {
    id: "flipkart",
    name: "Flipkart Seller",
    shortName: "Flipkart",
    logo: "FK",
    logoColor: "bg-blue-500",
    category: "Marketplace",
    url: "https://seller.flipkart.com",
    syncFeatures: ["Orders", "Products", "Inventory", "Customers", "Finance"],
    quickLinks: [
      { label: "Dashboard", url: "https://seller.flipkart.com/index.html" },
      { label: "Orders", url: "https://seller.flipkart.com/order-management" },
      { label: "Listings", url: "https://seller.flipkart.com/product-management" },
      { label: "Payments", url: "https://seller.flipkart.com/payments-module" },
    ],
    colorClass: { bg: "from-blue-500/15 to-blue-600/5", border: "border-blue-500/30", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20", pill: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400" },
  },
  facebook: {
    id: "facebook",
    name: "Meta Business Suite",
    shortName: "Facebook",
    logo: "FB",
    logoColor: "bg-blue-700",
    category: "Social",
    url: "https://business.facebook.com",
    syncFeatures: ["Orders", "Customers", "Analytics"],
    quickLinks: [
      { label: "Business Home", url: "https://business.facebook.com/home" },
      { label: "Ad Manager", url: "https://www.facebook.com/adsmanager" },
      { label: "Insights", url: "https://business.facebook.com/latest/insights/overview" },
      { label: "Inbox", url: "https://business.facebook.com/latest/inbox/all" },
    ],
    colorClass: { bg: "from-blue-700/15 to-blue-800/5", border: "border-blue-700/30", badge: "bg-blue-700/10 text-blue-400 border-blue-700/20", pill: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400" },
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    shortName: "Instagram",
    logo: "IG",
    logoColor: "bg-gradient-to-br from-purple-500 to-pink-500",
    category: "Social",
    url: "https://www.instagram.com",
    syncFeatures: ["Customers", "Analytics"],
    quickLinks: [
      { label: "Profile", url: "https://www.instagram.com" },
      { label: "Creator Studio", url: "https://www.instagram.com/dashboard" },
      { label: "Insights", url: "https://www.instagram.com/dashboard" },
      { label: "Messages", url: "https://www.instagram.com/direct/inbox" },
    ],
    colorClass: { bg: "from-pink-500/15 to-purple-600/5", border: "border-pink-500/30", badge: "bg-pink-500/10 text-pink-400 border-pink-500/20", pill: "bg-pink-500/10 hover:bg-pink-500/20 border-pink-500/30 text-pink-400" },
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp Business",
    shortName: "WhatsApp",
    logo: "WA",
    logoColor: "bg-green-500",
    category: "Messaging",
    url: "https://business.whatsapp.com",
    syncFeatures: ["Customers"],
    quickLinks: [
      { label: "Manager", url: "https://business.facebook.com/wa/manage/home" },
      { label: "Contacts", url: "https://business.facebook.com/wa/manage/contacts" },
      { label: "Broadcasts", url: "https://business.facebook.com/wa/manage/broadcast-lists" },
      { label: "Analytics", url: "https://business.facebook.com/wa/manage/insights" },
    ],
    colorClass: { bg: "from-green-500/15 to-green-600/5", border: "border-green-400/30", badge: "bg-green-500/10 text-green-400 border-green-500/20", pill: "bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-400" },
  },
  google: {
    id: "google",
    name: "Google Business",
    shortName: "Google Biz",
    logo: "GB",
    logoColor: "bg-red-500",
    category: "Social",
    url: "https://business.google.com",
    syncFeatures: ["Customers", "Analytics"],
    quickLinks: [
      { label: "Profile", url: "https://business.google.com/dashboard" },
      { label: "Reviews", url: "https://business.google.com/reviews" },
      { label: "Posts", url: "https://business.google.com/posts" },
      { label: "Insights", url: "https://business.google.com/insights" },
    ],
    colorClass: { bg: "from-red-500/15 to-red-600/5", border: "border-red-500/30", badge: "bg-red-500/10 text-red-400 border-red-500/20", pill: "bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400" },
  },
  razorpay: {
    id: "razorpay",
    name: "Razorpay",
    shortName: "Razorpay",
    logo: "RP",
    logoColor: "bg-blue-600",
    category: "Payments",
    url: "https://dashboard.razorpay.com",
    syncFeatures: ["Finance", "Customers", "Orders"],
    quickLinks: [
      { label: "Dashboard", url: "https://dashboard.razorpay.com" },
      { label: "Transactions", url: "https://dashboard.razorpay.com/app/payments" },
      { label: "Settlements", url: "https://dashboard.razorpay.com/app/settlements" },
      { label: "Reports", url: "https://dashboard.razorpay.com/app/reports" },
    ],
    colorClass: { bg: "from-blue-600/15 to-blue-700/5", border: "border-blue-600/30", badge: "bg-blue-600/10 text-blue-300 border-blue-600/20", pill: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400" },
  },
  shiprocket: {
    id: "shiprocket",
    name: "Shiprocket",
    shortName: "Shiprocket",
    logo: "SR",
    logoColor: "bg-orange-600",
    category: "Logistics",
    url: "https://app.shiprocket.in",
    syncFeatures: ["Orders", "Inventory"],
    quickLinks: [
      { label: "Dashboard", url: "https://app.shiprocket.in/dashboard" },
      { label: "Orders", url: "https://app.shiprocket.in/orders" },
      { label: "Shipments", url: "https://app.shiprocket.in/shipments" },
      { label: "NDR", url: "https://app.shiprocket.in/ndr" },
    ],
    colorClass: { bg: "from-orange-600/15 to-orange-700/5", border: "border-orange-600/30", badge: "bg-orange-600/10 text-orange-300 border-orange-600/20", pill: "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 text-orange-400" },
  },
  zoho: {
    id: "zoho",
    name: "Zoho Books",
    shortName: "Zoho Books",
    logo: "ZB",
    logoColor: "bg-red-600",
    category: "Accounting",
    url: "https://books.zoho.in",
    syncFeatures: ["Finance", "Customers"],
    quickLinks: [
      { label: "Dashboard", url: "https://books.zoho.in/app" },
      { label: "Invoices", url: "https://books.zoho.in/app#/invoices" },
      { label: "Bills", url: "https://books.zoho.in/app#/bills" },
      { label: "Reports", url: "https://books.zoho.in/app#/reports" },
    ],
    colorClass: { bg: "from-red-600/15 to-red-700/5", border: "border-red-600/30", badge: "bg-red-600/10 text-red-300 border-red-600/20", pill: "bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400" },
  },
  tally: {
    id: "tally",
    name: "Tally Prime",
    shortName: "Tally",
    logo: "TP",
    logoColor: "bg-indigo-600",
    category: "Accounting",
    url: "https://tallysolutions.com",
    syncFeatures: ["Finance"],
    quickLinks: [
      { label: "Site", url: "https://tallysolutions.com" },
      { label: "Support", url: "https://tallysolutions.com/support" },
      { label: "Downloads", url: "https://tallysolutions.com/download" },
      { label: "Docs", url: "https://help.tallysolutions.com" },
    ],
    colorClass: { bg: "from-indigo-600/15 to-indigo-700/5", border: "border-indigo-600/30", badge: "bg-indigo-600/10 text-indigo-300 border-indigo-600/20", pill: "bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-400" },
  },
  mca: {
    id: "mca",
    name: "MCA Portal",
    shortName: "MCA",
    logo: "MCA",
    logoColor: "bg-amber-600",
    category: "Compliance",
    url: "https://www.mca.gov.in",
    syncFeatures: [],
    quickLinks: [
      { label: "eFiling", url: "https://efiling.mca.gov.in" },
      { label: "Company Search", url: "https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html" },
      { label: "Annual Filing", url: "https://efiling.mca.gov.in/eFiling/helpdocs/AnnualFilingCornerHelp.html" },
      { label: "DIN Services", url: "https://efiling.mca.gov.in/eFiling/helpdocs/DINCornerHelp.html" },
    ],
    colorClass: { bg: "from-amber-600/15 to-amber-700/5", border: "border-amber-500/30", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20", pill: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400" },
  },
}

/* ─── Per-company platform assignment ─── */
export const COMPANY_PLATFORMS: Record<string, string[]> = {
  tapashub: ["mca", "zoho", "tally"],
  hugfab: ["shopify", "shopdeck", "facebook", "instagram", "razorpay", "shiprocket"],
  tikkatails: ["shopify", "amazon", "flipkart", "facebook", "instagram", "whatsapp", "razorpay", "shiprocket"],
  throttledaires: ["shopify", "facebook", "instagram", "whatsapp", "google", "razorpay"],
  sanchikart: ["shopify", "shopdeck", "amazon", "flipkart", "facebook", "instagram", "razorpay", "shiprocket"],
  pepalworks: ["shopify", "amazon", "flipkart", "facebook", "instagram", "razorpay", "shiprocket"],
}

/** Returns the platform list for the active company (by slug). Falls back to all platforms for unknown slugs. */
export function getPlatformsForCompany(slug: string | null): Platform[] {
  const key = (slug ?? "tapashub").toLowerCase()
  const ids = COMPANY_PLATFORMS[key] ?? Object.keys(ALL_PLATFORMS)
  return ids.map((id) => ALL_PLATFORMS[id]).filter(Boolean)
}

/* ─── localStorage state helpers ─── */
function stateKey(companySlug: string, platformId: string) {
  return `tbos-int-${companySlug}-${platformId}`
}

export function getIntegrationState(companySlug: string, platformId: string): IntegrationState {
  try {
    const raw = localStorage.getItem(stateKey(companySlug, platformId))
    if (raw) return { ...defaultState(), ...JSON.parse(raw) }
  } catch {}
  return defaultState()
}

export function saveIntegrationState(companySlug: string, platformId: string, state: IntegrationState) {
  try {
    localStorage.setItem(stateKey(companySlug, platformId), JSON.stringify(state))
  } catch {}
}
