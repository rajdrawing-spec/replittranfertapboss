import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { adminApi, type AuditLogEntry } from "@/lib/admin-api"

function actionVariant(action: string): "default" | "secondary" | "destructive" {
  if (action.includes("removed") || action.includes("disabled") || action.includes("deleted") || action.includes("revoked")) return "destructive"
  if (action.includes("login") || action.includes("joined")) return "secondary"
  return "default"
}

export default function AuditLogsPage() {
  const { data: logs = [], isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/audit-logs"],
    queryFn: () => adminApi.get("/audit-logs"),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground">A record of security-relevant actions across the workspace.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{l.userEmail ?? "system"}</TableCell>
                  <TableCell><Badge variant={actionVariant(l.action)}>{l.action}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.description}</TableCell>
                </TableRow>
              ))}
              {!isLoading && logs.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No audit entries yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
