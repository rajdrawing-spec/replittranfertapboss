/**
 * Feature flags for optional modules. Flags default to enabled so a fresh
 * deployment does not silently disable functionality; they can be turned off
 * via environment variables when not needed.
 */

export function isAiTasksEnabled(): boolean {
  return process.env.AI_TASKS_ENABLED !== "false";
}
