import * as React from "react"
import { useListCompanies } from "@workspace/api-client-react"

export type CompanyMode = "parent" | "subsidiary"

export interface ActiveCompany {
  id: number
  name: string
  slug: string
  mode: CompanyMode
  industry?: string | null
  color?: string
}

interface CompanyContextValue {
  activeCompany: ActiveCompany | null   // null = TapasHub parent view
  setActiveCompanyId: (id: number | null) => void
  companies: ActiveCompany[]
  isParentView: boolean
}

const CompanyContext = React.createContext<CompanyContextValue>({
  activeCompany: null,
  setActiveCompanyId: () => {},
  companies: [],
  isParentView: true,
})

const COMPANY_COLORS: Record<string, string> = {
  tapashub: "#2563EB",
  hugfab: "#EC4899",
  tikkatails: "#F59E0B",
  throttledaires: "#EF4444",
  sanchikart: "#8B5CF6",
  pepalworks: "#14B8A6",
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = React.useState<number | null>(null)
  const { data: rawCompanies } = useListCompanies({
    query: { enabled: true, queryKey: ["/api/companies"] }
  })

  const companies: ActiveCompany[] = React.useMemo(
    () =>
      (rawCompanies || []).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        mode: c.type as CompanyMode,
        industry: c.industry,
        color: COMPANY_COLORS[c.slug.toLowerCase()] ?? "#64748B",
      })),
    [rawCompanies]
  )

  const activeCompany = React.useMemo(
    () => (activeId == null ? null : companies.find((c) => c.id === activeId) ?? null),
    [activeId, companies]
  )

  const isParentView = activeCompany == null || activeCompany.mode === "parent"

  return (
    <CompanyContext.Provider
      value={{ activeCompany, setActiveCompanyId: setActiveId, companies, isParentView }}
    >
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  return React.useContext(CompanyContext)
}
