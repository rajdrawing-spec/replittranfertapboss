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
import { isAiTasksEnabled } from "../lib/features";
import { insertTaskTemplateSchema, updateTaskTemplateSchema } from "@workspace/db";

const router = Router();

// Feature flag: if AI Tasks is disabled, all routes return 404.
router.use((req, res, next) => {
  if (!isAiTasksEnabled()) {
    res.status(404).json({ error: "AI Tasks module is disabled" });
    return;
  }
  next();
});

const templateSchema = insertTaskTemplateSchema;
const templateUpdateSchema = updateTaskTemplateSchema;

// List templates
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

// Get single template
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

// Create template
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

// Update template
router.patch("/ai-tasks/templates/:id", requirePermission("ai_tasks.manage"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const parsed = templateUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    // Need companyId to enforce scoping; it can be in body or query.
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

// Delete template
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

export default router;
