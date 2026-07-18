import { GoogleGenAI } from "@google/genai";

// Prefer a direct Gemini API key supplied by the user (GEMINI_API_KEY) — the
// Replit AI Integrations proxy in this workspace returns "not configured"
// errors, so the direct key is the reliable path. Fall back to the proxy only
// when no direct key is present.
const proxyBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const proxyApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const directApiKey = process.env.GEMINI_API_KEY;

if (!(proxyBaseUrl && proxyApiKey) && !directApiKey) {
  throw new Error(
    "Gemini is not configured. Set GEMINI_API_KEY (direct key) or provision the Replit Gemini AI Integration (AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY).",
  );
}

export const ai = directApiKey
  ? new GoogleGenAI({ apiKey: directApiKey })
  : new GoogleGenAI({
      apiKey: proxyApiKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: proxyBaseUrl,
      },
    });
