import { useListCustomers, getListCustomersQueryKey, useListLeads, getListLeadsQueryKey } from "@workspace/api-client-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { UsersRound, Handshake, Phone, Mail } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/responsive-table"
import { QueryState } from "@/components/query-state"

export default function CRM() {
  const { activeCompany } = useCompany()

  const customerParams: Record<string, string | number> = { limit: 50 }
  if (activeCompany) customerParams.companyId = activeCompany.id
  const leadParams: Record<string, string | number> = { limit: 50 }
  if (activeCompany) leadParams.companyId = activeCompany.id

  const { data: customers, isLoading: loadingCustomers, isError: customersError, refetch: refetchCustomers } = useListCustomers(customerParams, {
    query: { enabled: true, queryKey: getListCustomersQueryKey(customerParams) }
  })

  const { data: leads, isLoading: loadingLeads, isError: leadsError, refetch: refetchLeads } = useListLeads(leadParams, {
    query: { enabled: true, queryKey: getListLeadsQueryKey(leadParams) }
  })

  const customerColumns: ResponsiveTableColumn<NonNullable<typeof customers>["items"][number]>[] = [
    { key: "name", header: "Customer", card: "title", cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      key: "contact", header: "Contact", card: "subtitle",
      cell: (c) => (
        <div className="text-sm">
          <div className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground" /> {c.email}</div>
          {c.phone && <div className="flex items-center gap-1 mt-1 text-muted-foreground"><Phone className="w-3 h-3" /> {c.phone}</div>}
        </div>
      ),
      cardCell: (c) => c.email,
    },
    { key: "companyName", header: "Company", cell: (c) => <Badge variant="outline" className="font-normal">{c.companyName}</Badge> },
    { key: "totalOrders", header: "Total Orders", headClassName: "text-right", cellClassName: "text-right", cell: (c) => <span className="font-medium">{c.totalOrders}</span> },
    { key: "totalSpend", header: "Total Spend", headClassName: "text-right", cellClassName: "text-right", cell: (c) => <span className="font-medium text-success">₹{c.totalSpend.toLocaleString('en-IN')}</span> },
    {
      key: "status", header: "Status", card: "badge",
      cell: (c) => <Badge variant={c.status === 'active' ? 'success' : c.status === 'vip' ? 'default' : 'secondary'} className="capitalize text-[10px]">{c.status}</Badge>,
    },
  ]

  const leadColumns: ResponsiveTableColumn<NonNullable<typeof leads>["items"][number]>[] = [
    {
      key: "name", header: "Lead Name", card: "title",
      cell: (l) => (
        <div>
          <div className="font-medium">{l.name}</div>
          <div className="text-xs text-muted-foreground">{l.email}</div>
        </div>
      ),
      cardCell: (l) => l.name,
    },
    { key: "source", header: "Source", card: "subtitle", cell: (l) => <span className="capitalize text-sm text-muted-foreground">{l.source.replace('_', ' ')}</span> },
    { key: "companyName", header: "Target Company", cell: (l) => <Badge variant="outline">{l.companyName}</Badge> },
    { key: "value", header: "Est. Value", headClassName: "text-right", cellClassName: "text-right", cell: (l) => <span className="font-medium">₹{l.value.toLocaleString('en-IN')}</span> },
    {
      key: "stage", header: "Stage", card: "badge",
      cell: (l) => <Badge variant="secondary" className="capitalize">{l.stage}</Badge>,
    },
  ]

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">CRM</h1>
          <p className="text-muted-foreground mt-1">Customer and Lead Relationship Management</p>
        </div>
      </div>

      <Tabs defaultValue="customers" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="leads">Leads / Pipeline</TabsTrigger>
        </TabsList>
        
        <TabsContent value="customers" className="mt-4">
          <Card className="overflow-hidden">
            <div className="p-3 md:p-0">
              <QueryState
                isLoading={loadingCustomers}
                isError={customersError}
                isEmpty={(customers?.items?.length ?? 0) === 0}
                onRetry={refetchCustomers}
                errorMessage="Could not load customers."
                emptyMessage="No customers found"
                emptyIcon={UsersRound}
                loading={<ResponsiveTable columns={customerColumns} data={[]} rowKey={(c) => c.id} isLoading skeletonCount={5} />}
              >
                <ResponsiveTable columns={customerColumns} data={customers?.items ?? []} rowKey={(c) => c.id} />
              </QueryState>
            </div>
          </Card>
        </TabsContent>
        
        <TabsContent value="leads" className="mt-4">
          {/* Simple table for leads for now instead of kanban to ensure robustness */}
          <Card className="overflow-hidden">
            <div className="p-3 md:p-0">
              <QueryState
                isLoading={loadingLeads}
                isError={leadsError}
                isEmpty={(leads?.items?.length ?? 0) === 0}
                onRetry={refetchLeads}
                errorMessage="Could not load leads."
                emptyMessage="No leads found"
                emptyIcon={Handshake}
                loading={<ResponsiveTable columns={leadColumns} data={[]} rowKey={(l) => l.id} isLoading skeletonCount={5} />}
              >
                <ResponsiveTable columns={leadColumns} data={leads?.items ?? []} rowKey={(l) => l.id} />
              </QueryState>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
