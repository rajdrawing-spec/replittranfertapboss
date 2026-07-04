import { useState } from "react"
import { useGetPnlSummary, getGetPnlSummaryQueryKey, useListTransactions, getListTransactionsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { DollarSign, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react"
import { cn } from "@/lib/utils"

export default function Finance() {
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month")
  
  const { data: pnl, isLoading: pnlLoading } = useGetPnlSummary({ period }, {
    query: { enabled: true, queryKey: getGetPnlSummaryQueryKey({ period }) }
  })

  const { data: transactions, isLoading: txLoading } = useListTransactions({ limit: 10 }, {
    query: { enabled: true, queryKey: getListTransactionsQueryKey({ limit: 10 }) }
  })

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Finance</h1>
          <p className="text-muted-foreground mt-1">Financial performance and cash flow</p>
        </div>
        <div className="flex bg-muted p-1 rounded-lg">
          {(["month", "quarter", "year"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-all",
                period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {pnlLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
        ) : (
          <>
            <Card className="bg-card/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${pnl?.revenue?.toLocaleString() || 0}</div>
                {pnl?.revenueGrowth && (
                  <p className="text-xs text-success flex items-center mt-1">
                    <ArrowUpRight className="w-3 h-3 mr-1" /> +{pnl.revenueGrowth}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gross Profit</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${pnl?.grossProfit?.toLocaleString() || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Margin: {pnl?.grossMargin || 0}%</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Operating Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${pnl?.operatingExpenses?.toLocaleString() || 0}</div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-primary">Net Profit</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">${pnl?.netProfit?.toLocaleString() || 0}</div>
                <p className="text-xs text-primary/80 mt-1">Margin: {pnl?.netMargin || 0}%</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : transactions?.items?.length === 0 ? (
                 <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <Activity className="mx-auto h-8 w-8 opacity-20 mb-2" />
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                transactions?.items?.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(tx.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium">{tx.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal bg-background">{tx.companyName}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tx.category}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === 'completed' ? 'success' : tx.status === 'pending' ? 'warning' : 'secondary'} className="capitalize text-[10px]">
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      tx.type === 'income' ? "text-success" : tx.type === 'expense' ? "text-destructive" : ""
                    )}>
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      ${Math.abs(tx.amount).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
