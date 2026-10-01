// Local browser preview only. No production website or AI calls are made.
for (const eventName of ['error', 'unhandledrejection']) {
  window.addEventListener(eventName, event => {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'alert');
    notice.textContent = `Demo error: ${event.message || event.reason?.message || 'Unable to initialize preview'}`;
    document.body.append(notice);
  });
}
const origin = 'https://tv.datatracetitle.com';
const makeOrder = id => ({ pageUrl: `${origin}/OrderOverview.aspx?PublicOrderId=${id}`, orderNumber: id,
  comments: [{ author: id === 'IGNORED-ORDER' ? 'Test_ADSSearchType' : 'Test_Outsource', date: '2026-09-24', time: '09:14:00', text: id==='TASK-ORDER'?'Please request a rush ETA from the abstractor.':'Please confirm the borrower name in TA against the deed and provide the missing deed.' }],
  tasks: [], queueLinks: [], overviewLinks: [], attachments: [], warnings: ['Synthetic preview: no live orders or AI requests.'], taStatus: 'Typing Assistant · Read-only source' });
const order = makeOrder('SYNTHETIC-1');
const tasks = ['IGNORED-ORDER','SYNTHETIC-1','DISPUTED-ORDER','MISSING-ORDER','TASK-ORDER'].map(id => ({name:id,orderNumber:id,url:makeOrder(id).pageUrl}));
let nextId = 2;
const tabs = new Map([[1,{id:1,url:order.pageUrl,status:'complete',title:'Synthetic order'}]]);
const session = {};
window.chrome = {
  storage: { local: { get:async()=>({}), set:async()=>{} }, session: {
    get:async key=>({[key]:session[key]}), set:async values=>Object.assign(session,values), remove:async key=>{delete session[key];}
  } },
  tabs: {
    query:async options => options.active ? [tabs.get(1)] : [...tabs.values()],
    get:async id => tabs.get(id),
    create:async ({url}) => {const tab={id:nextId++,url,status:'complete'};tabs.set(tab.id,tab);return tab;},
    update:async (id,values) => Object.assign(tabs.get(id),values),
    remove:async id => tabs.delete(id),
    onActivated:{addListener(){}},onUpdated:{addListener(){}}
  },
  scripting: { executeScript: async ({target,func,args}) => {
    const tab=tabs.get(target.tabId),id=new URL(tab.url).searchParams.get('PublicOrderId');
    let result;
    if(func.name==='readOrderPage') result={...makeOrder(id),tasks:target.tabId===1?tasks:[]};
    else if(func.name==='openSupportingLink') result={url:`${origin}/${args[0]}.aspx?PublicOrderId=${id}`};
    else if(func.name==='readSupportingView') result=args[2]==='ta'?{text:'Borrower: Synthetic Borrower',pageUrl:tab.url}:{attachments:id==='MISSING-ORDER'?[]:[{name:'Deed.pdf',url:`${origin}/Deed.pdf`,pageUrl:tab.url}],pageUrl:tab.url};
    else if(func.name==='readAttachment') result={base64:btoa('%PDF-1.4 synthetic')};
    else throw new Error(`Unexpected preview function ${func.name}`);
    return [{result}];
  } }
};
window.fetch = async (url, options) => {
  if(String(url).endsWith('/client-events')) return new Response(JSON.stringify({received:JSON.parse(options.body).events.length}));
  if(String(url).endsWith('/health')) return new Response(JSON.stringify({status:'OK'}));
  if(String(url).endsWith('/validate-key')) {
    const invalid = options.headers['X-SearchFix-Gemini-Key']?.startsWith('TEST_REJECTED');
    return new Response(JSON.stringify(invalid ? {error:'Gemini rejected this test key.'} : {valid:true,credentialSource:'request'}), {status:invalid?422:200});
  }
  const body=String(url).endsWith('analyze-comments')?JSON.parse(options.body):JSON.parse(options.body.get('orderData'));
  const source=makeOrder(body.orderNumber);
  const common={orderNumber:source.orderNumber,analysisId:'SYNTHETIC-ANALYSIS',commentAnalysis:{selectedComment:{...source.comments[0],role:source.orderNumber==='IGNORED-ORDER'?'INTERNAL':'CLIENT'},contextCommentsUsed:[],selectionReason:"This is the latest meaningful request in the supplied comments.",roleReason:source.orderNumber==='IGNORED-ORDER'?"ADS author and internal response context.":"Outsource author and client request context.",totalComments:1,consideredComments:1}};
  if(source.orderNumber==='TASK-ORDER')return new Response(JSON.stringify({...common,status:'ACCEPTED',overallDecision:'ACCEPTED',decisionBasis:'CLIENT_TASK',issues:[],documents:[],reason:'Client requests a rush ETA; no discrepancy is alleged.',nextSteps:['Contact the abstractor for an ETA and report back to the client.']}));
  if(String(url).endsWith('analyze-comments')) {
    return new Response(JSON.stringify(source.orderNumber==='IGNORED-ORDER'?{...common,status:'IGNORED',overallDecision:'IGNORED',reason:'ADSSearchType author.',issues:[]}:{...common,status:'AWAITING_DOCUMENTS',issues:[{issueType:'TYPING_ERROR',claim:'Verify the typed borrower name against the deed.',requiredFiles:[{fileType:'DEED'},{fileType:'TYPED_REPORT'}]}]}));
  }
  if(String(url).endsWith('analyze-documents')) {
    const decision=options.body.has('file0')&&body.taText?(body.orderNumber==='DISPUTED-ORDER'?'DISPUTED':'ACCEPTED'):'REVIEW_REQUIRED';
    return new Response(JSON.stringify({...common,status:decision,overallDecision:decision,documents:[...(options.body.has('file0')?[{name:'Deed.pdf',type:'DEED',status:'ANALYZED'}]:[]),{name:'Typing Assistant text',type:'TYPED_REPORT',status:'ANALYZED'}],issues:[{nextSteps:[decision==='ACCEPTED'?'Have the search team correct the identified name and recheck it.':decision==='DISPUTED'?'Send the cited evidence to the search team for the response.':'Obtain the missing deed and rerun this order.'],issueType:'TYPING_ERROR',category:'Typing',clientClaim:'Verify borrower name',requiredDocuments:['DEED','TYPED_REPORT'],decision,reason:decision==='ACCEPTED'?'Synthetic evidence supports the claim.':decision==='DISPUTED'?'Synthetic evidence contradicts the claim.':'Deed or TA was not supplied.',evidence:body.taText?[{document:'Typing Assistant text',page:null,finding:'Synthetic Borrower appears in the TA text.'}]:[]}]}));
  }
  throw new Error('Unexpected preview request');
};
const previewFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await previewFetch(...args);
  response.headers.set('X-SearchFix-Key-Source', 'request');
  return response;
};
document.getElementById('status').textContent = 'Loading local demo controls…';
try {
  await import('/extension/panel.js');
  document.getElementById('status').textContent = 'Ready to scan. No orders have been read yet.';
} catch (error) {
  document.getElementById('status').textContent = `Demo initialization failed: ${error.message}`;
}
