/**
 * Guard against unsafe attachment URLs (e.g. `javascript:`, `data:`) that would
 * be persisted and later rendered as clickable links. Allows same-origin object
 * storage / api paths and http(s) external URLs only. Empty/absent = allowed
 * (the field is optional).
 */
export function isSafeAttachmentUrl(u: unknown): boolean {
  if (u == null || u === "") return true;
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (s === "") return true;
  // Same-origin internal paths (object storage upload results, served assets).
  if (s.startsWith("/objects/") || s.startsWith("/public-objects/") || s.startsWith("/api/storage/")) {
    return true;
  }
  try {
    const parsed = new URL(s);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
