/**
 * Normalize VITE_API_URL so it's always a valid base:
 *  - unset / empty  → "/api"  (Vercel proxy)
 *  - "api"          → "/api"  (add missing leading slash)
 *  - "/api"         → "/api"  (correct, keep as-is)
 *  - "http://..."   → "http://..." (direct URL, keep as-is)
 * Trailing slashes are always stripped to avoid double-slash in requests.
 */
function normalizeBaseUrl(raw) {
  if (!raw) return "/api";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  // Ensure leading slash for path-only values like "api"
  return ("/" + raw.replace(/^\/+/, "")).replace(/\/$/, "");
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL);

export const API_ENDPOINTS = {
  upload: "/data/upload",
  train: "/model/train",
  predict: "/model/predict",
  history: "/model/history",
  modelInfo: "/model/info",
};
