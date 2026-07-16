import * as React from "react"
import { Link, useLocation } from "wouter"
import {
  Building2,
  PackageSearch,
  ShoppingCart,
  Wallet,
  Users,
  UsersRound,
  CheckSquare,
  Bell,
  Bot,
  Globe2,
  Settings,
  Menu,
  Moon,
  Sun,
  ChevronDown,
  TrendingUp,
  FileText,
  Megaphone,
  Heart,
  PawPrint,
  Shirt,
  BookOpen,
  Wrench,
  LayoutDashboard,
  Layers,
  PieChart,
  LogOut,
  Contact,
  Truck,
  ShieldCheck,
  ScrollText,
  Landmark,
} from "lucide-react"
import { GlobalSearch } from "@/components/global-search"
import { WorkingCapitalWidget } from "@/components/working-capital-widget"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useListNotifications } from "@workspace/api-client-react"
import { useCompany } from "@/contexts/company-context"
import type { ActiveCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
}

/* ─────────────────────────────────────────────────────
   Nav definitions
───────────────────────────────────────────────────── */

const parentNav: NavItem[] = [
  { name: "Portfolio Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Marketing", href: "/marketing", icon: Megaphone },
  { name: "Finance", href: "/finance", icon: Wallet },
  { name: "Treasury", href: "/treasury", icon: Landmark },
  { name: "Fund Allocation", href: "/fund-allocation", icon: Landmark },
  { name: "Shareholders", href: "/shareholders", icon: PieChart },
  { name: "Analytics", href: "/analytics", icon: TrendingUp },
  { name: "HR & People", href: "/hr", icon: Users },
  { name: "Team & Roles", href: "/admin/access", icon: ShieldCheck },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "Account Directory", href: "/accounts", icon: Contact },
  { name: "Approvals", href: "/approvals", icon: CheckSquare },
  { name: "Director Portal", href: "/director", icon: PieChart },
  { name: "AI Reports", href: "/ai-reports", icon: Bot },
  { name: "AI Insights", href: "/ai-assistant", icon: Bot },
]

const baseSubsidiaryNav: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Products", href: "/inventory", icon: PackageSearch },
  { name: "Shipping", href: "/shipping", icon: Truck },
  { name: "Customers", href: "/crm", icon: UsersRound },
  { name: "Marketing", href: "/marketing", icon: Megaphone },
  { name: "Finance", href: "/finance", icon: Wallet },
  { name: "Documents", href: "/documents", icon: FileText },
  { name: "AI Tasks", href: "/ai-tasks", icon: CheckSquare },
  { name: "Account Directory", href: "/accounts", icon: Contact },
  { name: "Integrations", href: "/integrations", icon: Globe2 },
]

const industryExtras: Record<string, NavItem[]> = {
  tikkatails: [
    { name: "Veterinary", href: "/veterinary", icon: PawPrint },
    { name: "Pet Community", href: "/community", icon: Heart },
  ],
  hugfab: [
    { name: "Collections", href: "/collections", icon: Shirt },
    { name: "Lookbook", href: "/lookbook", icon: Layers },
  ],
  pepalworks: [
    { name: "Catalog", href: "/catalog", icon: BookOpen },
  ],
  throttledaires: [
    { name: "Services", href: "/services", icon: Wrench },
  ],
  sanchikart: [
    { name: "Analytics", href: "/analytics", icon: TrendingUp },
  ],
}

function getNavItems(company: ActiveCompany | null) {
  if (!company || company.mode === "parent") return parentNav
  const extras = industryExtras[company.slug.toLowerCase()] ?? []
  // Insert industry extras before Integrations
  const base = [...baseSubsidiaryNav]
  const intIdx = base.findIndex((n) => n.href === "/integrations")
  base.splice(intIdx, 0, ...extras)
  return base
}

/* ─────────────────────────────────────────────────────
   Company Switcher
───────────────────────────────────────────────────── */

