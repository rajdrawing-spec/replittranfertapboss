/**
 * AiTaskRealtimeContext — global socket listener for AI task events.
 *
 * Connects to the same chat socket and joins the company room so team members
 * get instant toasts and query invalidation when AI tasks are created or
 * updated from meeting notes, scheduler runs, or manager approvals.
 */
import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/contexts/company-context";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";

interface AiTaskEvent {
  taskId: number;
  employeeId: number;
  title: string;
  status: string;
  confidence?: string;
  meetingId?: string;
}

const AiTaskRealtimeContext = React.createContext<null>(null);

export function AiTaskRealtimeProvider({ children }: { children: React.ReactNode }) {
  const { activeCompany } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id;

  React.useEffect(() => {
    if (!user?.id || !companyId) return;

    const s: Socket = io({
      path: "/api/socket.io",
      auth: (cb: (data: object) => void) => {
        fetch("/api/chat/token", { credentials: "include" })
          .then((r) => r.json())
          .then(({ token }) => cb({ token }))
          .catch(() => cb({}));
      },
      reconnection: true,
      reconnectionDelay: 3_000,
      reconnectionDelayMax: 60_000,
    });

    s.on("connect", () => {
      s.emit("join", { companyId }, (res: any) => {
        if (!res?.ok) {
          console.debug("[ai-task-realtime] join failed:", res?.error);
        }
      });
    });

    s.on("ai_task:new", (task: AiTaskEvent) => {
      toast({
        title: "New AI task",
        description: task.title.length > 80 ? task.title.slice(0, 77) + "…" : task.title,
        duration: 5_000,
      });
      invalidateTaskQueries(queryClient, companyId);
    });

    s.on("ai_task:updated", (task: AiTaskEvent) => {
      invalidateTaskQueries(queryClient, companyId);
    });

    s.on("connect_error", (err) => {
      console.debug("[ai-task-realtime] connect error:", err.message);
    });

    return () => {
      s.disconnect();
    };
  }, [user?.id, companyId, toast, queryClient]);

  return <AiTaskRealtimeContext.Provider value={null}>{children}</AiTaskRealtimeContext.Provider>;
}

function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>, companyId: number) {
  queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/my-tasks", companyId] });
  queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/pending-approval", companyId] });
  queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/employees", companyId] });
  queryClient.invalidateQueries({ queryKey: ["/api/ai-tasks/notifications/unread-count", companyId] });
  queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
}

