import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import {
  LayoutDashboard, Megaphone, ShoppingCart, Users, Image, FileBarChart, Sparkles,
  ChevronDown, LogOut, Briefcase,
} from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  OverviewSection, CampaignsSection, SalesSection, LeadsSection,
  CreativesSection, ReportsSection, ComingSoon,
} from "./client-portal-sections"

interface PortalProject {
  id: number
  name: string
  brandName: string
  brandColor: string | null
  logoUrl: string | null
  status: string
  memberType: string
}

interface PortalContext {
  user: { id: number; name: string; email: string; role: string; avatarUrl: string | null }
  projects: PortalProject[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(`Failed (${r.status})`)
  return r.json()
}

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "sales", label: "Sales & Orders", icon: ShoppingCart },
  { key: "leads", label: "Leads", icon: Users },
  { key: "creatives", label: "Creative Library", icon: Image },
  { key: "reports", label: "Reports", icon: FileBarChart },
  { key: "ai-plan", label: "AI Plan", icon: Sparkles },
]

function SectionContent({ section, projectId }: { section: string; projectId: number }) {
  switch (section) {
    case "overview": return <OverviewSection key={projectId} projectId={projectId} />
    case "campaigns": return <CampaignsSection key={projectId} projectId={projectId} />
    case "sales": return <SalesSection key={projectId} projectId={projectId} />
    case "leads": return <LeadsSection key={projectId} projectId={projectId} />
    case "creatives": return <CreativesSection key={projectId} projectId={projectId} />
    case "reports": return <ReportsSection key={projectId} projectId={projectId} />
    default: return <ComingSoon /> // AI Plan ships with the copilot phase.
  }
}

/**
 * Client Marketing Portal shell. Client-role users land here exclusively —
 * the internal app layout is never rendered for them. Section content is
 * delivered by the dashboards phase; this shell establishes branding,
 * project switching, and navigation.
 */
export default function ClientPortal() {
  const { logout } = useAuth()
  const [activeProjectId, setActiveProjectId] = React.useState<number | null>(null)
  const [section, setSection] = React.useState("overview")

  const { data, isLoading, isError } = useQuery<PortalContext>({
    queryKey: ["/api/client/marketing/context"],
    queryFn: () => fetch("/api/client/marketing/context", { credentials: "include" }).then((r) => {
      if (!r.ok) throw new Error(`Failed (${r.status})`)
      return r.json()
    }),
  })

  const projects = data?.projects ?? []
  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null
  const brandColor = active?.brandColor || "#1d90e8"

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <h1 className="text-xl font-bold">Couldn't load your portal</h1>
        <p className="text-muted-foreground">Check your connection and try again.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  if (!active) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <Briefcase className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-bold">No projects assigned yet</h1>
        <p className="max-w-md text-muted-foreground">
          Your agency hasn't assigned you to a marketing project. Contact your account manager.
        </p>
        <Button variant="outline" onClick={() => logout()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      {/* Brand header */}
      <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderTopWidth: 3, borderTopColor: brandColor }}>
        <div className="flex items-center gap-3">
          {active.logoUrl ? (
            <img src={active.logoUrl} alt={active.brandName} className="h-9 w-9 rounded object-contain" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded font-bold text-white" style={{ backgroundColor: brandColor }}>
              {active.brandName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="font-bold leading-tight">{active.brandName}</div>
            <div className="text-xs text-muted-foreground">Marketing Portal</div>
          </div>
          {projects.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ml-2">
                  Switch project <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => setActiveProjectId(p.id)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{data?.user.name}</span>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="hidden w-56 shrink-0 border-r p-2 md:block">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.key ? "font-medium text-white" : "text-muted-foreground hover:bg-muted"
              }`}
              style={section === item.key ? { backgroundColor: brandColor } : undefined}
            >
              <item.icon className="h-4 w-4" /> {item.label}
            </button>
          ))}
        </nav>

        {/* Mobile nav */}
        <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-around border-t bg-background p-1 md:hidden">
          {NAV.slice(0, 5).map((item) => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className={`flex flex-col items-center rounded p-2 text-[10px] ${section === item.key ? "" : "text-muted-foreground"}`}
              style={section === item.key ? { color: brandColor } : undefined}
            >
              <item.icon className="h-5 w-5" />
              {item.label.split(" ")[0]}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
          <h1 className="mb-1 text-2xl font-bold">{NAV.find((n) => n.key === section)?.label}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{active.name}</p>
          <SectionContent section={section} projectId={active.id} />
        </main>
      </div>
    </div>
  )
}
