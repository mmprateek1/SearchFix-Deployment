import {BACKEND_ORIGIN} from '../extension/deployment.js';
import {selection} from './helpers/selection.js';
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import routes from "../src/routes/searchfix.routes.js";
import { createApiClient, normalizeApiKey } from "../extension/api-client.js";
import { GeminiService, geminiService } from "../src/services/gemini.service.js";
import { withGeminiKey, currentGeminiClient } from "../src/services/geminiContext.service.js";
import { isApiKeyFormat } from "../extension/key-format.js";
import { requestTrace, currentTraceId } from '../src/services/trace.service.js';

geminiService.budget = null; // Provider-only fixtures; budget integration has dedicated tests.

const keyA = "TEST_KEY_A_12345678901234567890";
const keyB = "TEST_KEY_B_12345678901234567890";

test("key input is trimmed and invalid header values are rejected", () => {
  assert.equal(normalizeApiKey(` ${keyA} `), keyA);
  for (const value of ["", "short", `${keyA}\r\nInjected: bad`]) assert.throws(() => normalizeApiKey(value));
});

test("standard and long AQ. auth keys keep every character and unsafe values stay blocked", () => {
  for (const key of [`AIza${"a".repeat(35)}`, `AQ.TEST_ONLY.${"aB0_-".repeat(70)}`]) {
    assert.equal(normalizeApiKey(` \t${key}\n`), key);
    assert.equal(isApiKeyFormat(key), true);
  }
  assert.equal(isApiKeyFormat(`${keyA}\n`), false);
  for (const key of [null, undefined, "x".repeat(4097), `AQ.${"a".repeat(25)}\r\nInjected: bad`, `${keyA} ${keyB}`, `"${keyA}"`, `GEMINI_API_KEY=${keyA}`, `${keyA}\u200b`]) {
    assert.throws(() => normalizeApiKey(key));
    assert.equal(isApiKeyFormat(key), false);
  }
});

test("both comment and multipart document requests preserve long auth keys only in the service header", async () => {
  const seen = [];
  const authKey = `AQ.TEST_ONLY.${"aB0_-".repeat(70)}`;
  let key = authKey;
  const api = createApiClient({ backend: () => BACKEND_ORIGIN, getKey: () => key,
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return new Response(JSON.stringify({ orderNumber: "TEST" }), { headers: { "X-SearchFix-Key-Source": "request" } });
    } });
  const form = new FormData(); form.append("orderData", JSON.stringify({ orderNumber: "TEST" }));
  await api("analyze-comments", { orderNumber: "TEST" }, true);
  await api("analyze-documents", form);
  for (const { url, options } of seen) {
    assert.equal(new URL(url).origin, BACKEND_ORIGIN);
    assert.equal(options.headers["X-SearchFix-Gemini-Key"], authKey);
    assert.equal(url.includes(authKey), false);
    assert.equal(String(options.body).includes(authKey), false);
    assert.equal(options.redirect, "error");
  }
  assert.equal(seen[1].options.headers["Content-Type"], undefined);
  key = ""; await assert.rejects(api("analyze-comments", { orderNumber: "TEST" }, true), /No default key/);
  assert.equal(seen.length, 2);
  const bad = createApiClient({ backend: () => "https://example.com", getKey: () => keyA, fetcher: () => assert.fail("Must not transmit") });
  await assert.rejects(bad("analyze-comments", {}, true));
});

test("concurrent request keys remain isolated through text, file, and decision calls", async () => {
  const calls = [];
  const makeClient = key => ({ models: { generateContent: async request => {
    await new Promise(resolve => setImmediate(resolve));
    calls.push([key, request.model]); return { text: key };
  } } });
  const originalEnv = process.env.GEMINI_API_KEY;
  await Promise.all([keyA, keyB].map(key => withGeminiKey(key, async () => {
    assert.equal(await geminiService.generateJSON("system", "comment"), key);
    assert.equal(await geminiService.generateContentWithFiles("system", "file", []), key);
    assert.equal(await geminiService.generateJSON("system", "decision", "documents"), key);
  }, makeClient)));
  assert.equal(calls.length, 6);
  assert.equal(currentGeminiClient(), undefined);
  assert.equal(process.env.GEMINI_API_KEY, originalEnv);
});