function CompanySwitcher({ collapsed }: { collapsed: boolean }) {
  const { activeCompany, companies, setActiveCompanyId } = useCompany()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const label = activeCompany?.name ?? "TapasHub"
  const initials = label.substring(0, 2).toUpperCase()
  const color = activeCompany?.color ?? "#2563EB"

  // Sort: parent first, then subsidiaries
  const sorted = [...companies].sort((a, b) => {
    if (a.mode === "parent" && b.mode !== "parent") return -1
    if (b.mode === "parent" && a.mode !== "parent") return 1
    return a.name.localeCompare(b.name)
  })

  if (collapsed) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-md transition-transform hover:scale-105"
          style={{ background: color }}
          title={label}
        >
          {initials}
        </button>
        {open && (
          <div className="absolute left-12 top-0 z-50 w-52 bg-card border rounded-xl shadow-2xl py-1 overflow-hidden">
            <CompanyList sorted={sorted} activeCompany={activeCompany} setActiveCompanyId={setActiveCompanyId} setOpen={setOpen} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative mx-3 mb-4" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 transition-all group"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-md"
          style={{ background: color }}
        >
          {initials}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-semibold truncate leading-tight">{label}</div>
          <div className="text-xs text-muted-foreground leading-tight">
            {activeCompany == null || activeCompany.mode === "parent"
              ? "Holding Company · Portfolio View"
              : activeCompany.industry ?? "Subsidiary"}
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 bg-card border rounded-xl shadow-2xl py-1 overflow-hidden">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Switch Workspace
          </div>
          <CompanyList sorted={sorted} activeCompany={activeCompany} setActiveCompanyId={setActiveCompanyId} setOpen={setOpen} />
        </div>
      )}
    </div>
  )
}

function CompanyList({
  sorted,
  activeCompany,
  setActiveCompanyId,
  setOpen,
}: {
  sorted: ActiveCompany[]
  activeCompany: ActiveCompany | null
  setActiveCompanyId: (id: number | null) => void
  setOpen: (v: boolean) => void
}) {
  return (
    <>
      {/* TapasHub parent option */}
      <button
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60 transition-colors",
          activeCompany == null && "bg-primary/10 text-primary"
        )}
        onClick={() => { setActiveCompanyId(null); setOpen(false) }}
      >
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "#2563EB" }}>
          TH
        </div>
        <div className="text-left">
          <div className="font-medium leading-tight">TapasHub</div>
          <div className="text-[11px] text-muted-foreground">Parent · Portfolio View</div>
        </div>
        {activeCompany == null && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
      </button>

      <div className="my-1 border-t" />

      {sorted.filter((c) => c.mode !== "parent").map((c) => (
        <button
          key={c.id}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60 transition-colors",
            activeCompany?.id === c.id && "bg-primary/10 text-primary"
          )}
          onClick={() => { setActiveCompanyId(c.id); setOpen(false) }}
        >
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ background: c.color }}
          >
            {c.name.substring(0, 2).toUpperCase()}
          </div>
          <div className="text-left">
            <div className="font-medium leading-tight">{c.name}</div>
            <div className="text-[11px] text-muted-foreground">{c.industry ?? "Subsidiary"}</div>
          </div>
          {activeCompany?.id === c.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>
      ))}
    </>
  )
}

