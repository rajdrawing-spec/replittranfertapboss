import { db, generatedTasksTable, usersTable, type TaskTemplate } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getTaskGenerationProvider, getActiveProvider } from "../ai-provider";
import { getUserPermissions } from "../auth-user";
import { getAiTasksConfig } from "./config.service";
import { listEmployeesForGeneration, type EmployeeProfile } from "./employee-profile.service";
import { getActiveTemplatesForScope } from "./task-template.service";
import {
  startJob,
  completeJob,
  failJob,
  hasRunForDate,
  countRegenerationsToday,
} from "./task-generation-job.service";
import {
  buildBatchPrompt,
  getSystemPrompt,
  parseGeneratedTasks,
  chunk,
  type GeneratedTaskOutput,
} from "./task-ai-prompt.builder";
import { logger } from "../logger";

const PROMPT_VERSION = "1.0";

export interface GenerateResult {
  jobId: number;
  status: "completed" | "failed" | "skipped";
  tasksGenerated: number;
  message?: string;
}

export async function generateDailyTasks(
  companyId: number,
  requesterId: number | undefined,
  triggeredBy: "scheduler" | "manager",
  force = false,
): Promise<GenerateResult> {
  const today = new Date().toISOString().slice(0, 10);
  const config = await getAiTasksConfig();

  if (!config.enabled) {
    return { jobId: 0, status: "skipped", tasksGenerated: 0, message: "AI Tasks is disabled" };
  }

  if (!force && triggeredBy === "scheduler" && (await hasRunForDate(companyId, today))) {
    return { jobId: 0, status: "skipped", tasksGenerated: 0, message: "Tasks already generated for today" };
  }

  if (triggeredBy === "manager") {
    const regenerations = await countRegenerationsToday(companyId, today);
    if (regenerations >= config.maxRegenerationsPerDay) {
      return { jobId: 0, status: "skipped", tasksGenerated: 0, message: "Daily regeneration limit reached" };
    }
  }

  const job = await startJob(companyId, today, requesterId, triggeredBy);
  const t0 = Date.now();
  let tasksGenerated = 0;
  let providerUsed: string | null = null;
  let tokensUsed: number | null = null;
  let batchSize = 0;
  let errorMessage: string | null = null;

  try {
    const employees = await listEmployeesForGeneration(companyId);
    if (employees.length === 0) {
      await completeJob(job.id, { tasksGenerated: 0, executionTimeMs: Date.now() - t0, batchSize: 0 });
      return { jobId: job.id, status: "completed", tasksGenerated: 0, message: "No active employees found" };
    }

    const provider = await resolveProvider(config.provider);
    providerUsed = provider?.name ?? "template-only";

    // Group employees by department; each department gets its own batch(es).
    const byDepartment = groupByDepartment(employees);
    const managerExists = await hasManagerInCompany(companyId);
    const autoApprove = config.autoApprove || !managerExists;

    for (const [department, deptEmployees] of Object.entries(byDepartment)) {
      const templates = await getActiveTemplatesForScope(companyId, department);
      if (templates.length === 0) continue;

      const employeeChunks = chunk(deptEmployees, config.batchSize);
      for (const empChunk of employeeChunks) {
        batchSize = Math.max(batchSize, empChunk.length);
        const outputs = await generateForBatch(empChunk, templates, provider, config.promptTemplate);
        const inserted = await insertGeneratedTasks(
          outputs,
          companyId,
          today,
          autoApprove,
          requesterId,
          templates,
        );
        tasksGenerated += inserted;
      }
    }

    await completeJob(job.id, {
      providerUsed,
      tokensUsed,
      promptVersion: PROMPT_VERSION,
      executionTimeMs: Date.now() - t0,
      batchSize,
      tasksGenerated,
    });

    return { jobId: job.id, status: "completed", tasksGenerated };
  } catch (e) {
    errorMessage = (e as Error).message;
    logger.error({ err: e, companyId, jobId: job.id }, "AI task generation failed");
    await failJob(job.id, errorMessage);
    return { jobId: job.id, status: "failed", tasksGenerated, message: errorMessage };
  }
}

