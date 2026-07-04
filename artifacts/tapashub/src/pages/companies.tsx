import { useListCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Link } from "wouter"
import { Building2, Users, IndianRupee, Activity, ExternalLink } from "lucide-react"

export default function Companies() {
  const { data: companies, isLoading } = useListCompanies({
    query: { enabled: true, queryKey: getListCompaniesQueryKey() }
  })

  if (isLoading) {
    return <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    </div>
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Companies</h1>
          <p className="text-muted-foreground mt-1">Manage subsidiary businesses and investments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {companies?.map(company => (
          <div key={company.id} className="block group">
            <Card className="h-full bg-card/50 hover:bg-accent/30 hover:border-primary/50 transition-all duration-300">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xl">
                    {company.logoUrl ? <img src={company.logoUrl} alt={company.name} className="w-full h-full object-cover rounded-lg" /> : company.name.charAt(0)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={company.status === 'active' ? 'success' : 'outline'} className="uppercase text-[10px]">
                      {company.status}
                    </Badge>
                    <a
                      href={`https://www.${company.slug}.com`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-muted-foreground hover:text-primary transition-colors"
                      title={`Visit ${company.name} website`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
                <Link href={`/companies/${company.id}`}>
                  <CardTitle className="mt-4 text-xl group-hover:text-primary transition-colors cursor-pointer">{company.name}</CardTitle>
                </Link>
                <CardDescription>{company.industry || 'General Business'} • {company.ownershipPercent}% Ownership</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3"/> Team</span>
                    <p className="font-medium">{company.employeeCount || 0}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><IndianRupee className="w-3 h-3"/> Revenue</span>
                    <p className="font-medium">₹{(company.totalRevenue || 0).toLocaleString('en-IN')}</p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t">
                  <a
                    href={`https://www.${company.slug}.com`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    www.{company.slug}.com
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
