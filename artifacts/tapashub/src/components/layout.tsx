import * as React from "react"
import { Link, useLocation } from "wouter"
import {
  Building2, PackageSearch, ShoppingCart, Wallet, Users, UsersRound,
  CheckSquare, Bell, Bot, Globe2, Settings, Menu, Moon, Sun, ChevronDown,
  TrendingUp, FileText, Megaphone, LayoutDashboard, PieChart, LogOut, Contact,
  Headset, Truck, ShieldCheck, ScrollText, Landmark, MessageSquare, Video,
  CalendarDays, ChevronRight, Home, Phone, MoreHorizontal, X, Plus,
  Sparkles, Briefcase,
} from "lucide-react"
import { GlobalSearch } from "@/components/global-search"
import { NotificationBadge } from "@/components/notification-badge"
import { WorkingCapitalWidget } from "@/components/working-capital-widget"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useUser } from "@clerk/react"
import { useCompany } from "@/contexts/company-context"
import type { ActiveCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { useQuery } from "@tanstack/react-query"

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  perm?: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

/* ─────────────────────────────────────────────────────────────
   Nav definitions — grouped for collapsible sections
───────────────────────────────────────────────────────────── */
const parentGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { name: "Portfolio Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Analytics", href: "/analytics", icon: TrendingUp },
      { name: "Director Portal", href: "/director", icon: PieChart, perm: "director.view" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { name: "Team Chat", href: "/chat", icon: MessageSquare, perm: "chat.read" },
      { name: "Meetings", href: "/meetings", icon: Video },
    ],
  },
  {
    label: "Companies",
    items: [
      { name: "Companies", href: "/companies", icon: Building2, perm: "platform.companies" },
      { name: "Marketing", href: "/marketing", icon: Megaphone, perm: "marketing.view" },
      { name: "Account Directory", href: "/accounts", icon: Contact, perm: "directory.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Finance", href: "/finance", icon: Wallet, perm: "finance.view" },
      { name: "Treasury", href: "/treasury", icon: Landmark, perm: "treasury.view" },
      { name: "Fund Allocation", href: "/fund-allocation", icon: Landmark, perm: "funds.view" },
      { name: "Shareholders", href: "/shareholders", icon: PieChart, perm: "shareholders.view" },
    ],
  },
  {
    label: "People & Ops",
    items: [
      { name: "HR & People", href: "/hr", icon: Users, perm: "hr.view" },
      { name: "Documents", href: "/documents", icon: FileText, perm: "documents.view" },
      { name: "Approvals", href: "/approvals", icon: CheckSquare, perm: "approvals.view" },
      { name: "Team & Roles", href: "/admin/access", icon: ShieldCheck, perm: "platform.roles" },
    ],
  },
  {
    label: "AI",
    items: [
      { name: "AI Reports", href: "/ai-reports", icon: Bot, perm: "ai.reports" },
      { name: "AI Insights", href: "/ai-assistant", icon: Sparkles, perm: "ai.read" },
    ],
  },
]

const subsidiaryGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Team Chat", href: "/chat", icon: MessageSquare, perm: "chat.read" },
      { name: "Meetings", href: "/meetings", icon: Video },
      { name: "Call Center", href: "/call-center", icon: Headset, perm: "callcenter.view" },
      { name: "Planner", href: "/planner", icon: CalendarDays },
    ],
  },
  {
    label: "Commerce",
    items: [
      { name: "Orders", href: "/orders", icon: ShoppingCart, perm: "orders.view" },
      { name: "Products", href: "/inventory", icon: PackageSearch, perm: "inventory.view" },
      { name: "Shipping", href: "/shipping", icon: Truck, perm: "shipping.view" },
      { name: "Customers", href: "/crm", icon: UsersRound, perm: "crm.view" },
      { name: "Marketing", href: "/marketing", icon: Megaphone, perm: "marketing.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Finance", href: "/finance", icon: Wallet, perm: "finance.view" },
    ],
  },
  {
    label: "AI & Tasks",
    items: [
      { name: "AI Tasks", href: "/ai-tasks", icon: Sparkles, perm: "ai_tasks.read" },
    ],
  },
  {
    label: "Admin",
    items: [
      { name: "Documents", href: "/documents", icon: FileText, perm: "documents.view" },
      { name: "Account Directory", href: "/accounts", icon: Contact, perm: "directory.view" },
      { name: "Integrations", href: "/integrations", icon: Globe2, perm: "platform.integrations" },
    ],
  },
]

