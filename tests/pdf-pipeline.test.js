import {selection} from './helpers/selection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createApp} from '../src/app.js';
import {geminiService} from '../src/services/gemini.service.js';
import {readAttachment} from '../extension/page-reader.js';

test('PDF stream reaches multipart upload and the document model with TA and the saved comment analysis',async()=>{
  const originalJSON=geminiService.generateJSON,originalFiles=geminiService.generateContentWithFiles;
  const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(70000,65)]);
  let documentCalls=0;
  geminiService.generateJSON=async(_system,_user,stage)=>stage==='documents'
    ? {decision:'ACCEPTED',reason:'Synthetic evidence supports the claim.'}
    : selection([{issueType:'SEARCH_PACKAGE_DISCREPANCY',claim:'Search Package has the wrong name; compare with TA.'}]);
  geminiService.generateContentWithFiles=async(_system,_user,parts)=>{
    documentCalls++;
    const pdfPart=parts.find(part=>part.inlineData)?.inlineData;
    assert.equal(pdfPart.mimeType,'application/pdf');
    assert.deepEqual(Buffer.from(pdfPart.data,'base64'),pdf);
    assert.ok(parts.some(part=>part.text?.includes('SYNTHETIC TA CONTENT')));
    return {evidence:[{document:'999_Search Package.pdf',page:1,field:'name',value:'Synthetic',finding:'Synthetic evidence.'}]};
  };
  const app=createApp();
  const fileId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  app.get('/attachment.ashp',(req,res)=>{
    assert.equal(req.query.publicAttachmentId,fileId);
    res.type('application/pdf').send(pdf);
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const pageUrl=origin+'/Orders/attachment/Manager/synthetic';
  const reader=vm.runInNewContext(`(${readAttachment.toString()})`,{URL,URLSearchParams,location:new URL(pageUrl),fetch,AbortSignal,TextDecoder,Uint8Array,btoa});
  const headers={'X-SearchFix-Gemini-Key':'TEST_PDF_PIPELINE_KEY_12345678901234567890'};
  try {
    const order={orderNumber:'SYNTHETIC',comments:[{author:'Client',date:'2026-09-28',time:'10:00:00',text:'Please approve the additional fee. Search Package has the wrong name; compare with TA.'}]};
    const commentResponse=await fetch(origin+'/api/searchfix/analyze-comments',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(order)});
    assert.equal(commentResponse.status,200);
    const commentResult=await commentResponse.json();
    assert.equal(commentResult.status,'AWAITING_DOCUMENTS');
    assert.equal(commentResult.issues.length,1);
    const downloaded=await reader(origin+`/AttachmentViewer.aspx?PublicAttachmentId=${fileId}`,pageUrl);
    assert.equal(downloaded.size,pdf.length);
    const form=new FormData();
    form.append('orderData',JSON.stringify({...order,analysisId:commentResult.analysisId,taText:'SYNTHETIC TA CONTENT'}));
    form.append('file0',new Blob([Buffer.from(downloaded.base64,'base64')],{type:'application/pdf'}),'999_Search Package.pdf');
    form.append('fileType_file0','SEARCH_PACKAGE');
    const response=await fetch(origin+'/api/searchfix/analyze-documents',{method:'POST',headers,body:form});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.overallDecision,'ACCEPTED');
    assert.equal(result.issues[0].decision,'ACCEPTED');
    assert.deepEqual(result.documents.map(d=>d.status),['ANALYZED','UNVERIFIED']);
    assert.equal(result.issues[0].evidence[0].document,'999_Search Package.pdf');
    assert.equal(documentCalls,1);
  } finally {await new Promise(resolve=>server.close(resolve));geminiService.generateJSON=originalJSON;geminiService.generateContentWithFiles=originalFiles;}
});
