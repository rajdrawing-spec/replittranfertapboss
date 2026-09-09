import { GoogleGenAI } from "@google/genai";

// Prefer a direct Gemini API key supplied by the user (GEMINI_API_KEY) — the
// Replit AI Integrations proxy in this workspace returns "not configured"
// errors, so the direct key is the reliable path. Fall back to the proxy only
// when no direct key is present.
function createClient(): GoogleGenAI {
  const proxyBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const proxyApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const directApiKey = process.env.GEMINI_API_KEY;

  if (!(proxyBaseUrl && proxyApiKey) && !directApiKey) {
    throw new Error(
      "Gemini is not configured. Set GEMINI_API_KEY (direct key) or provision the Replit Gemini AI Integration (AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY).",
    );
  }

  return directApiKey
    ? new GoogleGenAI({ apiKey: directApiKey })
    : new GoogleGenAI({
        apiKey: proxyApiKey,
        httpOptions: {
          apiVersion: "",
          baseUrl: proxyBaseUrl,
        },
      });
}

let client: GoogleGenAI | undefined;

/** True when a Gemini key is configured, without constructing the client. */
export function isGeminiConfigured(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY),
  );
}

/**
 * The Gemini client, constructed on first use.
 *
 * This is deliberately lazy. The configuration check used to run at module
 * scope, which meant importing this package threw when no key was set — and
 * because `routes/gemini.ts` is pulled in by the route index, a deployment
 * without a Gemini key could not boot the server *at all*. AI is one feature
 * of an ERP; a missing optional key should disable that feature, not take
 * down orders, invoices and HR with it.
 *
 * Callers see the same error as before, raised when they actually try to use
 * Gemini rather than when the module is loaded.
 */
export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop, receiver) {
    client ??= createClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    client ??= createClient();
    return Reflect.has(client, prop);
  },
});
