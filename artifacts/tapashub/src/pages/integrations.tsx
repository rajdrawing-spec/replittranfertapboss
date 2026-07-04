import { ExternalLink, RefreshCw, CheckCircle2, Globe } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const PLATFORMS = [
  {
    id: "shopdeck",
    name: "Shopdeck",
    description: "Manage your Shopdeck storefront — orders, products, payments and analytics.",
    url: "https://app.shopdeck.com",
    category: "E-commerce",
    color: "from-orange-500/20 to-orange-600/5",
    border: "border-orange-500/30",
    badge: "orange",
    logo: "SD",
    logoColor: "bg-orange-500",
    links: [
      { label: "Dashboard", url: "https://app.shopdeck.com/dashboard" },
      { label: "Orders", url: "https://app.shopdeck.com/orders" },
      { label: "Products", url: "https://app.shopdeck.com/products" },
      { label: "Analytics", url: "https://app.shopdeck.com/analytics" },
    ],
  },
  {
    id: "shopify",
    name: "Shopify Admin",
    description: "Manage your Shopify stores — inventory, orders, discounts and reports.",
    url: "https://admin.shopify.com",
    category: "E-commerce",
    color: "from-green-500/20 to-green-600/5",
    border: "border-green-500/30",
    badge: "green",
    logo: "SH",
    logoColor: "bg-green-600",
    links: [
      { label: "Dashboard", url: "https://admin.shopify.com" },
      { label: "Orders", url: "https://admin.shopify.com/orders" },
      { label: "Products", url: "https://admin.shopify.com/products" },
      { label: "Analytics", url: "https://admin.shopify.com/analytics" },
    ],
  },
  {
    id: "facebook",
    name: "Meta Business Suite",
    description: "Monitor Facebook pages, ad campaigns, insights and audience engagement.",
    url: "https://business.facebook.com",
    category: "Social Media",
    color: "from-blue-500/20 to-blue-600/5",
    border: "border-blue-500/30",
    badge: "blue",
    logo: "FB",
    logoColor: "bg-blue-600",
    links: [
      { label: "Home", url: "https://business.facebook.com/home" },
      { label: "Ad Manager", url: "https://www.facebook.com/adsmanager" },
      { label: "Insights", url: "https://business.facebook.com/latest/insights/overview" },
      { label: "Inbox", url: "https://business.facebook.com/latest/inbox/all" },
    ],
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Track Instagram posts, reels, stories, DMs and creator insights.",
    url: "https://www.instagram.com",
    category: "Social Media",
    color: "from-pink-500/20 to-purple-600/5",
    border: "border-pink-500/30",
    badge: "pink",
    logo: "IG",
    logoColor: "bg-gradient-to-br from-purple-500 to-pink-500",
    links: [
      { label: "Feed", url: "https://www.instagram.com" },
      { label: "Creator Studio", url: "https://www.instagram.com/dashboard" },
      { label: "Insights", url: "https://www.instagram.com/dashboard" },
      { label: "Messages", url: "https://www.instagram.com/direct/inbox" },
    ],
  },
  {
    id: "mca",
    name: "MCA Portal",
    description: "Ministry of Corporate Affairs — ROC filings, DIN, company master data and compliance.",
    url: "https://www.mca.gov.in",
    category: "Compliance",
    color: "from-amber-500/20 to-amber-600/5",
    border: "border-amber-500/30",
    badge: "amber",
    logo: "MCA",
    logoColor: "bg-amber-600",
    links: [
      { label: "MCA21 Portal", url: "https://efiling.mca.gov.in" },
      { label: "Company Search", url: "https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html" },
      { label: "Annual Filing", url: "https://efiling.mca.gov.in/eFiling/helpdocs/AnnualFilingCornerHelp.html" },
      { label: "DIN Services", url: "https://efiling.mca.gov.in/eFiling/helpdocs/DINCornerHelp.html" },
    ],
  },
]

const badgeColors: Record<string, string> = {
  orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  green:  "bg-green-500/10 text-green-400 border-green-500/20",
  blue:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
  pink:   "bg-pink-500/10 text-pink-400 border-pink-500/20",
  amber:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
}

export default function Integrations() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Connected Platforms</h1>
        <p className="text-muted-foreground mt-1">
          Direct links to your sales channels, social media and compliance portals.
        </p>
      </div>

      {/* Quick-access pill strip */}
      <div className="flex flex-wrap gap-3">
        {PLATFORMS.map(p => (
          <a
            key={p.id}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all
              hover:scale-105 active:scale-95 ${badgeColors[p.badge]}`}
          >
            <span className={`w-4 h-4 rounded-full ${p.logoColor} text-white text-[8px] flex items-center justify-center font-bold`}>
              {p.logo[0]}
            </span>
            {p.name}
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        ))}
      </div>

      {/* Platform cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {PLATFORMS.map(platform => (
          <Card
            key={platform.id}
            className={`bg-gradient-to-br ${platform.color} border ${platform.border} hover:shadow-lg transition-all duration-300 group`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl ${platform.logoColor} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                    {platform.logo}
                  </div>
                  <div>
                    <CardTitle className="text-base">{platform.name}</CardTitle>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badgeColors[platform.badge]}`}>
                      {platform.category}
                    </span>
                  </div>
                </div>
                <a
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="icon" variant="ghost" className="w-8 h-8 opacity-60 group-hover:opacity-100 transition-opacity">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </a>
              </div>
              <CardDescription className="mt-3 text-xs leading-relaxed">
                {platform.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Quick Links</p>
              <div className="grid grid-cols-2 gap-2">
                {platform.links.map(link => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground
                               bg-background/30 hover:bg-background/60 px-3 py-2 rounded-md transition-all
                               border border-transparent hover:border-white/10"
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    {link.label}
                  </a>
                ))}
              </div>

              <a
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 w-full py-2 rounded-md
                           bg-background/40 hover:bg-background/70 border border-white/10 hover:border-white/20
                           text-sm font-medium transition-all"
              >
                Open {platform.name}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
