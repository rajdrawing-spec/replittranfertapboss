/**
 * AI Provider abstraction for TAPBOSS Business Intelligence.
 *
 * Defines a common AiProvider interface so all analysis routes call one function
 * regardless of which backend is active. The active provider is stored in the
 * ai_config table (key = "active_provider"). Fallback is Gemini.
 *
 * Supported providers: gemini | openrouter | groq | deepseek
 * External providers (openrouter, groq, deepseek) require an API key stored
 * in ai_config (key = "<provider>_api_key").
 */

import { db, aiConfigTable } from "@workspace/db";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { eq } from "drizzle-orm";
import { encryptValue, decryptValue } from "./credential-store";

// Keys whose values are sensitive credentials — encrypt at rest.
const CREDENTIAL_KEYS = new Set(["openrouter_api_key", "groq_api_key", "deepseek_api_key"]);

export type AiMessage = { role: "user" | "assistant"; content: string };

export interface AiProvider {
  name: string;
  chat(messages: AiMessage[], systemPrompt?: string): Promise<string>;
}

// ── Config helpers ────────────────────────────────────────────────────────────

async function getConfig(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: aiConfigTable.value, iv: aiConfigTable.iv })
    .from(aiConfigTable)
    .where(eq(aiConfigTable.key, key))
    .limit(1);
  if (!row?.value) return null;
  // Decrypt credential keys that have an IV stored alongside them
  if (CREDENTIAL_KEYS.has(key) && row.iv) {
    try {
      return decryptValue(row.value, row.iv);
    } catch {
      // Key may have been rotated — treat as unset
      return null;
    }
  }
  return row.value;
}

export async function setConfig(key: string, value: string): Promise<void> {
  if (CREDENTIAL_KEYS.has(key) && value) {
    // Store API keys encrypted
    const { encryptedValue, iv } = encryptValue(value);
    await db
      .insert(aiConfigTable)
      .values({ key, value: encryptedValue, iv, updatedAt: new Date() })
      .onConflictDoUpdate({ target: aiConfigTable.key, set: { value: encryptedValue, iv, updatedAt: new Date() } });
  } else {
    await db
      .insert(aiConfigTable)
      .values({ key, value, iv: null, updatedAt: new Date() })
      .onConflictDoUpdate({ target: aiConfigTable.key, set: { value, iv: null, updatedAt: new Date() } });
  }
}

export async function getActiveProviderName(): Promise<string> {
  return (await getConfig("active_provider")) ?? "gemini";
}

// ── Gemini provider (Replit AI integrations proxy — no key needed) ────────────

const geminiProvider: AiProvider = {
  name: "gemini",
  async chat(messages, systemPrompt) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
    const response = await geminiAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        // Disable thinking for structured JSON tasks — thinking tokens consume
        // output budget and cause the JSON to be truncated mid-response.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 16384,
        systemInstruction: systemPrompt,
      },
    });
    return response.text ?? "";
  },
};

// ── Generic fetch-based provider (OpenRouter / Groq / DeepSeek) ──────────────

function makeFetchProvider(
  providerName: string,
  baseUrl: string,
  model: string,
  getApiKey: () => Promise<string>,
): AiProvider {
  return {
    name: providerName,
    async chat(messages, systemPrompt) {
      const apiKey = await getApiKey();
      if (!apiKey) throw new Error(`${providerName} API key is not configured`);

      const body = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        max_tokens: 8192,
      };

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${providerName} API error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

const openrouterProvider = makeFetchProvider(
  "openrouter",
  "https://openrouter.ai/api/v1",
  "mistralai/mistral-7b-instruct:free",
  () => getConfig("openrouter_api_key").then((k) => k ?? ""),
);

const groqProvider = makeFetchProvider(
  "groq",
  "https://api.groq.com/openai/v1",
  "llama3-8b-8192",
  () => getConfig("groq_api_key").then((k) => k ?? ""),
);

const deepseekProvider = makeFetchProvider(
  "deepseek",
  "https://api.deepseek.com/v1",
  "deepseek-chat",
  () => getConfig("deepseek_api_key").then((k) => k ?? ""),
);

// ── Factory ───────────────────────────────────────────────────────────────────

const providers: Record<string, AiProvider> = {
  gemini:     geminiProvider,
  openrouter: openrouterProvider,
  groq:       groqProvider,
  deepseek:   deepseekProvider,
};

export async function getActiveProvider(): Promise<AiProvider> {
  const name = await getActiveProviderName();
  return providers[name] ?? geminiProvider;
}

/** Test a provider's connectivity with a simple ping. */
export async function testProvider(name: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const provider = providers[name];
  if (!provider) return { ok: false, latencyMs: 0, error: `Unknown provider: ${name}` };
  const t0 = Date.now();
  try {
    await provider.chat([{ role: "user", content: "Reply with the single word: OK" }]);
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
  }
}
