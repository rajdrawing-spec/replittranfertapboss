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

const DEFAULT_COLOR = "#64748B"

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = React.useState<number | null>(null)
  const { data: rawCompanies } = useListCompanies({
    query: { enabled: true, queryKey: ["/api/companies"] }
  })

  const companies: ActiveCompany[] = React.useMemo(
    () =>
      (rawCompanies || [])
        .filter((c) => !c.archived)
        .map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          mode: c.type as CompanyMode,
          industry: c.industry,
          color: c.brandColor || DEFAULT_COLOR,
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
