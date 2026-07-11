import { GoogleGenAI } from "@google/genai";

// Prefer the Replit AI Integrations proxy when provisioned. Otherwise fall
// back to a direct Gemini API key supplied by the user (GEMINI_API_KEY).
const proxyBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const proxyApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const directApiKey = process.env.GEMINI_API_KEY;

if (!(proxyBaseUrl && proxyApiKey) && !directApiKey) {
  throw new Error(
    "Gemini is not configured. Set GEMINI_API_KEY (direct key) or provision the Replit Gemini AI Integration (AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY).",
  );
}

export const ai =
  proxyBaseUrl && proxyApiKey
    ? new GoogleGenAI({
        apiKey: proxyApiKey,
        httpOptions: {
          apiVersion: "",
          baseUrl: proxyBaseUrl,
        },
      })
    : new GoogleGenAI({ apiKey: directApiKey });
