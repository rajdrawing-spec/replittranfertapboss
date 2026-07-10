import { useParams, Link } from "wouter"
import { useGetCompany, getGetCompanyQueryKey, useGetCompanySummary, getGetCompanySummaryQueryKey } from "@workspace/api-client-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { adminApi } from "@/lib/admin-api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState, NoData } from "@/components/empty-state"
import { ArrowLeft, FileText, Brain, Sparkles, TrendingUp, TrendingDown, Activity, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface AiValuation {
  id: number; companyId: number; provider: string
  estimatedValue: number | null; growthScore: number | null
  healthTrend: string | null; revenueGrowthRate: number | null
  explanation: string | null; createdAt: string
}

const inr = (n: number | null | undefined) => n != null ? `₹${n >= 10000000 ? (n / 10000000).toFixed(1) + "Cr" : n >= 100000 ? (n / 100000).toFixed(1) + "L" : Math.round(n).toLocaleString("en-IN")}` : "—"

export default function CompanyDetail() {
  const params = useParams()
  const companyId = params.id ? parseInt(params.id) : 0
  const qc = useQueryClient()

  const { data: company, isLoading: loadingCompany } = useGetCompany(companyId, {
    query: { enabled: !!companyId, queryKey: getGetCompanyQueryKey(companyId) }
  })

  const { data: summary, isLoading: loadingSummary } = useGetCompanySummary(companyId, {
    query: { enabled: !!companyId, queryKey: getGetCompanySummaryQueryKey(companyId) }
  })

  const valKey = ["/api/ai/valuation", companyId]
  const { data: valuation, isLoading: valLoading } = useQuery<AiValuation | null>({
    queryKey: valKey,
    queryFn: () => adminApi.get(`/ai/valuation/${companyId}`),
    enabled: !!companyId,
  })

  const runVal = useMutation({
    mutationFn: () => adminApi.post(`/ai/valuation/${companyId}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: valKey }),
  })

  const val = runVal.data ?? valuation

  if (loadingCompany || loadingSummary) {
    return <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    </div>
  }

  if (!company) {
    return <div className="text-center py-20">Company not found</div>
  }

  const healthColor = val?.healthTrend === "growing"
    ? "text-green-400" : val?.healthTrend === "declining"
    ? "text-red-400" : "text-amber-400"

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground" asChild>
          <Link href="/companies"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Companies</Link>
        </Button>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-2xl shadow-sm">
              {company.logoUrl ? <img src={company.logoUrl.startsWith("/objects") ? `/api/storage${company.logoUrl}` : company.logoUrl} alt={company.name} className="w-full h-full object-cover rounded-xl" /> : company.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                {company.name}
                <Badge variant={company.status === 'active' ? 'success' : 'outline'} className="uppercase text-[10px]">
                  {company.status}
                </Badge>
              </h1>
              <p className="text-muted-foreground mt-1">
                {company.industry || 'General Business'} • {company.ownershipPercent}% Ownership
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline"><FileText className="w-4 h-4 mr-2" /> Report</Button>
            <Button>Edit Details</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.revenue ? `₹${summary.revenue.toLocaleString('en-IN')}` : <NoData />}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.orders ? summary.orders.toLocaleString() : <NoData />}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.employees ? summary.employees.toLocaleString() : <NoData />}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.profit != null ? `₹${summary.profit.toLocaleString('en-IN')}` : <NoData />}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Company Details</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Inventory Health</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState />
              </CardContent>
            </Card>

            {/* AI Valuation snapshot widget */}
            <Card className="border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />
                  AI Valuation Snapshot
                  <Badge variant="outline" className="text-[9px] gap-1 ml-auto">
                    <Sparkles className="w-2 h-2" /> Estimate
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {valLoading && <Skeleton className="h-16 w-full" />}
                {!val && !valLoading && !runVal.isPending && (
                  <div className="text-center py-3">
                    <div className="text-xs text-muted-foreground mb-2">No AI valuation yet</div>
                    <Button size="sm" variant="outline" onClick={() => runVal.mutate()} className="h-7 text-xs gap-1.5">
                      <Brain className="w-3 h-3" /> Run Valuation
                    </Button>
                  </div>
                )}
                {runVal.isPending && <Skeleton className="h-16 w-full" />}
                {val && !runVal.isPending && (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Estimated Value</div>
                      <div className="text-xl font-bold text-green-400">{inr(val.estimatedValue)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Growth Score</div>
                        <div className={cn("font-semibold", val.growthScore != null && val.growthScore >= 70 ? "text-green-400" : val.growthScore != null && val.growthScore >= 40 ? "text-amber-400" : "text-red-400")}>
                          {val.growthScore != null ? `${val.growthScore}/100` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Health Trend</div>
                        <div className={cn("font-semibold flex items-center gap-1", healthColor)}>
                          {val.healthTrend === "growing" ? <TrendingUp className="w-3 h-3" /> : val.healthTrend === "declining" ? <TrendingDown className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                          {val.healthTrend ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Rev. Growth</div>
                        <div className={cn("font-semibold", val.revenueGrowthRate != null && val.revenueGrowthRate >= 0 ? "text-green-400" : "text-red-400")}>
                          {val.revenueGrowthRate != null ? `${val.revenueGrowthRate > 0 ? "+" : ""}${val.revenueGrowthRate.toFixed(1)}%` : "—"}
                        </div>
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" variant="ghost" onClick={() => runVal.mutate()} disabled={runVal.isPending} className="h-6 text-[10px] px-1.5 gap-1">
                          <RefreshCw className="w-2.5 h-2.5" /> Refresh
                        </Button>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground border-t pt-2">
                      <Link href="/ai-assistant" className="text-primary hover:underline">View full analysis →</Link>
                      <span className="ml-2">AI estimate — not financial advice</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Registration Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Legal Name</div>
                  <div className="mt-1">{company.name}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">GST Number</div>
                  <div className="mt-1">{company.gstNumber || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">PAN Number</div>
                  <div className="mt-1">{company.panNumber || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Address</div>
                  <div className="mt-1">{company.address || 'N/A'}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