function getNavGroups(company: ActiveCompany | null, isSuperAdmin: boolean, isParentView: boolean): NavGroup[] {
  const base: NavGroup[] = company?.mode === "parent" || !company
    ? parentGroups
    : subsidiaryGroups

  let groups = [...base]

  // Super admin extras
  if (isSuperAdmin) {
    groups = [
      ...groups,
      {
        label: "Super Admin",
        items: [
          ...(!isParentView ? [{ name: "Team & Roles", href: "/admin/access", icon: ShieldCheck }] : []),
          ...(isParentView ? [{ name: "Team Chat", href: "/chat", icon: MessageSquare }] : []),
          { name: "Audit Logs", href: "/admin/audit", icon: ScrollText },
          { name: "Admin Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
        ],
      },
    ]
  }

  return groups
}

/* ─────────────────────────────────────────────────────────────
   Bottom nav items (mobile) — most-used 4 + "More"
───────────────────────────────────────────────────────────── */
const bottomNavItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/chat", icon: MessageSquare, label: "Chat" },
  { href: "/meetings", icon: Video, label: "Meetings" },
  { href: "/ai-tasks", icon: Sparkles, label: "Tasks" },
]

/* ─────────────────────────────────────────────────────────────
   Company Switcher
───────────────────────────────────────────────────────────── */
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
  const color = activeCompany?.color ?? "#2F80FF"

  const sorted = [...companies].sort((a, b) => {
    if (a.mode === "parent" && b.mode !== "parent") return -1
    if (b.mode === "parent" && a.mode !== "parent") return 1
    return a.name.localeCompare(b.name)
  })

  if (collapsed) {
    return (
      <div className="relative" ref={ref}>
        <button
          data-compact
          onClick={() => setOpen(!open)}
          className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-xs font-bold transition-opacity hover:opacity-80"
          style={{ background: color }}
          title={label}
        >
          {initials}
        </button>
        {open && (
          <div className="absolute left-11 top-0 z-50 w-56 bg-popover border border-popover-border rounded-[14px] py-1.5 overflow-hidden">
            <CompanyList sorted={sorted} activeCompany={activeCompany} setActiveCompanyId={setActiveCompanyId} setOpen={setOpen} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] border border-sidebar-border hover:bg-sidebar-accent transition-all duration-150"
      >
        <div
          className="w-6 h-6 rounded-[7px] flex items-center justify-center text-white text-[10px] font-bold shrink-0"
          style={{ background: color }}
        >
          {initials}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-[13px] font-semibold truncate leading-none text-sidebar-foreground">{label}</div>
          <div className="text-[10px] text-muted-foreground leading-none mt-0.5">
            {activeCompany == null || activeCompany.mode === "parent"
              ? "Portfolio View"
              : activeCompany.industry ?? "Subsidiary"}
          </div>
        </div>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 bg-popover border border-popover-border rounded-[14px] py-1.5 overflow-hidden">
          <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
            Switch Workspace
          </div>
          <CompanyList sorted={sorted} activeCompany={activeCompany} setActiveCompanyId={setActiveCompanyId} setOpen={setOpen} />
        </div>
      )}
    </div>
  )
}

