import * as React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell, MessageSquare, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")
const BRAND_BLUE = "#2DA8FF"

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

function timeAgo(date: string) {
  const d = Date.now() - new Date(date).getTime()
  if (d < 60_000) return "just now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return new Date(date).toLocaleDateString()
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

  const count = unreadCount ?? 0

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-xl"
          aria-label="Notifications"
        >
          <Bell className={cn("h-5 w-5 transition-all", count > 0 && "animate-[ring_0.5s_ease-in-out]")} />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1"
              style={{ background: BRAND_BLUE }}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[340px] p-0 overflow-hidden rounded-2xl shadow-2xl border"
        sideOffset={8}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" style={{ color: BRAND_BLUE }} />
            <span className="font-semibold text-sm">Notifications</span>
            {count > 0 && (
              <span
                className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full"
                style={{ background: BRAND_BLUE }}
              >
                {count}
              </span>
            )}
          </div>
          {count > 0 && (
            <button
              className="text-xs font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: BRAND_BLUE }}
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[400px] overflow-y-auto">
          {!notifications || notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-10">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: `${BRAND_BLUE}18` }}
              >
                <Bell className="h-6 w-6" style={{ color: BRAND_BLUE }} />
              </div>
              <p className="text-sm text-muted-foreground">You're all caught up!</p>
            </div>
          ) : (
            notifications.map((n, i) => (
              <button
                key={n.id}
                className={cn(
                  "w-full flex items-start gap-3 px-4 py-3 text-left transition-all hover:bg-muted/50",
                  !n.isRead && "bg-muted/30",
                  i > 0 && "border-t border-border/50"
                )}
                onClick={() => { if (!n.isRead) markRead.mutate(n.id) }}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `${BRAND_BLUE}18` }}
                >
                  <MessageSquare className="h-4 w-4" style={{ color: BRAND_BLUE }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className={cn("text-sm font-medium truncate", !n.isRead && "font-semibold")}>{n.title}</span>
                    {!n.isRead && (
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_BLUE }} />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                  <span className="text-[10px] text-muted-foreground mt-1 block">{timeAgo(n.createdAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
