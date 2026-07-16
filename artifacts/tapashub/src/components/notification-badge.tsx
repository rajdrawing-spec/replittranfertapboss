import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface Notification {
  id: number
  type: string
  title: string
  message: string
  severity: string
  isRead: boolean
  createdAt: string
  actionUrl?: string
}

export function NotificationBadge() {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)

  const { data: unreadCount } = useQuery<number>({
    queryKey: ["/api/notifications/unread-count"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/notifications/unread-count`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    refetchInterval: 30_000,
  })

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications/recent"],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/notifications?limit=10`, { credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: open,
  })

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${basePath}/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] })
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] })
    },
  })

  const markAll = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${basePath}/api/notifications/mark-all-read`, { method: "PATCH", credentials: "include" })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] })
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] })
    },
  })

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {(unreadCount ?? 0) > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center" variant="destructive">
              {unreadCount! > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[60vh] overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {(unreadCount ?? 0) > 0 && (
            <button className="text-xs text-primary" onClick={() => markAll.mutate()} disabled={markAll.isPending}>Mark all read</button>
          )}
        </div>
        {notifications?.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">No notifications</div>
        ) : (
          notifications?.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={cn("flex flex-col items-start px-3 py-2 cursor-pointer", !n.isRead && "bg-muted/50")}
              onClick={() => { if (!n.isRead) markRead.mutate(n.id) }}
            >
              <span className="text-sm font-medium">{n.title}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">{n.message}</span>
              <span className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
