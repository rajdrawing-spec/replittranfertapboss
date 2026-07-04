import * as React from "react"
import { Link, useLocation } from "wouter"
import { 
  BarChart3, 
  Building2, 
  PackageSearch, 
  ShoppingCart, 
  Wallet, 
  Users, 
  UsersRound,
  CheckSquare,
  Bell,
  Bot,
  Settings,
  Menu,
  Moon,
  Sun
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useGetMe, useListNotifications } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"

const navigation = [
  { name: "Dashboard", href: "/", icon: BarChart3 },
  { name: "Companies", href: "/companies", icon: Building2 },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Inventory", href: "/inventory", icon: PackageSearch },
  { name: "Finance", href: "/finance", icon: Wallet },
  { name: "HR", href: "/hr", icon: Users },
  { name: "CRM", href: "/crm", icon: UsersRound },
  { name: "Approvals", href: "/approvals", icon: CheckSquare },
  { name: "AI Assistant", href: "/ai-assistant", icon: Bot },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = React.useState(true)

  const { data: me } = useGetMe({ query: { enabled: true, queryKey: ["/api/users/me"] } })
  const { data: notificationsData } = useListNotifications({ unreadOnly: true }, {
    query: { enabled: true, queryKey: ["/api/notifications", { unreadOnly: true }] }
  })

  const unreadCount = notificationsData?.length || 0

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-card border-r flex-shrink-0 flex-col transition-all duration-300 md:flex",
          sidebarOpen ? "w-64" : "w-0 md:w-20 overflow-hidden"
        )}
      >
        <div className="h-16 flex items-center px-4 border-b">
          <img src="/tapashub-logo.png" alt="TapasHub" className="w-9 h-9 object-contain shrink-0 invert dark:invert-0" />
          <span className={cn("ml-3 font-bold text-lg whitespace-nowrap overflow-hidden transition-all", !sidebarOpen && "md:w-0 opacity-0")}>
            TBOS
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
            return (
              <Link key={item.name} href={item.href} className="block">
                <span
                  className={cn(
                    "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group",
                    isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title={!sidebarOpen ? item.name : undefined}
                >
                  <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className={cn("ml-3 whitespace-nowrap overflow-hidden transition-all", !sidebarOpen && "md:w-0 opacity-0")}>
                    {item.name}
                  </span>
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t space-y-2">
          <Link href="/settings" className="block">
            <span className={cn(
              "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors group",
              location.startsWith("/settings") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}>
              <Settings className="w-5 h-5 shrink-0" />
              <span className={cn("ml-3 whitespace-nowrap overflow-hidden transition-all", !sidebarOpen && "md:w-0 opacity-0")}>
                Settings
              </span>
            </span>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 flex items-center justify-between px-4 border-b bg-card/80 backdrop-blur-sm z-10 shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu className="w-5 h-5" />
            </Button>
            <div className="font-semibold text-lg hidden sm:block flex items-center gap-2">
              <img src="/tapashub-logo.png" alt="TapasHub" className="w-7 h-7 object-contain invert dark:invert-0 sm:hidden md:block" />
              TapasHub Operating System
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </Button>
            
            <Link href="/notifications" className="block">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
                )}
              </Button>
            </Link>

            <div className="flex items-center gap-2 border-l pl-4 ml-2">
              <Avatar className="w-8 h-8">
                <AvatarFallback>{me?.name?.substring(0, 2) || "U"}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:block text-sm">
                <div className="font-medium leading-none">{me?.name || "User"}</div>
                <div className="text-xs text-muted-foreground">{me?.role || "Loading..."}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-background p-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
