import { useState } from "react"
import { useListProducts, getListProductsQueryKey } from "@workspace/api-client-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Package, Search, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export default function Inventory() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")

  const { data, isLoading } = useListProducts({ page, limit: 20, search }, {
    query: { enabled: true, queryKey: getListProductsQueryKey({ page, limit: 20, search }) }
  })

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
          <p className="text-muted-foreground mt-1">Product catalog and stock levels</p>
        </div>
      </div>

      <Card className="bg-card/50 border-muted">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search products by name or SKU..." 
              className="pl-9 bg-background/50 border-border/50 max-w-md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : data?.items?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <Package className="mx-auto h-8 w-8 opacity-20 mb-2" />
                    No products found
                  </TableCell>
                </TableRow>
              ) : (
                data?.items?.map((product) => {
                  const isLowStock = product.stockQuantity <= product.reorderLevel;
                  const isOutOfStock = product.stockQuantity === 0;
                  
                  return (
                    <TableRow key={product.id} className="cursor-pointer hover:bg-muted/30">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {isOutOfStock ? (
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          ) : isLowStock ? (
                            <AlertCircle className="w-4 h-4 text-warning" />
                          ) : null}
                          {product.name}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{product.sku}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal bg-background">{product.companyName}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.category}</TableCell>
                      <TableCell className="text-right font-medium">₹{product.price.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          "font-bold",
                          isOutOfStock ? "text-destructive" : isLowStock ? "text-warning" : ""
                        )}>
                          {product.stockQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.status === 'active' ? 'success' : 'secondary'} className="capitalize text-[10px]">
                          {product.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  )
}
