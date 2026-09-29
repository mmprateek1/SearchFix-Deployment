export function runtimeConfig(env = process.env) {
    const hosted = Boolean(env.RENDER) || env.NODE_ENV === "production";
    const allowedHashes = (env.ALLOWED_GEMINI_KEY_HASHES || "").split(",").map(v => v.trim()).filter(Boolean);
    const hasWildcard = allowedHashes.includes("*");
    if (hosted && (!allowedHashes.length || (!hasWildcard && allowedHashes.some(v => !/^[a-f0-9]{64}$/i.test(v))))) {
        throw new Error("Set ALLOWED_GEMINI_KEY_HASHES to approved key SHA-256 fingerprints before starting the hosted service.");
    }
    const port = Number(env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT.");
    return { hosted, host: hosted ? "0.0.0.0" : "127.0.0.1", port };
}