/* ─────────────────────────────────────────────────────
   Layout
───────────────────────────────────────────────────── */

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { activeCompany, isParentView } = useCompany()
  const { logout, user: authUser, isSuperAdmin } = useAuth()

  const { data: notificationsData } = useListNotifications({ unreadOnly: true }, {
    query: { enabled: true, queryKey: ["/api/notifications", { unreadOnly: true }] }
  })
  const unreadCount = notificationsData?.length || 0

  // "Team & Roles" is already in parentNav when in the TapasHub parent context;
  // only add it here (via adminNav) for subsidiary views to avoid duplication.
  const adminNav: NavItem[] = isSuperAdmin
    ? [
        ...(!isParentView ? [{ name: "Team & Roles", href: "/admin/access", icon: ShieldCheck }] : []),
        { name: "Audit Logs", href: "/admin/audit", icon: ScrollText },
      ]
    : []
  const navItems = [...getNavItems(activeCompany), ...adminNav]
  const collapsed = !sidebarOpen

  const workspaceLabel = activeCompany?.name ?? "TapasHub"
  const workspaceColor = activeCompany?.color ?? "#2563EB"

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className={cn("h-16 flex items-center border-b shrink-0", collapsed ? "px-3 justify-center" : "px-4 gap-3")}>
        <div className="bg-white rounded-lg p-0.5 shrink-0 shadow-sm">
          <img src="/tapashub-logo.png" alt="TapasHub" className="w-8 h-8 object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight truncate">TAPBOSS</div>
            <div className="text-[10px] text-muted-foreground leading-tight truncate">Business Operating System</div>
          </div>
        )}
      </div>

      {/* Company Switcher */}
      <div className={cn("py-3", collapsed ? "flex justify-center px-2" : "")}>
        <CompanySwitcher collapsed={collapsed} />
      </div>

      {/* Nav label */}
      {!collapsed && (
        <div className="px-6 pb-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {isParentView ? "Group Management" : `${workspaceLabel} Workspace`}
          </span>
        </div>
      )}

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto py-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
          return (
            <Link key={item.name} href={item.href} className="block">
              <span
                className={cn(
                  "flex items-center px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all group",
                  isActive
                    ? "text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                style={isActive ? { background: workspaceColor } : undefined}
                title={collapsed ? item.name : undefined}
              >
                <item.icon className={cn("w-[18px] h-[18px] shrink-0")} />
                {!collapsed && <span className="ml-3 truncate">{item.name}</span>}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Working Capital Widget — parent view only, expanded sidebar */}
      {!collapsed && isParentView && <WorkingCapitalWidget />}

      {/* Bottom: Settings + Logout */}
      <div className="p-3 border-t shrink-0 space-y-0.5">
        <Link href="/settings" className="block">
          <span className={cn(
            "flex items-center px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-all",
            location.startsWith("/settings")
              ? "text-white shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
            style={location.startsWith("/settings") ? { background: workspaceColor } : undefined}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span className="ml-3">Settings</span>}
          </span>
        </Link>
        <button
          onClick={() => logout()}
          className="w-full flex items-center px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-all"
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span className="ml-3">Sign Out</span>}
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col bg-card border-r shrink-0 transition-all duration-300",
        collapsed ? "w-[68px]" : "w-64"
      )}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col bg-card border-r shadow-2xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-4 border-b bg-card/80 backdrop-blur-sm z-10 shrink-0">
          <div className="flex items-center gap-3">
            {/* Desktop collapse toggle */}
            <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu className="w-5 h-5" />
            </Button>
            {/* Mobile open toggle */}
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>

            {/* Workspace breadcrumb */}
            <div className="hidden sm:flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: workspaceColor }}
              />
              <span className="text-sm font-medium text-muted-foreground">
                {isParentView ? "TapasHub Group" : "TapasHub"}
              </span>
              {!isParentView && (
                <>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-sm font-semibold" style={{ color: workspaceColor }}>
                    {workspaceLabel}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Global Search */}
          <div className="flex-1 hidden md:flex justify-center px-4">
            <GlobalSearch />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </Button>

            <Link href="/notifications" className="block">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-card" />
                )}
              </Button>
            </Link>

            <div className="flex items-center gap-2 border-l pl-3 ml-1">
              <Avatar className="w-8 h-8 ring-2" style={{ "--ring-color": workspaceColor } as React.CSSProperties}>
                <AvatarFallback className="text-xs font-bold">{authUser?.name?.substring(0, 2) || "U"}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:block">
                <div className="text-sm font-semibold leading-tight">{authUser?.name || "User"}</div>
                <div className="text-[11px] text-muted-foreground leading-tight capitalize">{authUser?.role?.replace(/_/g, " ") || "Loading…"}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-background p-4 sm:p-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
