import { useParams, Link } from "wouter"
import { useGetCompany, getGetCompanyQueryKey, useGetCompanySummary, getGetCompanySummaryQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Users, DollarSign, Activity, PackageSearch, FileText } from "lucide-react"

export default function CompanyDetail() {
  const params = useParams()
  const companyId = params.id ? parseInt(params.id) : 0

  const { data: company, isLoading: loadingCompany } = useGetCompany(companyId, {
    query: { enabled: !!companyId, queryKey: getGetCompanyQueryKey(companyId) }
  })

  const { data: summary, isLoading: loadingSummary } = useGetCompanySummary(companyId, {
    query: { enabled: !!companyId, queryKey: getGetCompanySummaryQueryKey(companyId) }
  })

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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground" asChild>
          <Link href="/companies"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Companies</Link>
        </Button>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-2xl shadow-sm">
              {company.logoUrl ? <img src={company.logoUrl} alt={company.name} className="w-full h-full object-cover rounded-xl" /> : company.name.charAt(0)}
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
            <div className="text-2xl font-bold">₹{summary?.revenue?.toLocaleString('en-IN') || 0}</div>
            <p className="text-xs text-success mt-1">+{summary?.growth || 0}% from last period</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.orders?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.employees?.toLocaleString() || 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{summary?.profit?.toLocaleString('en-IN') || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Company Details</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>Activity feed coming soon</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Inventory Health</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <PackageSearch className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>Inventory data coming soon</p>
                </div>
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
