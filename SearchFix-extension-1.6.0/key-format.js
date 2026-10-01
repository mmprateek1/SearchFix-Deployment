// Check transport safety only. Google verifies validity and model access.
// Auth keys can contain periods (AQ.) and exceed legacy key lengths.
export function isApiKeyFormat(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 4096 && !/[^A-Za-z0-9._-]/.test(value);
}

export function normalizeApiKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new Error("Paste your complete Gemini API key from Google AI Studio.");
  if (/\s/.test(key)) throw new Error("The pasted key contains spaces or line breaks. Copy the complete key again from Google AI Studio.");
  if (!isApiKeyFormat(key)) throw new Error("Paste only the complete Gemini API key, without quotes or a variable name. Both AIza and AQ. key formats are supported.");
  return key;
}
