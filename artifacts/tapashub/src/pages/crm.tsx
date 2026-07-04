import { useListCustomers, getListCustomersQueryKey, useListLeads, getListLeadsQueryKey } from "@workspace/api-client-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { UsersRound, Phone, Mail } from "lucide-react"

export default function CRM() {
  const { data: customers, isLoading: loadingCustomers } = useListCustomers({ limit: 50 }, {
    query: { enabled: true, queryKey: getListCustomersQueryKey({ limit: 50 }) }
  })

  const { data: leads, isLoading: loadingLeads } = useListLeads({ limit: 50 }, {
    query: { enabled: true, queryKey: getListLeadsQueryKey({ limit: 50 }) }
  })

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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Total Orders</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCustomers ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : customers?.items?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        <UsersRound className="mx-auto h-8 w-8 opacity-20 mb-2" />
                        No customers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    customers?.items?.map((customer) => (
                      <TableRow key={customer.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground"/> {customer.email}</div>
                            {customer.phone && <div className="flex items-center gap-1 mt-1 text-muted-foreground"><Phone className="w-3 h-3"/> {customer.phone}</div>}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="font-normal">{customer.companyName}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{customer.totalOrders}</TableCell>
                        <TableCell className="text-right font-medium text-success">${customer.totalSpend.toLocaleString()}</TableCell>
                        <TableCell>
                           <Badge variant={customer.status === 'active' ? 'success' : customer.status === 'vip' ? 'default' : 'secondary'} className="capitalize text-[10px]">
                            {customer.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
        
        <TabsContent value="leads" className="mt-4">
          {/* Simple table for leads for now instead of kanban to ensure robustness */}
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Lead Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Target Company</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                  <TableHead>Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingLeads ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : leads?.items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      No leads found
                    </TableCell>
                  </TableRow>
                ) : (
                  leads?.items?.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="font-medium">{lead.name}</div>
                        <div className="text-xs text-muted-foreground">{lead.email}</div>
                      </TableCell>
                      <TableCell className="capitalize text-sm text-muted-foreground">{lead.source.replace('_', ' ')}</TableCell>
                      <TableCell><Badge variant="outline">{lead.companyName}</Badge></TableCell>
                      <TableCell className="text-right font-medium">${lead.value.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {lead.stage}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
