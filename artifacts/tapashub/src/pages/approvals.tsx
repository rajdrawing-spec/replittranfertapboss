import { useListApprovals, getListApprovalsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Check, X, CheckSquare, Clock } from "lucide-react"
import { useCompany } from "@/contexts/company-context"

export default function Approvals() {
  const { activeCompany } = useCompany()

  const params: Record<string, string | number> = { limit: 50 }
  if (activeCompany) params.companyId = activeCompany.id

  const { data, isLoading } = useListApprovals(params, {
    query: { enabled: true, queryKey: getListApprovalsQueryKey(params) }
  })

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Approvals Queue</h1>
          <p className="text-muted-foreground mt-1">Pending requests requiring your authorization</p>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-card/50">
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-3 w-full">
                    <Skeleton className="h-6 w-1/3" />
                    <Skeleton className="h-4 w-2/3" />
                    <div className="flex gap-2 pt-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-32" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : data?.items?.length === 0 ? (
          <Card className="bg-card/50 border-dashed">
            <CardContent className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <CheckSquare className="w-10 h-10 mb-3 opacity-20" />
              <p>You're all caught up! No pending approvals.</p>
            </CardContent>
          </Card>
        ) : (
          data?.items?.map((approval) => (
            <Card key={approval.id} className="bg-card/50 hover:bg-card/80 transition-colors border-muted">
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{approval.type}</Badge>
                      {approval.status === 'pending' && <Badge variant="warning" className="uppercase text-[10px]"><Clock className="w-3 h-3 mr-1"/> Pending</Badge>}
                    </div>
                    <h3 className="text-lg font-semibold">{approval.title}</h3>
                    <p className="text-sm text-muted-foreground">{approval.description}</p>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-xs text-muted-foreground">
                      <span className="flex items-center"><span className="font-medium text-foreground mr-1">Requester:</span> {approval.requestedBy}</span>
                      <span className="flex items-center"><span className="font-medium text-foreground mr-1">Company:</span> {approval.companyName}</span>
                      {approval.amount && <span className="flex items-center"><span className="font-medium text-foreground mr-1">Amount:</span> ₹{approval.amount.toLocaleString('en-IN')}</span>}
                    </div>
                  </div>
                  
                  {approval.status === 'pending' && (
                    <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-muted">
                      <Button variant="outline" className="flex-1 md:flex-none border-destructive text-destructive hover:bg-destructive/10">
                        <X className="w-4 h-4 mr-2" /> Reject
                      </Button>
                      <Button className="flex-1 md:flex-none">
                        <Check className="w-4 h-4 mr-2" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
