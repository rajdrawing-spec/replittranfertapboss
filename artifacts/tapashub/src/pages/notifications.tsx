import { useListNotifications, getListNotificationsQueryKey, useMarkAllNotificationsRead } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Bell, CheckCheck, Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"

export default function Notifications() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useListNotifications({}, {
    query: { enabled: true, queryKey: getListNotificationsQueryKey({}) }
  })
  
  const markAllRead = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] })
      }
    }
  })

  const getIcon = (severity?: string) => {
    switch(severity) {
      case 'error': return <XCircle className="w-5 h-5 text-destructive" />
      case 'warning': return <AlertTriangle className="w-5 h-5 text-warning" />
      case 'success': return <CheckCircle2 className="w-5 h-5 text-success" />
      default: return <Info className="w-5 h-5 text-info" />
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex justify-between items-end border-b pb-4 border-muted">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Bell className="w-8 h-8 text-primary" />
            Notifications
          </h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate({ data: {} })} disabled={markAllRead.isPending}>
          <CheckCheck className="w-4 h-4 mr-2" /> Mark all read
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-card/50">
              <CardContent className="p-4 flex gap-4">
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                <div className="space-y-2 w-full">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : data?.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Bell className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg">No notifications</p>
          </div>
        ) : (
          data?.map((notification) => (
            <Card key={notification.id} className={cn("transition-colors overflow-hidden border-l-4", 
              !notification.isRead ? "bg-card border-l-primary" : "bg-card/30 border-l-transparent",
              notification.severity === 'error' && "border-l-destructive",
              notification.severity === 'warning' && "border-l-warning"
            )}>
              <CardContent className="p-4 flex gap-4">
                <div className="shrink-0 mt-1">
                  {getIcon(notification.severity)}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between items-start">
                    <h4 className={cn("text-base font-semibold", !notification.isRead && "text-foreground")}>
                      {notification.title}
                    </h4>
                    <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                      {new Date(notification.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{notification.message}</p>
                  
                  <div className="flex items-center gap-2 pt-2">
                    <Badge variant="outline" className="text-[10px] uppercase bg-background">{notification.type}</Badge>
                    {notification.companyName && (
                      <span className="text-xs text-muted-foreground">• {notification.companyName}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
