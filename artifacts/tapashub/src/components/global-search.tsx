import * as React from "react"
import { useLocation } from "wouter"
import { Search, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCompany } from "@/contexts/company-context"

interface Result {
  type: string
  id: number
  title: string
  subtitle: string
  href: string
}

const TYPE_COLORS: Record<string, string> = {
  Order: "text-blue-400 bg-blue-500/10",
  Customer: "text-green-400 bg-green-500/10",
  Product: "text-purple-400 bg-purple-500/10",
  Brand: "text-orange-400 bg-orange-500/10",
  Vault: "text-red-400 bg-red-500/10",
  Document: "text-amber-400 bg-amber-500/10",
  Shipment: "text-indigo-400 bg-indigo-500/10",
}

export function GlobalSearch() {
  const [, setLocation] = useLocation()
  const { activeCompany } = useCompany()
  const [q, setQ] = React.useState("")
  const [results, setResults] = React.useState<Result[]>([])
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // keyboard shortcut: Cmd/Ctrl+K
  React.useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [])

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (activeCompany) params.set("companyId", String(activeCompany.id))
        const res = await fetch(`/api/search?${params}`, { credentials: "include" })
        const data = await res.json()
        setResults(data.results || [])
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 220)
    return () => clearTimeout(t)
  }, [q, activeCompany])

  function go(r: Result) {
    setLocation(r.href)
    setOpen(false)
    setQ("")
  }

  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search orders, customers, vault, documents…"
          className="w-full h-9 pl-9 pr-16 rounded-lg bg-muted/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-background transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {q && (
            <button onClick={() => { setQ(""); setResults([]) }} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {!q && <kbd className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded border bg-background text-muted-foreground">⌘K</kbd>}
        </div>
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 bg-card border rounded-xl shadow-2xl max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">No results for "{q}"</div>
          )}
          {!loading && results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onClick={() => go(r)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left border-b last:border-0"
            >
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide shrink-0 w-20 text-center", TYPE_COLORS[r.type] || "text-muted-foreground bg-muted")}>
                {r.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
