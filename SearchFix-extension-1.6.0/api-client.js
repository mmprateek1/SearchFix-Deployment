import { backendURL } from "./core.js";
import { normalizeApiKey } from "./key-format.js";
export { normalizeApiKey } from "./key-format.js";

export function createApiClient({ backend, getKey, fetcher = fetch, log = () => {}, timeoutMs = 180000 }) {
  return async (path, body, json = false) => {
    const headers = json ? { "Content-Type": "application/json" } : {};
    const key = getKey();
    if (!key) throw new Error("Add your Gemini API key before analysis. No default key will be used.");
    headers["X-SearchFix-Gemini-Key"] = normalizeApiKey(key);
    let response;
    const started = Date.now();
    log('api.start', {step:path});
    try { response = await fetcher(`${backendURL(backend())}/api/searchfix/${path}`, {
      method: "POST", credentials: "omit", redirect: "error", headers,
      body: json ? JSON.stringify(body) : body, signal: AbortSignal.timeout(timeoutMs)
    }); } catch { log('api.connection.failed', {step:path, durationMs:Date.now()-started}); throw new Error("Cannot reach the analysis service or the request timed out. Check the local backend window and retry."); }
    log('api.response', {step:path,httpStatus:response.status,requestId:response.headers.get('X-SearchFix-Request-Id') || '',durationMs:Date.now()-started});
    if (path === "validate-key" && response.status === 404) throw new Error("The backend is outdated. Restart it from the updated project folder, then verify the key again.");
    const payload = await response.json().catch(() => { throw new Error("Backend returned an unreadable response."); });
    if (!response.ok) throw new Error(payload.error || `Backend error (${response.status}).`);
    if (response.headers.get("X-SearchFix-Key-Source") !== "request") throw new Error("The backend did not confirm use of your supplied key. Update/restart the backend before analysis.");
    if (json && body.orderNumber && payload.orderNumber !== body.orderNumber) throw new Error("Backend response belongs to another order.");
    return payload;
  };
}