test("backend ignores a configured environment key and uses only the supplied request key", async () => {
  const original = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = keyB;
    const service = new GeminiService(null, { budget: null });
    assert.throws(() => service.ai, /Add a Gemini API key/);
    await withGeminiKey(keyA, async () => {
      assert.equal(await service.generateJSON("system", "comment"), "ok");
    }, () => ({ models: { generateContent: async () => ({ text: "ok" }) } }));
  } finally { if (original === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = original; }
});

test("provider errors never expose the entered credential", async () => {
  await withGeminiKey(keyA, async () => {
    await assert.rejects(geminiService.generateJSON("system", "comment"), error => {
      assert.equal(error.message.includes(keyA), false);
      assert.equal(error.cause, undefined); assert.equal(error.status, 403); return true;
    });
  }, () => ({ models: { generateContent: async () => { const error = new Error(`Request failed with key=${keyA}`); error.status = 403; throw error; } } }));
});

test("real HTTP routes accept a per-request key for JSON and multipart and reject invalid keys before uploads", async () => {
  const originalJSON = geminiService.generateJSON;
  const originalFiles = geminiService.generateContentWithFiles;
  const clients = [];
  const documentClients = [];
  const traces = [], documentTraces = [];
  geminiService.generateJSON = async () => {
    assert.ok(currentGeminiClient()); clients.push(currentGeminiClient()); traces.push(currentTraceId());
    return selection([{ issueType: "MISSING_DEED", claim: "Missing deed" }]);
  };
  geminiService.generateContentWithFiles = async () => {
    assert.ok(currentGeminiClient()); documentClients.push(currentGeminiClient()); documentTraces.push(currentTraceId());
    return { evidence: [{ document: "Deed.pdf", page: 1, finding: "Synthetic deed" }] };
  };
  const app = express(); app.use(requestTrace); app.use(express.json()); app.use("/api/searchfix", routes);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/searchfix`;
  const order = { orderNumber: "KEY-TEST", comments: [{ author: "Client", date:"2026-09-25", time:"12:00", text: "Missing deed" }] };
  try {
    const authKey = `AQ.TEST_ONLY.${"aB0_-".repeat(70)}`;
    const first = await fetch(`${root}/analyze-comments`, { method: "POST", headers: { "Content-Type": "application/json", "X-SearchFix-Gemini-Key": authKey }, body: JSON.stringify(order) });
    assert.equal(first.status, 200);
    const form = new FormData(); form.append("orderData", JSON.stringify(order));
    form.append("file0", new Blob(["%PDF-1.4 synthetic"], { type: "application/pdf" }), "Deed.pdf");
    form.append("fileType_file0", "DEED");
    const second = await fetch(`${root}/analyze-documents`, { method: "POST", headers: { "X-SearchFix-Gemini-Key": `${authKey}_SECOND` }, body: form });
    assert.equal(second.status, 200); assert.equal((await second.json()).status, "REVIEW_REQUIRED");
    assert.equal(clients.length, 2); assert.notEqual(clients[0], clients[1]);
    assert.deepEqual(documentClients, [clients[1]]);
    assert.ok(first.headers.get('X-SearchFix-Request-Id'));
    assert.deepEqual(traces,[first.headers.get('X-SearchFix-Request-Id'),second.headers.get('X-SearchFix-Request-Id')]);
    assert.deepEqual(documentTraces,[second.headers.get('X-SearchFix-Request-Id')]);
    const rejected = await fetch(`${root}/analyze-documents`, { method: "POST", headers: { "X-SearchFix-Gemini-Key": "bad" }, body: form });
    assert.equal(rejected.status, 400);
    assert.equal(clients.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); geminiService.generateJSON = originalJSON; geminiService.generateContentWithFiles = originalFiles; }
});

test("the old overview workflow is removed and credentials use session storage, not page injection", () => {
  const html = readFileSync(new URL("../extension/panel.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../extension/panel.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="(?:orderSection|orderNumber|reviewed|processCurrent|analyze)"/);
  assert.match(html, /id="apiKey" type="password"/);
  assert.match(js, /chrome\.storage\.session\.set\(\{ geminiApiKey: key \}\)/);
  assert.doesNotMatch(js, /chrome\.storage\.(?:local|sync)\.set\([^\n]*geminiApiKey/);
  assert.match(html, /id="apiKeySection" hidden/);
  assert.doesNotMatch(html, /Connection and page settings|id="settings"/);
  assert.match(html, /id="toggleApiKey" class="primary"/);
});

test("key verification checks both models with the supplied client and stops on rejection", async () => {
  const calls = [];
  await withGeminiKey(keyA, async () => {
    const result = await geminiService.validateKey();
    assert.equal(result.valid, true);
    assert.equal(result.credentialSource, "request");
    assert.deepEqual(calls, result.models);
    assert.equal(calls.length, 2);
  }, () => ({ models: { generateContent: async request => { calls.push(request.model); return { text: "OK" }; } } }));
  await withGeminiKey(keyA, () => assert.rejects(geminiService.validateKey(), /does not have permission/),
    () => ({ models: { generateContent: async () => { const error = new Error("Private provider detail"); error.status = 403; throw error; } } }));
});

test("old backends and unconfirmed key sources cannot silently produce successful client results", async () => {
  for (const [status, body, expected] of [[404, {}, /outdated/], [200, { valid: true }, /did not confirm/]]) {
    const api = createApiClient({ backend: () => BACKEND_ORIGIN, getKey: () => keyA,
      fetcher: async () => new Response(JSON.stringify(body), { status }) });
    await assert.rejects(api("validate-key", {}, true), expected);
  }
});

test('key verification switches models after temporary failure and reports the working models',async()=>{
  const calls=[], waits=[];
  let attempt=0;
  const service=new GeminiService({models:{generateContent:async({model})=>{
    calls.push(model);
    if(++attempt===2)throw Object.assign(new Error('Private provider detail'),{status:503});
    return {text:'OK'};
  }}},{budget:null,wait:async ms=>waits.push(ms)});
  const result=await service.validateKey();
  assert.equal(result.valid,true);
  assert.deepEqual(calls,['gemini-3.5-flash-lite','gemini-3.5-flash','gemini-3.5-flash-lite']);
  assert.deepEqual(result.models,['gemini-3.5-flash-lite','gemini-3.5-flash-lite']);
  assert.deepEqual(waits,[]);
});

test('persistent 503 failures stay bounded and are distinguished from bad credentials',async()=>{
  let calls=0; const waits=[];
  const service=new GeminiService({models:{generateContent:async()=>{
    calls++; throw Object.assign(new Error('secret provider URL'),{status:503});
  }}},{budget:null,wait:async ms=>waits.push(ms)});
  await assert.rejects(service.validateKey(),error=>{
    assert.equal(error.status,503);assert.match(error.message,/temporarily unavailable/);
    assert.doesNotMatch(error.message,/secret provider URL/);return true;
  });
  assert.equal(calls,4);assert.deepEqual(waits,[1000,2000]);
});

test('key validation route preserves temporary-service and quota status',async()=>{
  const original=geminiService.validateKey;
  const app=express();app.use('/api/searchfix',routes);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    for(const [providerStatus,expectedStatus] of [[503,503],[429,429],[403,422]]) {
      geminiService.validateKey=async()=>{throw Object.assign(new Error('Safe error'),{status:providerStatus,code:'GEMINI_REQUEST_FAILED'});};
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/searchfix/validate-key`,{method:'POST',headers:{'X-SearchFix-Gemini-Key':keyA}});
      assert.equal(response.status,expectedStatus);await response.json();
    }
  } finally {geminiService.validateKey=original;await new Promise(resolve=>server.close(resolve));}
});
