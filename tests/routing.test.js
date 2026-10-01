import test from "node:test";
import assert from "node:assert/strict";
import { geminiService, modelFor } from "../src/services/gemini.service.js";
import { commentSelectionService } from "../src/services/commentSelection.service.js";
import { analyzeCommentsController, analyzeDocumentsController } from "../src/controllers/searchfix.controller.js";
import { getRequiredDocumentTypes, DOCUMENT_TYPES } from "../src/config/documentMappings.js";
import { classifyUserRole } from "../src/config/users.js";
import { buildAssistantText } from "../extension/core.js";

geminiService.budget = null; // Provider-only fixtures; budget integration has dedicated tests.

const comment = (author, text, time = "12:00") => ({ author, text, time, date: "2026-09-25" });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("ADSSearchType ignores the order before Gemini, including suspend and logout", async () => {
  const original = geminiService.generateJSON;
  geminiService.generateJSON = async () => { throw new Error("Ignored author must not call Gemini"); };
  try {
    for (const text of ["ETA pending", "SUSPEND: Product", "User Logged off system"]) {
      const order = { orderNumber: "TEST-1", comments: [comment("user_adssearchtype", text), comment("RVSI-Outsource: Client", "Missing deed", "11:00")] };
      for (const controller of [analyzeCommentsController, analyzeDocumentsController]) {
        const res = response(); await controller({ body: order, files: [] }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "IGNORED");
        assert.equal(res.body.overallDecision, "IGNORED");
        assert.deepEqual(res.body.issues, []);
        assert.match(buildAssistantText(res.body), /Order ignored/);
      }
    }
  } finally { geminiService.generateJSON = original; }
});

test("newer client complaints survive older internal history; system events still trace backward", () => {
  const result = commentSelectionService.selectSearchFixComment([
    comment("OWLServiceUser", "SUSPEND: Full title", "13:00"),
    comment("RVSI_outsource: Client", "The deed has the wrong name"),
    comment("Searcher_ADSSearchType", "ETA pending", "11:00")
  ]);
  assert.equal(result.selectedComment.author, "RVSI_outsource: Client");
  assert.equal(result.ignoreReason, undefined);
  assert.equal(classifyUserRole("rvsi_outsource: User"), "CLIENT");
});

test("RVSI fee and abstractor ETA requests finish Disputed without evidence", async () => {
  const original = geminiService.generateJSON;
  const examples = [
    'Outbound: "101-10925203: Full Title, Morgan, OH: Good Afternoon, The subject property consists of 2 parcels that have separate back chains. Can you please provide your fee approval for the additional parcel / chain to proceed with this order? The total fee is $351.00 ($175.50 x 2 = $351.00). Thank you."',
    "PER PARTNER: We have submitted a rush request with the abstractor, and we have requested the current status and ETA from the abstractor and are awaiting their response. We will get back to you with more information once we receive it."
  ];
  geminiService.generateJSON = async (system, prompt) => {
    assert.match(system, /FEE_APPROVAL_REQUEST/);
    assert.ok(examples.some(text => prompt.includes(text)));
    return { disposition: "IGNORED", ignoreReason: "Operational fee or ETA update only.", issues: [] };
  };
  try {
    for (const [index, text] of examples.entries()) {
      const order = { orderNumber: "TEST", comments: [comment(index ? "RVSI_outsource: melodyl" : "RVSI-Outsource: caran", text)] };
      for (const controller of [analyzeCommentsController, analyzeDocumentsController]) {
        const res = response(); await controller({ body: order, files: [] }, res);
        assert.equal(res.body.status, "DISPUTED"); assert.equal(res.statusCode, 200);
      }
    }
  } finally { geminiService.generateJSON = original; }
});

test("mixed complaints and non-RVSI authors cannot disappear via an ignored disposition", async () => {
  const original = geminiService.generateJSON;
  try {
    for (const [author, issues] of [["Client", []], ["RVSI-Outsource: client", [{ issueType: "MISSING_DEED", claim: "Deed missing despite ETA update" }]]]) {
      geminiService.generateJSON = async () => ({ disposition: "IGNORED", ignoreReason: "ETA", issues });
      const res = response(); await analyzeCommentsController({ body: { orderNumber: "TEST", comments: [comment(author, "ETA pending; deed missing")] } }, res);
      assert.equal(res.body.status, issues.length ? "AWAITING_DOCUMENTS" : "REVIEW_REQUIRED"); assert.equal(Boolean(res.body.issues.length), Boolean(issues.length));
    }
  } finally { geminiService.generateJSON = original; }
});

