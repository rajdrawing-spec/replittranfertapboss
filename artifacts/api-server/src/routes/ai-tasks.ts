import { Router } from "express";
import { requirePermission } from "../middleware/authz";
import { canAccessCompany } from "../lib/company-scope";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../lib/ai-tasks/task-template.service";
import { isAiTasksEnabled } from "../lib/ai-tasks/config.service";
import { insertTaskTemplateSchema, updateTaskTemplateSchema } from "@workspace/db";
import { generateDailyTasks } from "../lib/ai-tasks/ai-task.service";
import {
  approveTask,
  rejectTask,
  completeTask,
  approveAll,
  rejectAll,
  regenerateTasks,
  getTaskStats,
} from "../lib/ai-tasks/task-approval.service";
import { listEmployeesForGeneration, updateEmployeeProfile } from "../lib/ai-tasks/employee-profile.service";
import { listJobs } from "../lib/ai-tasks/task-generation-job.service";
import { getAiTasksConfig, setAiTasksConfig } from "../lib/ai-tasks/config.service";
import {
  getCompanySettings,
  updateCompanySettings,
  listHolidays,
  createHoliday,
  deleteHoliday,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from "../lib/ai-tasks/ai-task-settings.service";
import { getAnalytics, getHistoricalTrend } from "../lib/ai-tasks/analytics.service";
import {
  getActivePrompt,
  listPrompts,
  createPromptVersion,
  setActivePrompt,
} from "../lib/ai-tasks/prompts.service";
import { getUnreadAiTasksCount } from "../lib/ai-tasks/notification.service";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, generatedTasksTable } from "@workspace/db";

const router = Router();

// Feature flag / config gate: disabled modules return 404.
router.use(async (req, res, next) => {
  try {
    if (!(await isAiTasksEnabled())) {
      res.status(404).json({ error: "AI Tasks module is disabled" });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
});

const templateSchema = insertTaskTemplateSchema;
const templateUpdateSchema = updateTaskTemplateSchema;

function getLocalUserId(req: any): number | undefined {
  return req.localUser?.id as number | undefined;
}

// ── Templates ────────────────────────────────────────────────────────────────

router.get("/ai-tasks/templates", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await listTemplates({
      companyId,
      department: (req.query.department as string) || undefined,
      roleKey: (req.query.roleKey as string) || undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
      search: (req.query.search as string) || undefined,
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    });
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

router.get("/ai-tasks/templates/:id", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.query.companyId as string, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const template = await getTemplate(id, companyId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to get template" });
  }
});

router.post("/ai-tasks/templates", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    if (!canAccessCompany(req, parsed.data.companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const template = await createTemplate(parsed.data);
    res.status(201).json(template);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.patch("/ai-tasks/templates/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const companyId = parseInt((req.body.companyId ?? req.query.companyId) as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const template = await updateTemplate(id, companyId, parsed.data);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/ai-tasks/templates/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.query.companyId as string, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const template = await deleteTemplate(id, companyId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ── Generation ───────────────────────────────────────────────────────────────

router.post("/ai-tasks/generate", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await generateDailyTasks(companyId, getLocalUserId(req), "manager", false);
    res.status(result.status === "failed" ? 500 : 200).json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to generate tasks" });
  }
});

router.post("/ai-tasks/regenerate", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await regenerateTasks(companyId, getLocalUserId(req) ?? 0);
    res.status(result.status === "failed" ? 500 : 200).json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to regenerate tasks" });
  }
});

router.get("/ai-tasks/jobs", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const jobs = await listJobs(companyId, 20);
    res.json(jobs);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

// ── Manager approval workflow ──────────────────────────────────────────────────

router.get("/ai-tasks/pending-approval", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const runDate = (req.query.runDate as string) || new Date().toISOString().slice(0, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const tasks = await db
      .select()
      .from(generatedTasksTable)
      .where(
        and(
          eq(generatedTasksTable.companyId, companyId),
          eq(generatedTasksTable.generatedDate, runDate),
          eq(generatedTasksTable.status, "draft"),
        ),
      )
      .orderBy(desc(generatedTasksTable.priority), desc(generatedTasksTable.createdAt));
    res.json(tasks);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list pending tasks" });
  }
});

router.post("/ai-tasks/approve-all", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    const runDate = (req.body.runDate as string) || new Date().toISOString().slice(0, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await approveAll(companyId, runDate, getLocalUserId(req) ?? 0);
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to approve tasks" });
  }
});

router.post("/ai-tasks/reject-all", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    const runDate = (req.body.runDate as string) || new Date().toISOString().slice(0, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await rejectAll(companyId, runDate);
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to reject tasks" });
  }
});

router.patch("/ai-tasks/:id/approve", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await approveTask(id, companyId, getLocalUserId(req) ?? 0);
    if (!result.ok) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to approve task" });
  }
});

router.patch("/ai-tasks/:id/reject", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await rejectTask(id, companyId);
    if (!result.ok) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to reject task" });
  }
});

// ── Employee dashboard ─────────────────────────────────────────────────────────