function CompanyList({
  sorted, activeCompany, setActiveCompanyId, setOpen,
}: {
  sorted: ActiveCompany[]
  activeCompany: ActiveCompany | null
  setActiveCompanyId: (id: number | null) => void
  setOpen: (v: boolean) => void
}) {
  return (
    <>
      <button
        data-compact
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-accent transition-colors",
          activeCompany == null && "text-primary"
        )}
        onClick={() => { setActiveCompanyId(null); setOpen(false) }}
      >
        <div className="w-6 h-6 rounded-[7px] flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: "#2F80FF" }}>
          TH
        </div>
        <div className="text-left flex-1 min-w-0">
          <div className="font-medium leading-none truncate">TapasHub</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Portfolio View</div>
        </div>
        {activeCompany == null && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      </button>
      <div className="my-1 border-t border-border/60 mx-2" />
      {sorted.filter((c) => c.mode !== "parent").map((c) => (
        <button
          key={c.id}
          data-compact
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-accent transition-colors",
            activeCompany?.id === c.id && "text-primary"
          )}
          onClick={() => { setActiveCompanyId(c.id); setOpen(false) }}
        >
          <div
            className="w-6 h-6 rounded-[7px] flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{ background: c.color }}
          >
            {c.name.substring(0, 2).toUpperCase()}
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="font-medium leading-none truncate">{c.name}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.industry ?? "Subsidiary"}</div>
          </div>
          {activeCompany?.id === c.id && <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
        </button>
      ))}
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   Collapsible Nav Group
───────────────────────────────────────────────────────────── */
function NavGroupSection({
  group,
  location,
  collapsed,
  workspaceColor,
  aiTasksUnreadCount,
  onNavigate,
}: {
  group: NavGroup
  location: string
  collapsed: boolean
  workspaceColor: string
  aiTasksUnreadCount: number
  onNavigate?: () => void
}) {
  const hasActive = group.items.some(
    (item) => location === item.href || (item.href !== "/" && location.startsWith(item.href))
  )
  const [open, setOpen] = React.useState(hasActive || group.label === "Workspace" || group.label === "Overview")

  return (
    <div className="mb-3">
      {!collapsed && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2 py-1 mb-0.5 group"
        >
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground/80 flex-1 text-left group-hover:text-foreground/90 transition-colors">
            {group.label}
          </span>
          <ChevronRight
            className={cn("w-3 h-3 text-muted-foreground/30 transition-transform duration-200", open && "rotate-90")}
          />
        </button>
      )}

      {(open || collapsed) && (
        <div className={cn("space-y-px", collapsed && "flex flex-col items-center")}>
          {group.items.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
            return (
              <Link key={item.name} href={item.href} className="block" onClick={onNavigate}>
                <span
                  className={cn(
                    "nav-item-active flex items-center rounded-[10px] text-[13px] font-medium transition-all duration-150 group relative",
                    collapsed
                      ? "w-9 h-9 justify-center mx-auto"
                      : "px-2.5 py-2 gap-2.5",
                    isActive
                      ? "bg-primary text-white"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                  title={collapsed ? item.name : undefined}
                >
                  <item.icon className={cn("shrink-0", collapsed ? "w-[18px] h-[18px]" : "w-[16px] h-[16px]")} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.href === "/ai-tasks" && aiTasksUnreadCount > 0 && (
                        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                          {aiTasksUnreadCount > 99 ? "99+" : aiTasksUnreadCount}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && item.href === "/ai-tasks" && aiTasksUnreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                      {aiTasksUnreadCount > 9 ? "9+" : aiTasksUnreadCount}
                    </span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Layout
───────────────────────────────────────────────────────────── */
function useMobileScrollBehavior(scroller: HTMLElement | null) {
  const [scrollDirection, setScrollDirection] = React.useState<"up" | "down" | null>(null)
  const [typing, setTyping] = React.useState(false)

  const lastScrollY = React.useRef(0)
  const lastScrollTime = React.useRef(0)

  React.useEffect(() => {
    if (!scroller) return
    const onScroll = () => {
      const now = Date.now()
      const y = scroller.scrollTop
      const dy = y - lastScrollY.current
      if (now - lastScrollTime.current < 80) return
      lastScrollTime.current = now
      if (dy > 6) setScrollDirection("down")
      else if (dy < -6) setScrollDirection("up")
      lastScrollY.current = y
    }
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [scroller])

  React.useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        setTyping(true)
      }
    }
    const onBlur = () => setTyping(false)
    document.addEventListener("focusin", onFocus)
    document.addEventListener("focusout", onBlur)
    return () => {
      document.removeEventListener("focusin", onFocus)
      document.removeEventListener("focusout", onBlur)
    }
  }, [])

  return { scrollDirection, typing }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = React.useState(true)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [moreOpen, setMoreOpen] = React.useState(false)
  const { activeCompany, isParentView } = useCompany()
  const { logout, user: authUser, isSuperAdmin, hasPermission } = useAuth()
  const { user: clerkUser } = useUser()

  const navGroups = getNavGroups(activeCompany ?? null, isSuperAdmin, isParentView)

  // Flatten for permission filtering — done per item inside render
  const collapsed = !sidebarOpen

  const { data: aiTasksUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/ai-tasks/notifications/unread-count", activeCompany?.id],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/notifications/unread-count?companyId=${activeCompany?.id}`, {
        credentials: "include",
      })
      if (!res.ok) return { count: 0 }
      return res.json()
    },
    enabled: !!activeCompany?.id,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const aiTasksUnreadCount = aiTasksUnread?.count ?? 0

  const [mainScroller, setMainScroller] = React.useState<HTMLElement | null>(null)
  const mainRef = React.useCallback((node: HTMLElement | null) => {
    setMainScroller(node)
  }, [])
  const { scrollDirection, typing } = useMobileScrollBehavior(mainScroller)
  const hideMobileChrome = typing || scrollDirection === "down"

  const workspaceLabel = activeCompany?.name ?? "TapasHub"
  const workspaceColor = activeCompany?.color ?? "#3B82F6"

  // Filter groups to only items with permissions
  const filteredGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.perm || hasPermission(item.perm)),
    }))
    .filter((g) => g.items.length > 0)

  // Mobile: all nav items flattened for "More" drawer
  const allNavFlat = filteredGroups.flatMap((g) => g.items)

  /* ── Sidebar contents (shared desktop + mobile) ── */
  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn(
        "h-14 flex items-center border-b border-sidebar-border shrink-0",
        collapsed ? "px-3 justify-center" : "px-4 gap-2.5"
      )}>
        <div
          className="w-7 h-7 rounded-[8px] shrink-0 flex items-center justify-center"
          style={{ background: "#2F80FF" }}
        >
          <img
            src="/tapashub-logo.png"
            alt="TapasHub"
            className="w-5 h-5 object-contain brightness-0 invert"
            loading="eager"
            decoding="sync"
          />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-[13px] leading-none tracking-wide text-foreground">TAPBOSS</div>
            <div className="text-[10px] text-muted-foreground leading-none mt-0.5">Business OS</div>
          </div>
        )}
      </div>

      {/* Company Switcher */}
      <div className={cn("py-2", collapsed ? "flex justify-center px-2" : "px-2")}>
        <CompanySwitcher collapsed={collapsed} />
      </div>

      {/* Nav scroll area */}
      <nav
        className="flex-1 overflow-y-auto py-1 px-2"
        style={{ scrollbarWidth: "none" }}
      >
        {filteredGroups.map((group) => (
          <NavGroupSection
            key={group.label}
            group={group}
            location={location}
            collapsed={collapsed}
            workspaceColor={workspaceColor}
            aiTasksUnreadCount={aiTasksUnreadCount}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {/* Working Capital widget */}
      {!collapsed && isParentView && <WorkingCapitalWidget />}

      {/* Bottom: Settings + Logout */}
      <div className={cn(
        "px-2 py-2 border-t border-sidebar-border shrink-0",
        collapsed ? "flex flex-col items-center gap-0.5" : "space-y-0.5"
      )}>
        <Link href="/settings" className="block" onClick={onNavigate}>
          <span className={cn(
            "flex items-center rounded-[10px] text-[13px] font-medium transition-all duration-150",
            collapsed ? "w-9 h-9 justify-center" : "px-2.5 py-2 gap-2.5",
            location.startsWith("/settings")
              ? "bg-primary text-white"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings className="shrink-0 w-[18px] h-[18px]" />
            {!collapsed && <span className="flex-1">Settings</span>}
          </span>
        </Link>
        <button
          data-compact
          onClick={() => logout()}
          className={cn(
            "w-full flex items-center rounded-[10px] text-[13px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-150",
            collapsed ? "w-9 h-9 justify-center" : "px-2.5 py-2 gap-2.5"
          )}
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="shrink-0 w-[18px] h-[18px]" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden font-sans">

      {/* ── Desktop Sidebar ─────────────────────────────────── */}
      <aside className={cn(
        "hidden md:flex flex-col bg-sidebar border-r border-sidebar-border shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden",
        collapsed ? "w-[68px]" : "w-60"
      )}>
        <SidebarContent />
      </aside>

      {/* ── Mobile Sidebar overlay ───────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <aside
            className="drawer-slide-in absolute left-0 top-0 bottom-0 w-72 flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              className="absolute top-4 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              onClick={() => setMobileOpen(false)}
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">

        {/* Topbar */}
        <header className={cn("h-14 flex items-center justify-between px-3 sm:px-4 border-b border-border bg-card z-10 shrink-0 gap-2 transition-transform duration-300 md:translate-y-0", hideMobileChrome && "-translate-y-full")}>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Desktop collapse toggle */}
            <Button
              variant="ghost" size="icon"
              className="hidden md:flex w-8 h-8 text-muted-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Menu className="w-4 h-4" />
            </Button>
            {/* Mobile hamburger */}
            <Button
              variant="ghost" size="icon"
              className="md:hidden w-8 h-8 text-muted-foreground"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="w-4 h-4" />
            </Button>

            {/* Workspace breadcrumb */}
            <div className="hidden sm:flex items-center gap-1.5 pl-1">
              <span className="text-sm text-muted-foreground font-medium">
                {isParentView ? "TapasHub" : "TapasHub"}
              </span>
              {!isParentView && (
                <>
                  <span className="text-muted-foreground/30 text-sm select-none">/</span>
                  <span className="text-sm font-semibold text-foreground">
                    {workspaceLabel}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Global Search — centered */}
          <div className="flex-1 hidden md:flex justify-center px-6 max-w-md mx-auto">
            <GlobalSearch />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost" size="icon"
              className="w-8 h-8 text-muted-foreground hover:text-foreground"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={theme === "light" ? "Dark mode" : "Light mode"}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>

            <NotificationBadge />

            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
              <Avatar
                className="w-7 h-7 cursor-pointer ring-2 ring-offset-1 ring-offset-card transition-opacity hover:opacity-80"
                style={{ "--ring-color": workspaceColor } as React.CSSProperties}
              >
                <AvatarImage
                  src={clerkUser?.imageUrl || authUser?.avatarUrl || undefined}
                  alt={authUser?.name || "User"}
                  className="object-cover"
                />
                <AvatarFallback
                  className="text-[11px] font-bold text-white"
                  style={{ background: workspaceColor }}
                >
                  {authUser?.name?.substring(0, 2).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block max-w-[110px]">
                <div className="text-[13px] font-semibold leading-tight truncate">{authUser?.name || "User"}</div>
                <div className="text-[11px] text-muted-foreground leading-tight capitalize truncate">
                  {authUser?.role?.replace(/_/g, " ") || ""}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main ref={mainRef} className={cn("flex-1 overflow-auto bg-background p-3 sm:p-5 main-content-mobile", typing && "pb-3 sm:pb-5")}>
          <div className="max-w-7xl mx-auto fade-in">
            {children}
          </div>
        </main>
      </div>

      {/* ══════════════ MOBILE BOTTOM NAVIGATION ══════════════ */}
      <nav className={cn("bottom-nav transition-transform duration-300", hideMobileChrome && "translate-y-full")}>
        <div className="flex items-stretch h-16">
          {bottomNavItems.map(({ href, icon: Icon, label }) => {
            const isActive = location === href || (href !== "/" && location.startsWith(href))
            const showBadge = href === "/ai-tasks" && aiTasksUnreadCount > 0
            return (
              <Link key={href} href={href} className="flex-1 min-w-0 min-h-0">
                <span className={cn(
                  "flex flex-col items-center justify-center h-full gap-1 transition-all duration-150 relative",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}>
                  <div className="relative">
                    <Icon className="w-5 h-5" />
                    {showBadge && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                        {aiTasksUnreadCount > 9 ? "9+" : aiTasksUnreadCount}
                      </span>
                    )}
                  </div>
                  <span className={cn(
                    "text-[11px] font-medium leading-none transition-all",
                    isActive && "font-semibold"
                  )}>
                    {label}
                  </span>
                  {isActive && (
                    <span
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                      style={{ background: workspaceColor }}
                    />
                  )}
                </span>
              </Link>
            )
          })}

          {/* More button */}
          <button
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors relative"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[11px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* "More" drawer on mobile */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl shadow-2xl overflow-hidden"
            style={{ maxHeight: "75vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="px-4 py-2 flex items-center justify-between border-b">
              <span className="font-semibold text-sm">All Sections</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3" style={{ maxHeight: "calc(75vh - 80px)" }}>
              <div className="grid grid-cols-3 gap-2">
                {allNavFlat.map((item) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}>
                      <span className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-2xl transition-all",
                        isActive
                          ? "text-white"
                          : "bg-muted/40 text-foreground hover:bg-muted"
                      )}
                        style={isActive ? { background: workspaceColor } : undefined}
                      >
                        <item.icon className="w-6 h-6" />
                        <span className="text-[11px] font-medium text-center leading-tight">{item.name}</span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile FAB (context-aware) ───────────────────────── */}
      <MobileFab location={location} workspaceColor={workspaceColor} hidden={hideMobileChrome} />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Mobile FAB — shows primary action for current page
───────────────────────────────────────────────────────────── */
function MobileFab({ location, workspaceColor, hidden }: { location: string; workspaceColor: string; hidden?: boolean }) {
  const fab = React.useMemo(() => {
    if (location === "/chat") return null // Chat has its own composer
    if (location.startsWith("/meetings")) return { icon: Video, title: "New Meeting" }
    if (location.startsWith("/ai-tasks")) return { icon: Sparkles, title: "New AI Task" }
    if (location.startsWith("/call-center")) return { icon: Phone, title: "New Call" }
    if (location.startsWith("/inventory")) return { icon: Plus, title: "Add Product" }
    if (location.startsWith("/orders")) return { icon: Plus, title: "New Order" }
    if (location.startsWith("/crm")) return { icon: Plus, title: "New Contact" }
    if (location.startsWith("/planner")) return { icon: Plus, title: "New Task" }
    return null
  }, [location])

  if (!fab) return null

  return (
    <button
      className={cn("fab", hidden && "translate-y-[140%] opacity-0 pointer-events-none")}
      style={{ background: workspaceColor, boxShadow: `0 8px 24px ${workspaceColor}55` }}
      title={fab.title}
      aria-label={fab.title}
    >
      <fab.icon className="w-6 h-6" />
    </button>
  )
}
