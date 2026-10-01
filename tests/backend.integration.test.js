import {selection} from './helpers/selection.js';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { geminiService } from "../src/services/gemini.service.js";
import { analyzeCommentsController, analyzeDocumentsController } from "../src/controllers/searchfix.controller.js";
import { decisionEngine } from "../src/services/decision.service.js";
import express from "express";
import routes from "../src/routes/searchfix.routes.js";

const order = {orderNumber:"SYNTHETIC-TEST",comments:[{author:"Client",date:"2026-09-24",time:"11:00",text:"Please check the typed borrower name against the deed."}]};
function response() { return {statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}; }

test("comments and TA text complete the two-step controller workflow with mocked AI", async () => {
  const originalJSON = geminiService.generateJSON;
  const originalFiles = geminiService.generateContentWithFiles;
  geminiService.generateJSON = async (system) => system.includes("classification") ? selection([{issueType:"TYPING_ERROR",claim:"Verify the typed borrower name against the deed."}]) : {decision:"REVIEW_REQUIRED",reason:"TA text is available but the deed was not supplied."};
  geminiService.generateContentWithFiles = async (_system, _prompt, parts) => {
    assert.ok(parts.some(p => p.text?.includes("Synthetic Borrower")));
    return {evidence:[{document:"Typing Assistant text",page:7,finding:"TA lists Synthetic Borrower",quotedText:"Synthetic Borrower"}]};
  };
  try {
    const step1 = response(); await analyzeCommentsController({body:order},step1);
    assert.equal(step1.statusCode,200); assert.equal(step1.body.status,"AWAITING_DOCUMENTS");
    assert.ok(step1.body.issues[0].requiredFiles.some(f=>f.fileType==="TYPED_REPORT"));
    const step2 = response();
    await analyzeDocumentsController({body:{orderData:JSON.stringify({...order,analysisId:step1.body.analysisId,taText:"Borrower: Synthetic Borrower"})},files:[]},step2);
    assert.equal(step2.statusCode,200); assert.equal(step2.body.overallDecision,"REVIEW_REQUIRED");
    assert.equal(step2.body.issues[0].evidence[0].page,null);
    assert.equal(step2.body.analysisId,step1.body.analysisId);
  } finally {geminiService.generateJSON=originalJSON;geminiService.generateContentWithFiles=originalFiles;}
});
test("an AI outage returns a failure instead of a misleading successful explanation", async () => {
  const original = geminiService.generateJSON;
  geminiService.generateJSON = async () => {throw new Error("Simulated outage");};
  try {const res=response(); await analyzeCommentsController({body:order},res); assert.equal(res.statusCode,500); assert.ok(res.body.error);}
  finally {geminiService.generateJSON=original;}
});
test("malformed multipart input cleans up uploaded temporary files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"searchfix-test-"));
  const file = path.join(dir,"sample.pdf"); fs.writeFileSync(file,"%PDF-1.4");
  try {
    const res=response(); await analyzeDocumentsController({body:{orderData:"{"},files:[{path:file}]},res);
    assert.equal(res.statusCode,400); assert.equal(fs.existsSync(file),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("processing errors cannot be submitted to the decision model as factual evidence", async () => {
  const res=await decisionEngine.evaluateIssueDecision({requiredDocuments:["DEED"]},[{field:"documentAnalysisStatus",value:"Processing Error"}]);
  assert.equal(res.decision,"REVIEW_REQUIRED");
});

test("HTTP multipart TA-only requests work through both document routes", async () => {
  const originalJSON=geminiService.generateJSON, originalFiles=geminiService.generateContentWithFiles;
  geminiService.generateJSON=async(system)=>system.includes("classification") ? selection([{issueType:"TYPING_ERROR",claim:"Verify typed name"}]) : {decision:"REVIEW_REQUIRED",reason:"Deed not supplied."};
  geminiService.generateContentWithFiles=async()=>({evidence:[{document:"Typing Assistant text",page:null,finding:"Synthetic name shown"}]});
  const app=express();app.use(express.json());app.use("/api/searchfix",routes);
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  try {
    for(const endpoint of ["analyze-documents","analyze"]){
      const form=new FormData();form.append("orderData",JSON.stringify({...order,taText:"Synthetic Borrower"}));
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/searchfix/${endpoint}`,{method:"POST",headers:{"X-SearchFix-Gemini-Key":"TEST_KEY_12345678901234567890"},body:form});
      assert.equal(response.status,200);assert.equal((await response.json()).overallDecision,"REVIEW_REQUIRED");
    }
  } finally {await new Promise(resolve=>server.close(resolve));geminiService.generateJSON=originalJSON;geminiService.generateContentWithFiles=originalFiles;}
});
