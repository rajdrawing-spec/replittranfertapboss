import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckSquare, ListTodo, Users, Settings, Activity, ClipboardList } from "lucide-react"
import { useCompany } from "@/contexts/company-context"
import { useAuth } from "@/contexts/auth-context"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/empty-state"
import { TemplateManager } from "@/components/ai-tasks/template-manager"
import { EmployeeDashboard } from "@/components/ai-tasks/employee-dashboard"
import { ManagerApproval } from "@/components/ai-tasks/manager-approval"
import { GenerationJobs } from "@/components/ai-tasks/generation-jobs"
import { EmployeeProfiles } from "@/components/ai-tasks/employee-profiles"
import { AiTasksSettings } from "@/components/ai-tasks/settings"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "")

interface EmployeeProfile {
  id: number
  firstName: string
  lastName: string
  email: string
  department: string
  designation: string
}

export default function AiTasksPage() {
  const { activeCompany } = useCompany()
  const { hasPermission } = useAuth()
  const companyId = activeCompany?.id

  const canManage = hasPermission("ai_tasks.manage")
  const canRead = hasPermission("ai_tasks.read")

  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<number | null>(null)

  const { data: employees } = useQuery<EmployeeProfile[]>({
    queryKey: ["/api/ai-tasks/employees", companyId],
    queryFn: async () => {
      const res = await fetch(`${basePath}/api/ai-tasks/employees?companyId=${companyId}`, {
        credentials: "include",
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
    enabled: !!companyId && canRead,
  })

  React.useEffect(() => {
    if (employees && employees.length > 0 && selectedEmployeeId === null) {
      setSelectedEmployeeId(employees[0].id)
    }
  }, [employees, selectedEmployeeId])

  if (!canRead) {
    return (
      <div className="p-6">
        <EmptyState
          icon={CheckSquare}
          message="Access restricted"
          hint="You do not have permission to view AI Tasks."
        />
      </div>
    )
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <EmptyState icon={CheckSquare} message="No company selected" hint="Select a company to view AI Tasks." />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Tasks</h1>
        <p className="text-muted-foreground">
          AI-powered daily task generation and approval workflow.
        </p>
      </div>

      <Tabs defaultValue="templates" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="templates"><ListTodo className="mr-2 h-4 w-4" /> Templates</TabsTrigger>
          <TabsTrigger value="my-tasks"><ClipboardList className="mr-2 h-4 w-4" /> My Tasks</TabsTrigger>
          {canManage && (
            <>
              <TabsTrigger value="approval"><CheckSquare className="mr-2 h-4 w-4" /> Pending Approval</TabsTrigger>
              <TabsTrigger value="jobs"><Activity className="mr-2 h-4 w-4" /> Jobs</TabsTrigger>
              <TabsTrigger value="team"><Users className="mr-2 h-4 w-4" /> Team</TabsTrigger>
              <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4" /> Settings</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="templates" className="pt-4">
          <TemplateManager companyId={companyId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="my-tasks" className="pt-4">
          <div className="mb-4 max-w-sm">
            <Label htmlFor="employee">Viewing employee</Label>
            <Select
              value={selectedEmployeeId?.toString() ?? ""}
              onValueChange={(v) => setSelectedEmployeeId(parseInt(v))}
            >
              <SelectTrigger id="employee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {employees?.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id.toString()}>
                    {emp.firstName} {emp.lastName} · {emp.department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedEmployeeId ? (
            <EmployeeDashboard companyId={companyId} employeeId={selectedEmployeeId} />
          ) : (
            <EmptyState icon={ClipboardList} message="No employee selected" hint="Select an employee to view their dashboard." />
          )}
        </TabsContent>

        {canManage && (
          <>
            <TabsContent value="approval" className="pt-4">
              <ManagerApproval companyId={companyId} />
            </TabsContent>
            <TabsContent value="jobs" className="pt-4">
              <GenerationJobs companyId={companyId} />
            </TabsContent>
            <TabsContent value="team" className="pt-4">
              <EmployeeProfiles companyId={companyId} />
            </TabsContent>
            <TabsContent value="settings" className="pt-4">
              <AiTasksSettings />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
