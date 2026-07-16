import { eq, and, desc } from "drizzle-orm";
import { db, aiPromptsTable } from "@workspace/db";
import type { NewAiPrompt } from "@workspace/db";

export const DEFAULT_TASK_GENERATION_PROMPT = `You are a task-assistant AI for a business operating system.
Your job is to customize reusable task templates for specific employees.
You MUST NOT invent tasks from scratch. Use the provided templates and customize them based on the employee profile.
Return ONLY valid JSON. No markdown, no explanation outside the JSON.

Output schema (array of objects):
[
  {
    "employeeId": number,
    "templateId": number | null,
    "title": "string (max 120 chars, action-oriented)",
    "description": "string (max 500 chars, concrete steps)",
    "priority": "low" | "medium" | "high",
    "estimatedMinutes": number | null,
    "aiCustomizations": {
      "titleChanged": true | false,
      "descriptionChanged": true | false,
      "reason": "short reason for customization"
    }
  }
]

Rules:
- One output object per employee-template pair. If an employee has multiple templates, return one object per template.
- If a template is already well-fitted, keep it close to the original but personalize the title/description to the employee's role/skill/project.
- Respect the employee's working hours and skill level. Do not assign high-load tasks to junior staff without guidance.
- Keep tasks achievable within a single workday.
- If the template is a one-time template and the employee already has a generated task for it, skip it (the caller handles this).
- Return ONLY the JSON array. No preamble, no code fence.`;

export async function ensureDefaultPrompt(): Promise<void> {
  const [existing] = await db
    .select({ id: aiPromptsTable.id })
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.name, "task_generation"))
    .limit(1);
  if (existing) return;

  await db.insert(aiPromptsTable).values({
    name: "task_generation",
    version: "1.0",
    content: DEFAULT_TASK_GENERATION_PROMPT,
    isActive: true,
    isSystem: true,
  } as NewAiPrompt);
}

export async function getActivePrompt(name: string): Promise<string> {
  await ensureDefaultPrompt();
  const [row] = await db
    .select({ content: aiPromptsTable.content, version: aiPromptsTable.version })
    .from(aiPromptsTable)
    .where(and(eq(aiPromptsTable.name, name), eq(aiPromptsTable.isActive, true)))
    .orderBy(desc(aiPromptsTable.id))
    .limit(1);
  return row?.content ?? DEFAULT_TASK_GENERATION_PROMPT;
}

export async function getActivePromptVersion(name: string): Promise<string> {
  await ensureDefaultPrompt();
  const [row] = await db
    .select({ version: aiPromptsTable.version })
    .from(aiPromptsTable)
    .where(and(eq(aiPromptsTable.name, name), eq(aiPromptsTable.isActive, true)))
    .orderBy(desc(aiPromptsTable.id))
    .limit(1);
  return row?.version ?? "1.0";
}

export async function listPrompts(name: string) {
  return db
    .select()
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.name, name))
    .orderBy(desc(aiPromptsTable.id));
}

export async function createPromptVersion(data: {
  name: string;
  version: string;
  content: string;
}): Promise<{ id: number; version: string }> {
  await db
    .update(aiPromptsTable)
    .set({ isActive: false })
    .where(eq(aiPromptsTable.name, data.name));

  const [row] = await db
    .insert(aiPromptsTable)
    .values({ ...data, isActive: true, isSystem: false })
    .returning({ id: aiPromptsTable.id, version: aiPromptsTable.version });
  return row;
}

export async function setActivePrompt(promptId: number): Promise<{ ok: boolean }> {
  const [row] = await db.select().from(aiPromptsTable).where(eq(aiPromptsTable.id, promptId)).limit(1);
  if (!row) return { ok: false };

  await db
    .update(aiPromptsTable)
    .set({ isActive: false })
    .where(eq(aiPromptsTable.name, row.name));
  await db
    .update(aiPromptsTable)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(aiPromptsTable.id, promptId));
  return { ok: true };
}