async function resolveProvider(
  preferred: "auto" | "ollama" | "gemini",
): Promise<{ name: string; chat: (messages: any[], systemPrompt?: string) => Promise<string> } | null> {
  if (preferred === "ollama") {
    const provider = await getTaskGenerationProvider();
    return provider?.name === "ollama" ? provider : null;
  }
  if (preferred === "gemini") {
    return getActiveProvider();
  }
  return getTaskGenerationProvider();
}

async function generateForBatch(
  employees: EmployeeProfile[],
  templates: TaskTemplate[],
  provider: Awaited<ReturnType<typeof resolveProvider>>,
  customPromptTemplate: string | null,
): Promise<GeneratedTaskOutput[]> {
  // If no provider is available, fall back to template-only generation (no AI customization).
  if (!provider) {
    const outputs: GeneratedTaskOutput[] = [];
    for (const emp of employees) {
      for (const t of templates) {
        outputs.push({
          employeeId: emp.id,
          templateId: t.id,
          title: t.titleTemplate,
          description: t.descriptionTemplate,
          priority: t.priority as "low" | "medium" | "high",
          estimatedMinutes: t.estimatedMinutes,
          aiCustomizations: { templateOnly: true },
        });
      }
    }
    return outputs;
  }

  const prompt = buildBatchPrompt(employees, templates, customPromptTemplate);
  const response = await provider.chat([{ role: "user", content: prompt }], getSystemPrompt());
  return parseGeneratedTasks(response);
}

async function insertGeneratedTasks(
  outputs: GeneratedTaskOutput[],
  companyId: number,
  runDate: string,
  autoApprove: boolean,
  approverId: number | undefined,
  templates: TaskTemplate[],
): Promise<number> {
  if (outputs.length === 0) return 0;

  // Deduplicate: skip if a generated task already exists for this employee + template + date.
  const existingRows = await db
    .select({ employeeId: generatedTasksTable.employeeId, templateId: generatedTasksTable.templateId })
    .from(generatedTasksTable)
    .where(
      and(
        eq(generatedTasksTable.companyId, companyId),
        eq(generatedTasksTable.generatedDate, runDate),
        inArray(
          generatedTasksTable.employeeId,
          outputs.map((o) => o.employeeId),
        ),
      ),
    );
  const existingKey = new Set(existingRows.map((r) => `${r.employeeId}-${r.templateId ?? "null"}`));

  const templateMap = new Map(templates.map((t) => [t.id, t]));
  const values = outputs
    .filter((o) => !existingKey.has(`${o.employeeId}-${o.templateId ?? "null"}`))
    .map((o) => {
      const template = o.templateId ? templateMap.get(o.templateId) : undefined;
      return {
        companyId,
        employeeId: o.employeeId,
        templateId: o.templateId,
        generatedDate: runDate,
        title: o.title,
        description: o.description,
        priority: o.priority,
        estimatedMinutes: o.estimatedMinutes,
        source: providerSource(o.aiCustomizations),
        aiCustomizations: o.aiCustomizations,
        status: autoApprove ? "approved" : "draft",
        approvedBy: autoApprove ? approverId : null,
        approvedAt: autoApprove ? new Date() : null,
        dueDate: offsetDate(runDate, 1),
      };
    });

  if (values.length === 0) return 0;
  await db.insert(generatedTasksTable).values(values);
  return values.length;
}

function groupByDepartment(employees: EmployeeProfile[]): Record<string, EmployeeProfile[]> {
  return employees.reduce((acc, emp) => {
    const key = emp.department || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(emp);
    return acc;
  }, {} as Record<string, EmployeeProfile[]>);
}

async function hasManagerInCompany(companyId: number): Promise<boolean> {
  // A manager is any user with ai_tasks.manage permission in this company.
  const users = await db.select().from(usersTable);
  const companyUsers = users.filter((u) => (u.companyIds as number[]).includes(companyId));
  for (const u of companyUsers) {
    const perms = await getUserPermissions(u);
    if (perms.includes("*") || perms.includes("ai_tasks.manage")) return true;
  }
  return false;
}

function providerSource(customizations: Record<string, unknown>): string {
  return (customizations as { templateOnly?: boolean }).templateOnly ? "template" : "ai_customized";
}

function offsetDate(runDate: string, days: number): string {
  const d = new Date(runDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
