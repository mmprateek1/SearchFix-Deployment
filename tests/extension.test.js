import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backendURL, guessDocumentType, requiredTypes, validateOrder, buildAssistantText, DOCUMENT_TYPES } from "../extension/core.js";
import { DOCUMENT_TYPES as BACKEND_TYPES } from "../src/config/documentMappings.js";
import { readAttachment } from "../extension/page-reader.js";

test("extension file types stay compatible with backend", () => assert.deepEqual(DOCUMENT_TYPES, BACKEND_TYPES));
test("backend credentials and remote destinations cannot be configured accidentally", () => {
  assert.equal(backendURL("http://localhost:3000/", "http://localhost:3000"), "http://localhost:3000");
  for (const value of ["https://example.com", "http://localhost:3000@evil.test", "http://user:pass@localhost:3000", "http://localhost:3000/api", "http://localhost:3000?token=x"]) assert.throws(() => backendURL(value));
});
test("ambiguous attachment names are not silently treated as search packages", () => {
  assert.equal(guessDocumentType("file-90210.pdf"), "");
  assert.equal(guessDocumentType("deed-of-trust.pdf"), "DOT");
  assert.equal(guessDocumentType("THR.pdf"), "THR");
  assert.equal(guessDocumentType("typed_report.pdf"), "TYPED_REPORT");
  assert.equal(guessDocumentType("Patriot.pdf"), "PATRIOT");
});
test("required documents deduplicate across multiple claims", () => {
  assert.deepEqual(requiredTypes({issues:[{requiredFiles:[{fileType:"DEED"}]},{requiredFiles:[{fileType:"DEED"},{fileType:"TAX"}]}]}), ["DEED","TAX"]);
});
test("missing authors or timestamps cannot lead to silently misordered comments", () => {
  const order = {orderNumber:" TEST-1 ", comments:[{author:"Client", date:"2026-09-24", time:"13:15", text:"Please provide the deed."}]};
  assert.equal(validateOrder(order).orderNumber, "TEST-1");
  assert.throws(() => validateOrder({...order, comments:[{text:"x"}]}));
  assert.throws(() => validateOrder({...order, comments:[{...order.comments[0],date:"09/24/26"}]}));
});
test("assistant notes distinguish internal routing and unverified requests from evidence", () => {
  assert.match(buildAssistantText({orderNumber:"TEST",status:"IGNORED",issues:[],commentAnalysis:{selectedComment:{role:"INTERNAL",text:"ETA pending"}}}), /No supporting documents were analyzed/);
  assert.match(buildAssistantText({orderNumber:"TEST",status:"AWAITING_DOCUMENTS",issues:[]}), /not yet been verified/);
  assert.match(buildAssistantText({orderNumber:"TEST",issues:[{clientClaim:"Check deed",evidence:[{document:"Deed.pdf",page:3,finding:"Name differs",quotedText:"Jane Doe"}]}]}), /Deed.pdf, page 3/);
});
test("manifest only grants site and local backend access", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("debugger"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});
test("attachment reader rejects cross-origin, stale, and non-PDF responses", async () => {
  const savedLocation = globalThis.location;
  const savedFetch = globalThis.fetch;
  globalThis.location = {href:"https://tv.datatracetitle.com/order",origin:"https://tv.datatracetitle.com"};
  let requests = 0;
  globalThis.fetch = async (_url, options) => { requests++; assert.equal(options.method,"GET"); assert.equal(options.redirect,"error"); return new Response("<html>Login</html>"); };
  try {
    await assert.rejects(readAttachment("https://evil.test/a.pdf",location.href), /Only attachments/);
    await assert.rejects(readAttachment("https://tv.datatracetitle.com/a.pdf","old-page"), /changed/);
    assert.equal(requests,0);
    await assert.rejects(readAttachment("https://tv.datatracetitle.com/a.pdf",location.href), /not a PDF/);
    globalThis.fetch = async () => new Response("%PDF-1.4\ntest");
    assert.equal(atob((await readAttachment("https://tv.datatracetitle.com/a.pdf",location.href)).base64),"%PDF-1.4\ntest");
  } finally {globalThis.location = savedLocation; globalThis.fetch = savedFetch;}
});

test('PDF reader maps viewer navigation to the supplied authenticated PDF endpoint and reports failures safely', async()=>{
  const originalLocation=globalThis.location, originalFetch=globalThis.fetch;
  globalThis.location={href:'https://tv.datatracetitle.com/Orders/attachment/Manager/test',origin:'https://tv.datatracetitle.com'};
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const viewer=`${location.origin}/AttachmentViewer.aspx?PublicAttachmentId=${id}`;
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push(url);assert.equal(url,`${location.origin}/attachment.ashp?publicAttachmentId=${id}`);
    assert.equal(options.credentials,'same-origin');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    return new Response('%PDF-1.4\nsynthetic bytes');
  };
  try {
    const result=await readAttachment(viewer,location.href);
    assert.equal(atob(result.base64),'%PDF-1.4\nsynthetic bytes');
    assert.equal(requests.length,1);
    await assert.rejects(readAttachment(viewer+'&PublicAttachmentId='+id,location.href),/one valid file/);
    assert.equal(requests.length,1);
    for(const [response,expectedCode] of [[new Response('sign in',{status:401}),'PDF_HTTP_ERROR'],[new Response('<html>sign in</html>'),'PDF_CONTENT_INVALID'],[new Response('%PDF-x',{headers:{'content-length':String(21*1024*1024)}}),'PDF_SIZE_LIMIT']]) {
      globalThis.fetch=async()=>response;
      assert.equal((await readAttachment(viewer,location.href,true)).errorCode,expectedCode);
    }
    globalThis.fetch=async()=>{throw new TypeError('PRIVATE SESSION URL');};
    const error=await readAttachment(viewer,location.href,true);
    assert.equal(error.errorCode,'PDF_NETWORK_OR_REDIRECT');assert.doesNotMatch(JSON.stringify(error),/PRIVATE SESSION/);
  } finally {globalThis.location=originalLocation;globalThis.fetch=originalFetch;}
});
