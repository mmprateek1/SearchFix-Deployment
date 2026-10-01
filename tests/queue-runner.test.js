import test from "node:test";
import assert from "node:assert/strict";
import { QueueRunner } from "../extension/queue-runner.js";

const origin = "https://tv.datatracetitle.com";
const task = id => ({ orderNumber: id, name: id, url: `${origin}/OrderOverview.aspx?PublicOrderId=${id}` });

function fixture({ fail = "", empty = false, popup = false } = {}) {
  let nextId = 1;
  const tabsMap = new Map([[99, { id: 99, url: `${origin}/Queues.aspx`, status: "complete" }]]);
  const events = [], results = [];
  const tabs = {
    async create({ url }) { const tab = { id: nextId++, url, status: "complete" }; tabsMap.set(tab.id, tab); return tab; },
    async get(id) { return tabsMap.get(id); },
    async query() { return [...tabsMap.values()]; },
    async update(id, { url }) { Object.assign(tabsMap.get(id), { url }); return tabsMap.get(id); },
    async remove(id) { events.push(["remove", id]); tabsMap.delete(id); }
  };
  const inject = async (tabId, fn, args) => {
    const tab = tabsMap.get(tabId);
    const id = new URL(tab.url).searchParams.get("PublicOrderId");
    events.push([fn.name, id, args]);
    if (fn.name === "readOrderPage") {
      if (id === "FAIL") throw new Error("Unreadable order");
      return { pageUrl: tab.url, orderNumber: id, comments: [{ author: "Client", date: "2026-09-25", time: "12:00", text: "Check deed against TA" }],
        attachments: [{ name: "Deed.pdf", url: `${origin}/WRONG-OVERVIEW.pdf` }] };
    }
    if (fn.name === "openSupportingLink") {
      if (args[0] === fail) throw new Error("Source unavailable");
      const url = `${origin}/${args[0]}.aspx?PublicOrderId=${id}`;
      if (popup) {
        const tab = await tabs.create({ url }); tab.openerTabId = tabId;
        return { opened: true };
      }
      return { url };
    }
    if (fn.name === "readSupportingView") {
      assert.equal(args[0], id);
      if (!tab.url.includes(`/${args[2]}.aspx`)) throw new Error("Wrong source window kind");
      if (args[2] === "ta") return { text: "Borrower: Synthetic", pageUrl: tab.url };
      return { pageUrl: tab.url, attachments: empty ? [] : [
        { name: "Deed.pdf", url: `${origin}/Deed.pdf`, pageUrl: tab.url },
        { name: "TAX.pdf", url: `${origin}/Tax.pdf`, pageUrl: tab.url },
        { name: "Typed report.pdf", url: `${origin}/TA.pdf`, pageUrl: tab.url }
      ] };
    }
    if (fn.name === "readAttachment") {
      assert.equal(args[0], `${origin}/Deed.pdf`);
      assert.match(tab.url, /attachments.aspx/);
      return { base64: btoa("%PDF-1.4 synthetic") };
    }
    throw new Error(`Unexpected injected function: ${fn.name}`);
  };
  const api = async (endpoint, body) => {
    events.push([endpoint, body]);
    if (endpoint === "analyze-comments") {
      if (body.orderNumber === "IGNORE") return { orderNumber: body.orderNumber, status: "IGNORED", overallDecision: "IGNORED", issues: [] };
      return { orderNumber: body.orderNumber, analysisId: "test-id", status: "AWAITING_DOCUMENTS", issues: [{ requiredFiles: [{ fileType: "DEED" }, { fileType: "TYPED_REPORT" }] }] };
    }
    const order = JSON.parse(body.get("orderData"));
    assert.equal(order.taText, fail === "ta" ? "" : "Borrower: Synthetic");
    assert.equal(body.get("fileType_file0"), empty || fail === "attachments" ? null : "DEED");
    const decision = !body.has("file0") || !order.taText ? "REVIEW_REQUIRED" : "ACCEPTED";
    return { orderNumber: order.orderNumber, status: decision, overallDecision: decision, issues: [] };
  };
  const runner = new QueueRunner({ tabs, inject, api, settings: {}, wait: async () => {}, onResult: result => results.push(result) });
  return { runner, events, results, tabsMap };
}

