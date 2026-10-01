import test from 'node:test';
import assert from 'node:assert/strict';
import {selection} from './helpers/selection.js';
import {geminiService} from '../src/services/gemini.service.js';
import {issueClassificationService} from '../src/services/issueClassification.service.js';
import {analyzeCommentsController,analyzeDocumentsController} from '../src/controllers/searchfix.controller.js';
import {recentCommentCandidates} from '../src/services/commentSelection.service.js';
const c=(author,text,time='12:00')=>({author,text,time,date:'2026-10-01'});
const issue={issueType:'MISSING_DEED',claim:'The deed is missing.'};
const res=()=>({status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
async function mockAI(answer,run){const original=geminiService.generateJSON;let calls=0;geminiService.generateJSON=async(...args)=>{calls++;return typeof answer==='function'?answer(...args):answer;};try{await run(()=>calls);}finally{geminiService.generateJSON=original;}}

test('all comments reach the backend; only the newest 15 reach AI without author or keyword filtering',async()=>{
 const comments=Array.from({length:20},(_,i)=>c(i%2?'Test_ADS':'Test_Outsource',i%2?'SUSPEND: synthetic':'Synthetic request',`12:${String(i).padStart(2,'0')}`));
 const expected=comments.slice(5).reverse();
 assert.deepEqual(recentCommentCandidates(comments).map(({id,sourceIndex,...original})=>original),expected);
 await mockAI((system,prompt)=>{
  for(const comment of expected)assert.ok(prompt.includes(comment.time));
  assert.ok(!prompt.includes('12:04'));
  return selection([issue],{selectedCommentId:'C19'});
 },async()=>{
  const result=await issueClassificationService.analyzeComments(comments);
  assert.equal(result.commentAnalysis.totalComments,20);assert.equal(result.commentAnalysis.consideredComments,15);
  assert.equal(result.commentAnalysis.selectedComment.text,comments[18].text);
  assert.equal(result.commentAnalysis.selectedComment.id,'C19');
 });
});

test('AI can choose a client beneath a newer internal system entry, preserving original text',async()=>{
 const comments=[c('Test_ADS','SUSPEND: synthetic','13:00'),c('Test_ADS_Outsource','Exact original: deed missing, please check.','12:00')];
 await mockAI(selection([issue],{selectedCommentId:'C2',contextCommentIds:['C1'],roleReason:'Outsource context is a client request despite ADS in the name.'}),async()=>{
  const result=await issueClassificationService.analyzeComments(comments);
  assert.equal(result.terminal,undefined);assert.equal(result.commentAnalysis.selectedComment.text,comments[1].text);
  assert.equal(result.commentAnalysis.selectedComment.role,'CLIENT');assert.equal(result.commentAnalysis.contextCommentsUsed[0].text,comments[0].text);
 });
});

test('AI-selected internal comments are ignored after selection, without any document call',async()=>{
 const original=geminiService.generateContentWithFiles;geminiService.generateContentWithFiles=async()=>{throw Error('Must not inspect files');};
 try{await mockAI(selection([],{selectedRole:'INTERNAL',disposition:'IGNORED',reason:'Our team has already responded.'}),async calls=>{
  for(const controller of [analyzeCommentsController,analyzeDocumentsController]){
   const response=res();await controller({body:{orderNumber:'SYNTHETIC',comments:[c('ADS_Outsource','Internal response')]},files:[]},response);
   assert.equal(response.statusCode,200);assert.equal(response.body.status,'IGNORED');assert.deepEqual(response.body.issues,[]);assert.deepEqual(response.body.documents,[]);
  }assert.equal(calls(),2);
 });}finally{geminiService.generateContentWithFiles=original;}
});

test('AI-classified client operational tasks are Accepted with next action and no document requests',async()=>{
 await mockAI(selection([],{disposition:'TASK_ACCEPTED',reason:'Client requests a fee approval.',nextSteps:['Request approval from the authorized coordinator.']}),async()=>{
  const response=res();await analyzeCommentsController({body:{orderNumber:'SYNTHETIC',comments:[c('Outsource','Please approve the additional fee.')] }},response);
  assert.equal(response.body.status,'ACCEPTED');assert.equal(response.body.decisionBasis,'CLIENT_TASK');assert.equal(response.body.nextSteps.length,1);assert.deepEqual(response.body.issues,[]);
 });
});

test('invented IDs, roles, context, unsupported issues and contradictory routes require review',async()=>{
 const examples=[selection([issue],{selectedCommentId:'C99'}),selection([],{selectedCommentId:null,reason:'No actionable request.'}),selection([issue],{selectedRole:'UNKNOWN'}),selection([issue],{contextCommentIds:['C99']}),selection([{issueType:'OTHER',claim:'Unknown'}]),selection([issue],{disposition:'TASK_ACCEPTED'}),selection([], {disposition:'TASK_ACCEPTED',nextSteps:[]}),selection([issue],{selectedRole:'CLIENT',disposition:'IGNORED'})];
 for(const answer of examples)await mockAI(answer,async()=>{const result=await issueClassificationService.analyzeComments([c('Outsource','Synthetic request')]);assert.equal(result.terminal,'REVIEW_REQUIRED');assert.deepEqual(result.issues,[]);});
});

test('AI cannot select a comment outside the latest 15 and missing chronology needs review',async()=>{
 const comments=Array.from({length:16},(_,i)=>c('Outsource','Synthetic',`12:${String(i).padStart(2,'0')}`));
 await mockAI(selection([issue],{selectedCommentId:'C1'}),async()=>assert.equal((await issueClassificationService.analyzeComments(comments)).terminal,'REVIEW_REQUIRED'));
 await mockAI(()=>{throw Error('Unknown chronology should not be guessed');},async()=>assert.equal((await issueClassificationService.analyzeComments([{author:'Outsource',text:'Synthetic'}])).terminal,'REVIEW_REQUIRED'));
});
