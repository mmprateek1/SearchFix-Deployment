import { AsyncLocalStorage } from "node:async_hooks";
import { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { isApiKeyFormat } from "../../extension/key-format.js";
import { withRequestTrace } from './trace.service.js';

const context = new AsyncLocalStorage();
export const currentGeminiClient = () => context.getStore()?.client;
export const currentCredentialId = () => context.getStore()?.credentialId || "";
export const hashGeminiKey = key => createHash("sha256").update(key).digest("hex");

// A key belongs to one request, never to process.env or a shared singleton.
export function withGeminiKey(apiKey, work, createClient = key => new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 } } })) {
    return context.run({ client: apiKey ? createClient(apiKey) : null, credentialId: apiKey ? hashGeminiKey(apiKey) : "" }, work);
}

export function geminiKeyMiddleware(req, res, next) {
    const key = req.get("X-SearchFix-Gemini-Key");
    if (!key) return res.status(401).json({ error: "Add your Gemini API key in the extension. Environment-key fallback is disabled." });
    if (!isApiKeyFormat(key)) {
        return res.status(400).json({ error: "Invalid Gemini API key format. Add your key again in the extension." });
    }
    const allowed = (process.env.ALLOWED_GEMINI_KEY_HASHES || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
    const allowAll = allowed.includes("*");
    if ((process.env.RENDER || process.env.NODE_ENV === "production" || allowed.length) && !allowAll && !allowed.includes(hashGeminiKey(key))) {
        return res.status(403).json({ error: "This key is not approved for this SearchFix server. Ask the administrator to add its SHA-256 fingerprint." });
    }
    return next();
}

// Establish context after multipart parsing: upload streams may invoke their
// completion callback outside the earlier middleware's async context.
export function withRequestGeminiKey(handler) {
    return (req, res, next) => {
        try {
            res.set("X-SearchFix-Key-Source", "request");
            return withRequestTrace(req, () => withGeminiKey(req.get("X-SearchFix-Gemini-Key"),
                () => Promise.resolve(handler(req, res, next)).catch(next)));
        } catch { return next(new Error("Unable to initialize Gemini for this request.")); }
    };
}
