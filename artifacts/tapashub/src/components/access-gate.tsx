import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { ShieldAlert, Send, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { adminApi } from "@/lib/admin-api"
import { useToast } from "@/hooks/use-toast"

/**
 * Shown in place of a page when the user's role lacks the required permission.
 * Lets them send an access request to the Super Admin instead of a dead end.
 */
export function RequestAccessGate({ module, description }: { module: string; description?: string }) {
  const { toast } = useToast()
  const [sent, setSent] = React.useState(false)

  const request = useMutation({
    mutationFn: () => adminApi.post("/access-requests", { module }),
    onSuccess: () => {
      setSent(true)
      toast({ title: "Request sent", description: "The Super Admin has been notified." })
    },
    onError: () => toast({ title: "Could not send request", variant: "destructive" }),
  })

  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <ShieldAlert className="w-10 h-10 text-amber-400" />
      <h2 className="text-lg font-semibold">You don't have access to {module}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {description ?? `Your role doesn't include permission for this section. You can request approval from the Super Admin.`}
      </p>
      {sent ? (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="w-4 h-4" /> Request sent — you'll get access once approved.
        </div>
      ) : (
        <Button size="sm" className="gap-2" onClick={() => request.mutate()} disabled={request.isPending}>
          <Send className="w-4 h-4" />
          {request.isPending ? "Sending…" : "Request approval from Super Admin"}
        </Button>
      )}
    </div>
  )
}
