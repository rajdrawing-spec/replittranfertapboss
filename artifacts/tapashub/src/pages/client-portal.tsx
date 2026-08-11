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

/** Read-only, client-visible records for the active project. */
function useProjectRecords(projectId: number | null, kind: "campaigns" | "creatives" | "leads") {
  return useQuery<any[]>({
    queryKey: ["/api/client/marketing/projects", projectId, kind],
    queryFn: () => fetchJson(`/api/client/marketing/projects/${projectId}/${kind}`),
    enabled: projectId !== null,
  })
}

function RecordList({ rows, isLoading, empty, render }: {
  rows: any[] | undefined
  isLoading: boolean
  empty: string
  render: (row: any) => React.ReactNode
}) {
  if (isLoading) {
    return <div className="flex h-40 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center">
        <p className="text-sm text-muted-foreground">{empty}</p>
      </div>
    )
  }
  return <div className="space-y-2">{rows.map(render)}</div>
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
  const campaigns = useProjectRecords(section === "campaigns" || section === "overview" ? projectId : null, "campaigns")
  const creatives = useProjectRecords(section === "creatives" || section === "overview" ? projectId : null, "creatives")
  const leads = useProjectRecords(section === "leads" || section === "overview" ? projectId : null, "leads")

  if (section === "overview") {
    const stats = [
      { label: "Active campaigns", value: campaigns.data?.filter((c) => c.status === "active").length ?? "—" },
      { label: "Total campaigns", value: campaigns.data?.length ?? "—" },
      { label: "Leads", value: leads.data?.length ?? "—" },
      { label: "Creatives", value: creatives.data?.length ?? "—" },
    ]
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-4">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    )
  }

  if (section === "campaigns") {
    return (
      <RecordList rows={campaigns.data} isLoading={campaigns.isLoading}
        empty="No campaigns have been shared with you yet."
        render={(c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-sm text-muted-foreground">{c.platform ?? c.type ?? "Campaign"}</div>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs capitalize">{c.status}</span>
          </div>
        )} />
    )
  }

  if (section === "creatives") {
    return (
      <RecordList rows={creatives.data} isLoading={creatives.isLoading}
        empty="No creatives have been shared with you yet."
        render={(c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover" /> : <Image className="h-6 w-6 text-muted-foreground" />}
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm capitalize text-muted-foreground">{c.type}</div>
              </div>
            </div>
            {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-sm underline">View</a>}
          </div>
        )} />
    )
  }

  if (section === "leads") {
    return (
      <RecordList rows={leads.data} isLoading={leads.isLoading}
        empty="No leads have been shared with you yet."
        render={(l) => (
          <div key={l.id} className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <div className="font-medium">{l.name}</div>
              <div className="text-sm text-muted-foreground">{l.source ?? ""}</div>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs capitalize">{l.status ?? "new"}</span>
          </div>
        )} />
    )
  }

  // Sales, Reports, AI Plan arrive with the dashboards & copilot phases.
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
      <Sparkles className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">Coming soon</p>
      <p className="max-w-sm text-sm text-muted-foreground">This dashboard is being prepared by the team.</p>
    </div>
  )
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
