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

export default router;