router.get("/ai-tasks/my-tasks", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const runDate = (req.query.runDate as string) || new Date().toISOString().slice(0, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const employeeId = parseInt(req.query.employeeId as string);
    if (!employeeId) {
      res.status(400).json({ error: "employeeId is required" });
      return;
    }
    const tasks = await db
      .select()
      .from(generatedTasksTable)
      .where(
        and(
          eq(generatedTasksTable.companyId, companyId),
          eq(generatedTasksTable.employeeId, employeeId),
          eq(generatedTasksTable.generatedDate, runDate),
        ),
      )
      .orderBy(desc(generatedTasksTable.priority), desc(generatedTasksTable.createdAt));
    const stats = await getTaskStats(companyId, employeeId, runDate);
    res.json({ tasks, stats });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

router.patch("/ai-tasks/:id/complete", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    const employeeId = parseInt(req.body.employeeId as string);
    if (!companyId || !employeeId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const result = await completeTask(id, companyId, employeeId);
    if (!result.ok) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(result);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to complete task" });
  }
});

// ── Employee profiles (skill level, working hours, current project) ───────────

router.get("/ai-tasks/employees", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const employees = await listEmployeesForGeneration(companyId);
    res.json(employees);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list employees" });
  }
});

router.patch("/ai-tasks/employees/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const updated = await updateEmployeeProfile(id, companyId, {
      skillLevel: req.body.skillLevel,
      workingHours: req.body.workingHours,
      currentProject: req.body.currentProject,
    });
    if (!updated) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update employee profile" });
  }
});

// ── Module configuration ───────────────────────────────────────────────────────

router.get("/ai-tasks/config", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const config = await getAiTasksConfig();
    res.json(config);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load config" });
  }
});

router.patch("/ai-tasks/config", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    await setAiTasksConfig(req.body);
    const config = await getAiTasksConfig();
    res.json(config);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update config" });
  }
});

// ── Company settings (timezone, work week, holidays) ─────────────────────────

router.get("/ai-tasks/company-settings", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const settings = await getCompanySettings(companyId);
    const holidays = await listHolidays(companyId);
    res.json({ settings, holidays });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load company settings" });
  }
});

router.patch("/ai-tasks/company-settings", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const settings = await updateCompanySettings(companyId, {
      timezone: req.body.timezone,
      workWeek: req.body.workWeek,
      weekendGeneration: req.body.weekendGeneration,
      generationTime: req.body.generationTime,
    });
    res.json(settings);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update company settings" });
  }
});

router.post("/ai-tasks/holidays", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const holiday = await createHoliday(companyId, req.body);
    res.status(201).json(holiday);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create holiday" });
  }
});

router.delete("/ai-tasks/holidays/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const deleted = await deleteHoliday(companyId, parseInt(String(req.params.id), 10));
    if (!deleted) {
      res.status(404).json({ error: "Holiday not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete holiday" });
  }
});

// ── Project priorities ───────────────────────────────────────────────────────

router.get("/ai-tasks/projects", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const projects = await listProjects(companyId);
    res.json(projects);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list projects" });
  }
});

router.post("/ai-tasks/projects", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const project = await createProject(companyId, req.body);
    res.status(201).json(project);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.patch("/ai-tasks/projects/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.body.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const project = await updateProject(companyId, parseInt(String(req.params.id), 10), req.body);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/ai-tasks/projects/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const deleted = await deleteProject(companyId, parseInt(String(req.params.id), 10));
    if (!deleted) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// ── Prompt versioning ────────────────────────────────────────────────────────

router.get("/ai-tasks/prompts", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const prompts = await listPrompts("task_generation");
    res.json(prompts);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to list prompts" });
  }
});

router.get("/ai-tasks/prompts/active", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const content = await getActivePrompt("task_generation");
    res.json({ content });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load active prompt" });
  }
});

router.post("/ai-tasks/prompts", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const { version, content } = req.body;
    if (!version || !content) {
      res.status(400).json({ error: "version and content are required" });
      return;
    }
    const prompt = await createPromptVersion({ name: "task_generation", version, content });
    res.status(201).json(prompt);
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to create prompt version" });
  }
});

router.patch("/ai-tasks/prompts/:id/activate", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const result = await setActivePrompt(parseInt(String(req.params.id), 10));
    if (!result.ok) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to activate prompt" });
  }
});

// ── Analytics ──────────────────────────────────────────────────────────────────

router.get("/ai-tasks/analytics", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const runDate = (req.query.runDate as string) || new Date().toISOString().slice(0, 10);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const analytics = await getAnalytics(companyId, runDate);
    const trend = await getHistoricalTrend(companyId, 7);
    res.json({ analytics, trend });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ── Notifications badge ────────────────────────────────────────────────────────

router.get("/ai-tasks/notifications/unread-count", requirePermission("ai_tasks.read"), async (req, res) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    if (!companyId || !canAccessCompany(req, companyId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const count = await getUnreadAiTasksCount(companyId);
    res.json({ count });
  } catch (e) {
    req.log.error(e);
    res.status(500).json({ error: "Failed to load unread count" });
  }
});

export default router;
