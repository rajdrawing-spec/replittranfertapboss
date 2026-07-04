import { useGetExecutiveSummary, getGetExecutiveSummaryQueryKey, useGetRecentActivity, getGetRecentActivityQueryKey, useGetAiInsights, getGetAiInsightsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Building2, TrendingUp, Users, ShoppingCart, AlertTriangle, ArrowUpRight, ArrowDownRight, Activity, ExternalLink } from "lucide-react"
import { Link } from "wouter"

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetExecutiveSummary({
    query: { enabled: true, queryKey: getGetExecutiveSummaryQueryKey() }
  })
  
  const { data: activities, isLoading: loadingActivities } = useGetRecentActivity({ limit: 5 }, {
    query: { enabled: true, queryKey: getGetRecentActivityQueryKey({ limit: 5 }) }
  })
  
  const { data: insights, isLoading: loadingInsights } = useGetAiInsights({}, {
    query: { enabled: true, queryKey: getGetAiInsightsQueryKey({}) }
  })

  if (loadingSummary || loadingActivities || loadingInsights) {
    return <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    </div>
  }

  const kpis = [
    { title: "Total Revenue", value: `₹${summary?.totalRevenue?.toLocaleString('en-IN')}`, icon: TrendingUp, trend: "+12.5%" },
    { title: "Active Orders", value: summary?.pendingOrders?.toString(), icon: ShoppingCart, trend: "+3.2%" },
    { title: "Total Employees", value: summary?.totalEmployees?.toString(), icon: Users, trend: "+0.0%" },
    { title: "Pending Payables", value: `₹${summary?.pendingPayables?.toLocaleString('en-IN')}`, icon: AlertTriangle, trend: "-2.1%" },
  ]

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Executive Dashboard</h1>
          <p className="text-muted-foreground mt-1">Cross-portfolio performance and insights</p>
        </div>
      </div>

      {/* Quick platform access */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider mr-1">Quick Open:</span>
        {[
          { label: "Shopdeck", url: "https://app.shopdeck.com/dashboard", bg: "bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 text-orange-400" },
          { label: "Shopify", url: "https://admin.shopify.com", bg: "bg-green-500/10 hover:bg-green-500/20 border-green-500/30 text-green-400" },
          { label: "Facebook", url: "https://business.facebook.com", bg: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400" },
          { label: "Instagram", url: "https://www.instagram.com", bg: "bg-pink-500/10 hover:bg-pink-500/20 border-pink-500/30 text-pink-400" },
          { label: "MCA Portal", url: "https://efiling.mca.gov.in", bg: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400" },
        ].map(p => (
          <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all hover:scale-105 active:scale-95 ${p.bg}`}>
            {p.label}
            <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
        ))}
        <Link href="/integrations">
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-muted-foreground/30 text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-colors cursor-pointer">
            All platforms →
          </span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="bg-card/50 backdrop-blur-sm border-muted/50 hover:bg-card/80 transition-colors">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value || "0"}</div>
              <p className="text-xs text-muted-foreground flex items-center mt-1">
                {kpi.trend.startsWith('+') ? 
                  <ArrowUpRight className="h-3 w-3 text-success mr-1" /> : 
                  <ArrowDownRight className="h-3 w-3 text-destructive mr-1" />
                }
                <span className={kpi.trend.startsWith('+') ? "text-success" : "text-destructive"}>
                  {kpi.trend}
                </span>
                <span className="ml-1 opacity-70">vs last month</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Portfolio Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio Overview</CardTitle>
            <CardDescription>Revenue contribution by subsidiary</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary?.companySummaries?.map(company => (
                <div key={company.companyId} className="flex items-center justify-between p-3 rounded-lg border bg-card/50 hover:bg-accent/50 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {company.companyName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium group-hover:text-primary transition-colors">{company.companyName}</div>
                      <div className="text-xs text-muted-foreground">{company.employees} Employees</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">₹{company.revenue.toLocaleString('en-IN')}</div>
                    <div className="text-xs text-success">+{company.growth}%</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* AI Insights & Activity */}
        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-primary flex items-center gap-2">
                <Activity className="h-5 w-5" />
                AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {insights?.slice(0,3).map(insight => (
                  <div key={insight.id} className="p-3 rounded-md bg-background border border-primary/10">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-medium">{insight.title}</span>
                      <Badge variant={insight.severity === 'critical' ? 'destructive' : insight.severity === 'warning' ? 'warning' : 'outline'} className="text-[10px] uppercase h-5">
                        {insight.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{insight.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                {activities?.map((activity, i) => (
                  <div key={activity.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full border border-background bg-primary/20 text-primary group-[.is-active]:bg-primary group-[.is-active]:text-primary-foreground shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
                    </div>
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 rounded border bg-card/50 shadow-sm ml-4 md:ml-0 text-sm">
                      <div className="font-medium text-foreground">{activity.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{activity.description}</div>
                      <div className="text-[10px] text-muted-foreground mt-2 opacity-60">
                        {new Date(activity.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • {activity.companyName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
