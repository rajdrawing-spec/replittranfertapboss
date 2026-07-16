import { getConfig, setConfig } from "../ai-provider";

/**
 * AI Tasks module configuration. Values are stored in the existing ai_config
 * table so no new tables are needed. Sensitive keys are encrypted at rest by
 * the shared credential store; these flag keys are plaintext.
 */

export interface AiTasksConfig {
  enabled: boolean;
  provider: "auto" | "ollama" | "gemini";
  generationTime: string; // HH:mm, e.g. "08:00"
  autoApprove: boolean;
  maxRegenerationsPerDay: number;
  enableScheduler: boolean;
  promptTemplate: string | null;
  batchSize: number;
}

const DEFAULT_CONFIG: AiTasksConfig = {
  enabled: true,
  provider: "auto",
  generationTime: "08:00",
  autoApprove: false,
  maxRegenerationsPerDay: 3,
  enableScheduler: true,
  promptTemplate: null,
  batchSize: 10,
};

const KEYS: Record<keyof AiTasksConfig, string> = {
  enabled: "ai_tasks_enabled",
  provider: "ai_tasks_provider",
  generationTime: "ai_tasks_generation_time",
  autoApprove: "ai_tasks_auto_approve",
  maxRegenerationsPerDay: "ai_tasks_max_regenerations_per_day",
  enableScheduler: "ai_tasks_enable_scheduler",
  promptTemplate: "ai_tasks_prompt_template",
  batchSize: "ai_tasks_batch_size",
};

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  return value === "true";
}

function parseIntSafe(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return isNaN(n) ? fallback : n;
}

export async function getAiTasksConfig(): Promise<AiTasksConfig> {
  // Environment variable overrides any DB value for the kill switch.
  const envEnabled = process.env.AI_TASKS_ENABLED;
  const enabled = envEnabled === "false" ? false : envEnabled === "true" ? true : undefined;

  const values = await Promise.all([
    enabled === undefined ? getConfig(KEYS.enabled) : Promise.resolve(enabled ? "true" : "false"),
    getConfig(KEYS.provider),
    getConfig(KEYS.generationTime),
    getConfig(KEYS.autoApprove),
    getConfig(KEYS.maxRegenerationsPerDay),
    getConfig(KEYS.enableScheduler),
    getConfig(KEYS.promptTemplate),
    getConfig(KEYS.batchSize),
  ]);

  return {
    enabled: parseBool(values[0], DEFAULT_CONFIG.enabled),
    provider: (values[1] as "auto" | "ollama" | "gemini") || DEFAULT_CONFIG.provider,
    generationTime: values[2] || DEFAULT_CONFIG.generationTime,
    autoApprove: parseBool(values[3], DEFAULT_CONFIG.autoApprove),
    maxRegenerationsPerDay: parseIntSafe(values[4], DEFAULT_CONFIG.maxRegenerationsPerDay),
    enableScheduler: parseBool(values[5], DEFAULT_CONFIG.enableScheduler),
    promptTemplate: values[6] || DEFAULT_CONFIG.promptTemplate,
    batchSize: Math.max(1, parseIntSafe(values[7], DEFAULT_CONFIG.batchSize)),
  };
}

export async function setAiTasksConfig(config: Partial<AiTasksConfig>): Promise<void> {
  const entries: Array<{ key: string; value: string | null }> = [];
  if (config.enabled !== undefined) entries.push({ key: KEYS.enabled, value: config.enabled ? "true" : "false" });
  if (config.provider !== undefined) entries.push({ key: KEYS.provider, value: config.provider });
  if (config.generationTime !== undefined) entries.push({ key: KEYS.generationTime, value: config.generationTime });
  if (config.autoApprove !== undefined) entries.push({ key: KEYS.autoApprove, value: config.autoApprove ? "true" : "false" });
  if (config.maxRegenerationsPerDay !== undefined) entries.push({ key: KEYS.maxRegenerationsPerDay, value: String(config.maxRegenerationsPerDay) });
  if (config.enableScheduler !== undefined) entries.push({ key: KEYS.enableScheduler, value: config.enableScheduler ? "true" : "false" });
  if (config.promptTemplate !== undefined) entries.push({ key: KEYS.promptTemplate, value: config.promptTemplate });
  if (config.batchSize !== undefined) entries.push({ key: KEYS.batchSize, value: String(Math.max(1, config.batchSize)) });

  await Promise.all(entries.map((e) => setConfig(e.key, e.value ?? "")));
}

export async function isAiTasksEnabled(): Promise<boolean> {
  const env = process.env.AI_TASKS_ENABLED;
  if (env === "false") return false;
  if (env === "true") return true;
  const cfg = await getAiTasksConfig();
  return cfg.enabled;
}