test("queue ignores, reviews failed orders, and continues using only matching attachment PDFs and TA text", async () => {
  const f = fixture();
  const result = await f.runner.run([task("IGNORE"), task("FAIL"), task("OK"), task("OK")]);
  assert.deepEqual(result.map(r => r.status), ["IGNORED", "REVIEW_REQUIRED", "ACCEPTED"]);
  assert.equal(f.events.filter(([name]) => name === "analyze-documents").length, 1);
  assert.equal(f.events.filter(([name]) => name === "openSupportingLink").length, 2);
  assert.equal(f.events.filter(([name]) => name === "readAttachment").length, 1);
  assert.deepEqual([...f.tabsMap.keys()], [99]);
});

test('comment-only Accepted and unmatched Review Required never open supporting views or call the document endpoint', async()=>{
  const f=fixture();
  f.runner.api=async(endpoint,body)=>{
    assert.equal(endpoint,'analyze-comments');
    const status=body.orderNumber==='FEE'?'ACCEPTED':'REVIEW_REQUIRED';
    return {orderNumber:body.orderNumber,status,overallDecision:status,issues:[]};
  };
  const results=await f.runner.run([task('FEE'),task('UNMATCHED')]);
  assert.deepEqual(results.map(r=>r.status),['ACCEPTED','REVIEW_REQUIRED']);
  assert.equal(f.events.filter(([name])=>['openSupportingLink','readSupportingView','readAttachment'].includes(name)).length,0);
});

test("number-prefixed evidence filenames download all mapped PDFs and TA only from its text source", async () => {
  const f = fixture();
  const oldInject = f.runner.inject;
  const names=['1280806404_Cost Work Sheet.pdf','1280806404_Pacer.pdf','1280806404_Search Package.pdf','1280806404_THR.pdf','1280806404_Patriot.pdf','1280806404_Index Snapshot.pdf','1280806404_Typed Report.pdf'];
  const downloads=[]; const states=[];
  f.runner.onOrderState=(task,state)=>states.push(state);
  f.runner.inject=async(tabId,fn,args)=>{
    if(fn.name==='readSupportingView' && args[2]==='attachments') return {pageUrl:f.tabsMap.get(tabId).url,attachments:names.map(name=>({name,url:`${origin}/${encodeURIComponent(name)}`}))};
    if(fn.name==='readAttachment'){downloads.push(decodeURIComponent(args[0]));return {base64:btoa('%PDF-1.4 synthetic')};}
    return oldInject(tabId,fn,args);
  };
  f.runner.api=async(endpoint,body)=>{
    if(endpoint==='analyze-comments')return {orderNumber:body.orderNumber,status:'AWAITING_DOCUMENTS',issues:[{requiredFiles:['PACER','PATRIOT','TYPED_REPORT','SEARCH_PACKAGE','INDEX'].map(fileType=>({fileType}))}]};
    assert.equal(downloads.length,4);
    assert.equal(JSON.parse(body.get('orderData')).taText,'Borrower: Synthetic');
    assert.deepEqual([...body.entries()].filter(([k])=>k.startsWith('fileType')).map(([,v])=>v).sort(),['INDEX','PACER','PATRIOT','SEARCH_PACKAGE']);
    return {orderNumber:'PREFIX',status:'ACCEPTED'};
  };
  await f.runner.run([task('PREFIX')]);
  assert.deepEqual(states,['PROCESSING','ACCEPTED']);
  assert.ok(downloads.every(x=>!/(Cost|THR|Typed)/.test(x)));
});

test("missing attachments and unavailable TA return review and still process the next order", async () => {
  for (const options of [{ empty: true }, { fail: "ta" }, { fail: "attachments" }]) {
    const f = fixture(options);
    const result = await f.runner.run([task("ONE"), task("TWO")]);
    assert.deepEqual(result.map(r => r.status), ["REVIEW_REQUIRED", "REVIEW_REQUIRED"]);
    assert.equal(f.events.filter(([name]) => name === "analyze-documents").length, 2);
    assert.deepEqual([...f.tabsMap.keys()], [99]);
  }
});

