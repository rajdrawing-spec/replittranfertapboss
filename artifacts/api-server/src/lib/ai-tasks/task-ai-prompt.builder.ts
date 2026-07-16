import type { TaskTemplate } from "@workspace/db";
import type { EmployeeProfile } from "./employee-profile.service";

export interface GeneratedTaskOutput {
  employeeId: number;
  templateId: number | null;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  estimatedMinutes: number | null;
  aiCustomizations: Record<string, unknown>;
}

const SYSTEM_PROMPT = `You are a task-assistant AI for a business operating system.
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

export function buildBatchPrompt(
  employees: EmployeeProfile[],
  templates: TaskTemplate[],
  customPromptTemplate?: string | null,
): string {
  const lines: string[] = [];
  lines.push("Employees in this batch:");
  for (const emp of employees) {
    lines.push(`- ID ${emp.id}: ${emp.firstName} ${emp.lastName} | Department: ${emp.department} | Role: ${emp.designation} | Skill: ${emp.skillLevel || "unspecified"} | Working hours: ${emp.workingHours || "unspecified"} | Current project: ${emp.currentProject || "none"}`);
  }
  lines.push("\nTemplates to customize:");
  for (const t of templates) {
    lines.push(`- ID ${t.id}: [${t.priority}] ${t.titleTemplate} | ${t.descriptionTemplate} | Recurrence: ${t.recurrence} | Est. minutes: ${t.estimatedMinutes || "unspecified"}`);
  }
  if (customPromptTemplate) {
    lines.push("\nAdditional instructions from admin:");
    lines.push(customPromptTemplate);
  }
  lines.push("\nReturn one JSON object per employee-template pair.");
  return lines.join("\n");
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function parseGeneratedTasks(raw: string): GeneratedTaskOutput[] {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
    return parsed.filter(isValidGeneratedTask);
  } catch (e) {
    // Fallback: try to extract a JSON array from the text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response");
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
    return parsed.filter(isValidGeneratedTask);
  }
}

function isValidGeneratedTask(item: unknown): item is GeneratedTaskOutput {
  if (!item || typeof item !== "object") return false;
  const t = item as Record<string, unknown>;
  if (typeof t.employeeId !== "number") return false;
  if (t.templateId !== null && typeof t.templateId !== "number") return false;
  if (typeof t.title !== "string" || !t.title.trim()) return false;
  if (typeof t.description !== "string" || !t.description.trim()) return false;
  if (!["low", "medium", "high"].includes(t.priority as string)) return false;
  if (t.estimatedMinutes !== null && typeof t.estimatedMinutes !== "number") return false;
  return true;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
