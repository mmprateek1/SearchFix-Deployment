import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { runtimeConfig } from "../src/config/runtime.js";
import { geminiService } from "../src/services/gemini.service.js";
import { hashGeminiKey, withGeminiKey, currentGeminiClient } from "../src/services/geminiContext.service.js";
import { saveAnalysis, loadAnalysis } from "../src/services/analysisSession.service.js";
import { configureBackend } from "../scripts/configure-backend.mjs";
import { backendURL } from "../extension/core.js";

const key = `AQ.TEST_RENDER_ONLY.${"aB0_-".repeat(70)}`;

test("Render binds PORT on all interfaces and refuses an unconfigured public service", () => {
  assert.deepEqual(runtimeConfig({}), { hosted: false, host: "127.0.0.1", port: 3000 });
  assert.throws(() => runtimeConfig({ RENDER: "true", PORT: "10000" }), /ALLOWED_GEMINI_KEY_HASHES/);
  assert.deepEqual(runtimeConfig({ RENDER: "true", PORT: "10000", ALLOWED_GEMINI_KEY_HASHES: hashGeminiKey(key) }),
    { hosted: true, host: "0.0.0.0", port: 10000 });
  assert.deepEqual(runtimeConfig({ RENDER: "true", PORT: "10000", ALLOWED_GEMINI_KEY_HASHES: "*" }),
    { hosted: true, host: "0.0.0.0", port: 10000 });
});

test("hosted extension configuration grants only the selected HTTPS backend", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "searchfix-config-"));
  try {
    fs.copyFileSync(new URL("../extension/manifest.json", import.meta.url), path.join(dir, "manifest.json"));
    const host = "https://synthetic-searchfix.onrender.com";
    assert.equal(configureBackend(dir, host), host);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"))).host_permissions,
      ["https://tv.datatracetitle.com/*", `${host}/*`]);
    assert.match(fs.readFileSync(path.join(dir, "deployment.js"), "utf8"), /synthetic-searchfix\.onrender\.com/);
    assert.equal(backendURL(host, host), host);
    assert.throws(() => backendURL("https://unrelated.example", host));
    for (const url of ["http://synthetic.onrender.com", `${host}/api`, `${host}?key=x`, "https://user:password@synthetic.onrender.com"]) assert.throws(() => configureBackend(dir, url));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("hosted HTTP requests require an approved supplied key, expose the key-source confirmation, and restrict website origins", async () => {
  const oldEnv = { NODE_ENV: process.env.NODE_ENV, ALLOWED_GEMINI_KEY_HASHES: process.env.ALLOWED_GEMINI_KEY_HASHES, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  const original = geminiService.validateKey;
  let validations = 0;
  geminiService.validateKey = async () => { assert.ok(currentGeminiClient()); validations++; return { valid: true, credentialSource: "request" }; };
  process.env.NODE_ENV = "production";
  process.env.ALLOWED_GEMINI_KEY_HASHES = hashGeminiKey(key);
  process.env.GEMINI_API_KEY = key;
  const server = createApp().listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const origin = `chrome-extension://${"a".repeat(32)}`;
  try {
    const health = await fetch(`${root}/health`); assert.equal((await health.json()).credentialMode, "request-key-only");
    const call = headers => fetch(`${root}/api/searchfix/validate-key`, { method: "POST", headers });
    assert.equal((await call({})).status, 401);
    assert.equal((await call({ "X-SearchFix-Gemini-Key": "TEST_OTHER_KEY_12345678901234567890" })).status, 403);
    assert.equal((await call({ "X-SearchFix-Gemini-Key": key, Origin: "https://untrusted.example" })).status, 403);
    const accepted = await call({ "X-SearchFix-Gemini-Key": key, Origin: origin });
    assert.equal(accepted.status, 200); assert.equal(accepted.headers.get("X-SearchFix-Key-Source"), "request");
    assert.equal(accepted.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(accepted.headers.get("Access-Control-Expose-Headers"), /X-SearchFix-Key-Source/i);
    assert.match(accepted.headers.get("Access-Control-Expose-Headers"), /X-SearchFix-Request-Id/i);
    assert.match(accepted.headers.get("X-SearchFix-Request-Id"), /^[a-f0-9-]{36}$/);
    assert.equal(validations, 1);
    const preflight = await fetch(`${root}/api/searchfix/validate-key`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "X-SearchFix-Gemini-Key,Content-Type" } });
    assert.equal(preflight.status, 204);
  } finally {
    await new Promise(resolve => server.close(resolve)); geminiService.validateKey = original;
    for (const [name, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("analysis sessions cannot be reused with another user's key", async () => {
  const factory = () => ({});
  const comments = [{ author: "Client", text: "Missing deed" }];
  const id = withGeminiKey(key, () => saveAnalysis("ORDER", comments, { issues: [] }), factory);
  withGeminiKey(key, () => assert.deepEqual(loadAnalysis(id, "ORDER", comments), { issues: [] }), factory);
  withGeminiKey("TEST_OTHER_KEY_12345678901234567890", () => assert.throws(() => loadAnalysis(id, "ORDER", comments), /expired or the order changed/), factory);
});