test('source collection waits for delayed attachment rows and traces the evidence workflow', async()=>{
  const f=fixture(),inject=f.runner.inject,events=[];
  let attachmentReads=0;
  f.runner.log=(event,details)=>events.push([event,details]);
  f.runner.inject=async(tab,fn,args)=>{
    const result=await inject(tab,fn,args);
    if(fn.name==='readSupportingView'&&args[2]==='attachments'&&++attachmentReads<3)return {...result,attachments:[]};
    return result;
  };
  assert.equal((await f.runner.run([task('DELAYED')]))[0].status,'ACCEPTED');
  for(const event of ['source.resolve.complete','source.content.wait','source.read.complete','attachments.selected','pdf.download.start','pdf.download.complete','evidence.submit','order.complete','queue.cleanup.complete'])assert.ok(events.some(([name])=>name===event),event);
  assert.deepEqual([...f.tabsMap.keys()],[99]);
});

test("JavaScript source links are followed to their newly opened same-order popup", async () => {
  const f = fixture({ popup: true });
  const result = await f.runner.run([task("POPUP")]);
  assert.equal(result[0].status, "ACCEPTED");
  assert.deepEqual([...f.tabsMap.keys()], [99]);
});

test("an unrelated tab opened during source discovery is never closed", async () => {
  const f = fixture({ popup: true });
  const original = f.runner.inject;
  f.runner.inject = async (...args) => {
    const result = await original(...args);
    if (args[1].name === "openSupportingLink") {
      f.tabsMap.set(77, { id: 77, url: `${origin}/OrderOverview.aspx?PublicOrderId=UNRELATED`, openerTabId: 99, status: "complete" });
    }
    return result;
  };
  assert.equal((await f.runner.run([task("POPUP")]))[0].status, "ACCEPTED");
  assert.deepEqual([...f.tabsMap.keys()], [99, 77]);
});

test("stop finishes the current order and closes only runner-owned tabs", async () => {
  const f = fixture();
  f.runner.onResult = () => f.runner.stop();
  const result = await f.runner.run([task("IGNORE"), task("NEXT")]);
  assert.equal(result.length, 1);
  assert.deepEqual([...f.tabsMap.keys()], [99]);
});

test("wrong-order navigation and changed comments fail closed without evidence submission", async () => {
  const f = fixture();
  const result = await f.runner.run([{ ...task("RIGHT"), orderNumber: "WRONG" }]);
  assert.equal(result[0].status, "REVIEW_REQUIRED");
  assert.ok(!f.events.some(([name]) => name === "analyze-comments"));
  const g = fixture();
  let reads = 0;
  const original = g.runner.inject;
  g.runner.inject = async (...args) => {
    const value = await original(...args);
    if (args[1].name === "readOrderPage" && ++reads > 1) value.comments[0].text = "Changed";
    return value;
  };
  const changed = await g.runner.run([task("RIGHT")]);
  assert.equal(changed[0].status, "REVIEW_REQUIRED");
  assert.ok(!g.events.some(([name]) => name === "analyze-documents"));
});

test('chosen comment appears before downloads; failed document requests preserve it and truthful file states',async()=>{
 const f=fixture(),events=[];
 const originalApi=f.runner.api;
 const commentAnalysis={selectedComment:{author:'Synthetic_Outsource',text:'Original synthetic request',role:'CLIENT'},contextCommentsUsed:[],selectionReason:'Latest meaningful request',roleReason:'Client'};
 f.runner.api=async(endpoint,body)=>{
  if(endpoint==='analyze-documents'){events.push('document-request');throw Error('Synthetic outage');}
  return {...await originalApi(endpoint,body),commentAnalysis};
 };
 f.runner.onAnalysis=result=>{assert.deepEqual(result.commentAnalysis,commentAnalysis);events.push('chosen');};
 f.runner.onDocuments=docs=>events.push(docs.map(d=>d.status).join(','));
 const [result]=await f.runner.run([task('ONLY-ONE')]);
 assert.equal(result.status,'REVIEW_REQUIRED');assert.deepEqual(result.commentAnalysis,commentAnalysis);
 assert.equal(events[0],'chosen');assert.ok(events.includes('FOUND,DOWNLOADED'));assert.ok(events.includes('ANALYZING,ANALYZING'));
 assert.equal(events.at(-1),'document-request');assert.ok(result.documents.every(d=>d.status==='UNVERIFIED'));
 assert.equal(f.results.length,1);assert.deepEqual([...f.tabsMap.keys()],[99]);
});