test("model routing separates comments from document extraction and evidence decisions", async () => {
  const saved = { comment: process.env.GEMINI_COMMENT_MODEL, document: process.env.GEMINI_DOCUMENT_MODEL, legacy: process.env.GEMINI_MODEL };
  const original = geminiService.defaultClient;
  try {
    delete process.env.GEMINI_COMMENT_MODEL; delete process.env.GEMINI_DOCUMENT_MODEL;
    process.env.GEMINI_MODEL = "obsolete-model";
    const calls = [];
    geminiService.ai = { models: { generateContent: async request => { calls.push(request.model); return { text: "{}" }; } } };
    await geminiService.generateJSON("system", "comments");
    await geminiService.generateContentWithFiles("system", "documents", []);
    await geminiService.generateJSON("system", "evidence decision", "documents");
    assert.deepEqual(calls, ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash"]);
    geminiService.ai.models.generateContent = async request => { calls.push(request.model); throw new Error("Model unavailable for this account"); };
    await assert.rejects(geminiService.generateJSON("system", "comment"), /Gemini request failed/);
    assert.equal(calls.length, 4);
    process.env.GEMINI_COMMENT_MODEL = "comment-override"; process.env.GEMINI_DOCUMENT_MODEL = "document-override";
    assert.equal(modelFor(), "gemini-3.5-flash-lite"); assert.equal(modelFor("documents"), "gemini-3.5-flash");
  } finally {
    geminiService.ai = original;
    for (const [name, value] of [["GEMINI_COMMENT_MODEL", saved.comment], ["GEMINI_DOCUMENT_MODEL", saved.document], ["GEMINI_MODEL", saved.legacy]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("empty or incomplete supporting files produce Review Required even if AI would accept", async () => {
  const originalJSON = geminiService.generateJSON, originalFiles = geminiService.generateContentWithFiles;
  geminiService.generateJSON = async system => system.includes("classification")
    ? { issues: [{ issueType: "TYPING_ERROR", claim: "Wrong borrower" }] }
    : { decision: "ACCEPTED", reason: "Should not decide incomplete evidence" };
  geminiService.generateContentWithFiles = async () => ({ evidence: [{ document: "Typing Assistant text", finding: "Borrower appears", page: null }] });
  try {
    for (const taText of ["", "Borrower: Synthetic"]) {
      const res = response();
      await analyzeDocumentsController({ body: { orderNumber: "TEST", comments: [comment("Client", "Wrong borrower")], taText }, files: [] }, res);
      assert.equal(res.body.status, "REVIEW_REQUIRED");
      assert.equal(res.body.issues[0].decision, "REVIEW_REQUIRED");
      assert.match(res.body.issues[0].reason, /DEED/);
    }
  } finally { geminiService.generateJSON = originalJSON; geminiService.generateContentWithFiles = originalFiles; }
});

test("existing TA and INDEX mappings resolve to supported evidence types without duplicates", () => {
  for (const issue of ["VESTING_DISCREPANCY", "SEARCH_DEPTH", "NAME_SEARCH_MISSING"]) {
    const types = getRequiredDocumentTypes(issue);
    assert.ok(types.every(type => DOCUMENT_TYPES.includes(type)));
    assert.equal(new Set(types).size, types.length);
  }
});

test("document stage reuses the comment classification and rejects changed or expired sessions", async () => {
  const original = geminiService.generateJSON;
  let calls = 0;
  geminiService.generateJSON = async () => { calls++; return { issues: [{ issueType: "MISSING_DEED", claim: "Deed missing" }] }; };
  try {
    const order = { orderNumber: "SESSION", comments: [comment("Client", "Deed missing")] };
    const step1 = response(); await analyzeCommentsController({ body: order }, step1);
    const step2 = response(); await analyzeDocumentsController({ body: { ...order, analysisId: step1.body.analysisId }, files: [] }, step2);
    assert.equal(step2.statusCode, 200); assert.equal(calls, 1);
    for (const body of [{ ...order, analysisId: "unknown-id" },
      { ...order, comments: [comment("Client", "Changed complaint")], analysisId: step1.body.analysisId }]) {
      const res = response(); await analyzeDocumentsController({ body, files: [] }, res);
      assert.equal(res.statusCode, 409);
    }
    assert.equal(calls, 1);
  } finally { geminiService.generateJSON = original; }
});
