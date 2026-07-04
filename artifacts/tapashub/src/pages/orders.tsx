import { useState } from "react"
import { useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Filter, ShoppingBag } from "lucide-react"

export default function Orders() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string | null>(null)

  const { data, isLoading } = useListOrders({ page, limit: 20, search, status }, {
    query: { enabled: true, queryKey: getListOrdersQueryKey({ page, limit: 20, search, status }) }
  })

  const getStatusColor = (status: string) => {
    switch(status.toLowerCase()) {
      case 'delivered': return 'success'
      case 'processing': return 'info'
      case 'shipped': return 'primary'
      case 'cancelled': return 'destructive'
      case 'pending': return 'warning'
      default: return 'outline'
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Orders</h1>
          <p className="text-muted-foreground mt-1">Manage orders across all subsidiaries</p>
        </div>
      </div>

      <Card className="bg-card/50 border-muted">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search order number or customer..." 
                className="pl-9 bg-background/50 border-border/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? null : v)}>
                <SelectTrigger className="w-[180px] bg-background/50">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Order ID</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.items?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <ShoppingBag className="mx-auto h-8 w-8 opacity-20 mb-2" />
                    No orders found
                  </TableCell>
                </TableRow>
              ) : (
                data?.items?.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/30">
                    <TableCell className="font-mono text-xs">{order.orderNumber}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal bg-background">{order.companyName}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{order.customerName}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(order.status) as any} className="capitalize text-[10px]">
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground text-sm">{order.channel}</TableCell>
                    <TableCell className="text-right font-medium">₹{order.totalAmount.toLocaleString('en-IN')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
