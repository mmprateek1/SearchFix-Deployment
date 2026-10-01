import { DEFAULT_SETTINGS, buildAssistantText } from "./core.js";
import { readOrderPage } from "./page-reader.js";
import { QueueRunner } from "./queue-runner.js";
import { createApiClient, normalizeApiKey } from "./api-client.js";
import { createPageInjector } from "./injection.js";
import { createActivityLog } from "./activity-log.js";

const $ = id => document.getElementById(id);
const settings = { ...DEFAULT_SETTINGS };
let apiKey = (await chrome.storage.session.get("geminiApiKey")).geminiApiKey || "";
let busy = false;
let discoveredTasks = [];
let queueRunner = null;
let sourceTabId = null;
const taskCards = new Map();
const activity = createActivityLog(text => { $("activityLog").textContent = text; });
const log = activity.log;
const api = createApiClient({ backend: () => settings.backend, getKey: () => apiKey, log });
const diagnosticsApi = createApiClient({backend:()=>settings.backend,getKey:()=>apiKey,timeoutMs:5000});
let sentThrough = 0;
async function forwardActivity() {
  const records = activity.since(sentThrough);
  if (!records.length) return;
  try {
    await diagnosticsApi('client-events',{events:records.map(({time,event,details})=>({time,event,details}))},true);
    sentThrough = records.at(-1).sequence;
  } catch { log('diagnostics.forward.failed'); }
}
const inject = createPageInjector(chrome.scripting, log);

function status(message, error = false) { $("status").textContent = message; $("status").classList.toggle("error", error); }
async function run(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach(button => button.disabled = true);
  try { await work(); } catch (error) { status(error.message || "Unable to complete this step.", true); }
  finally { busy = false; document.querySelectorAll("button").forEach(button => button.disabled = false); }
}
function renderKeyState() {
  $("toggleApiKey").textContent = apiKey ? "Change Gemini API key" : "Add Gemini API key";
  $("apiKeyStatus").textContent = apiKey ? "Your key is saved for this browser session and will be used when you start analysis." : "Add your Gemini API key. There is no default-key fallback.";
}
$("toggleApiKey").addEventListener("click", () => {
  const open = $("apiKeySection").hidden;
  $("apiKeySection").hidden = !open;
  $("toggleApiKey").setAttribute("aria-expanded", String(open));
  if (open) $("apiKey").focus(); else $("apiKey").value = "";
});
$("apiKeyForm").addEventListener("submit", event => {
  event.preventDefault();
  run(async () => {
    try {
      const key = normalizeApiKey($("apiKey").value);
      await chrome.storage.session.set({ geminiApiKey: key });
      apiKey = key;
      $("apiKey").value = "";
      renderKeyState();
      $("apiKeySection").hidden = true;
      $("toggleApiKey").setAttribute("aria-expanded", "false");
      status("Your Gemini key is saved. Choose Start analysis beside an order to begin.");
    } catch (error) {
      $("apiKeyStatus").textContent = error.message;
      throw error;
    }
  });
});
$("removeApiKey").addEventListener("click", () => run(async () => {
  await chrome.storage.session.remove("geminiApiKey");
  apiKey = ""; $("apiKey").value = ""; renderKeyState();
  status("Key removed. Add a key before running analysis.");
}));
renderKeyState();

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("Open DataTrace and click the extension icon to grant access to this tab.");
  if (new URL(tab.url).origin !== "https://tv.datatracetitle.com") throw new Error("Open DataTrace before reading orders.");
  return tab;
}
function setTaskState(task, state) {
  const row = taskCards.get(task.url);
  if (!row) return;
  const labels = {PENDING:"Pending",PROCESSING:"Processing",ACCEPTED:"Accepted",DISPUTED:"Disputed",IGNORED:"Ignored",REVIEW_REQUIRED:"Review required"};
  row.badge.textContent = labels[state] || "Review required";
  row.badge.className = `orderStatus status-${labels[state] ? state.toLowerCase() : 'review_required'}`;
  row.card.dataset.status = state;
}
function section(title, content, className='') {
  const node=document.createElement('div');node.className=className;
  const heading=document.createElement('h3');heading.textContent=title;node.append(heading);
  const text=document.createElement('p');text.textContent=content;node.append(text);return node;
}
function showAnalysis(row,result) {
  row.findings.replaceChildren();
  const analysis=result.commentAnalysis,chosen=analysis?.selectedComment;
  const details=document.createElement('details');details.className='chosenComment';
  const summary=document.createElement('summary');summary.textContent='Chosen comment';details.append(summary);
  if(chosen){
    details.append(section(`${chosen.author || 'Unknown'} · ${chosen.date || ''} ${chosen.time || ''}`,chosen.text));
    details.append(section('Why AI chose it',analysis.selectionReason || 'Selection explanation unavailable.'));
    details.append(section('Author interpretation',analysis.roleReason || chosen.role));
  } else details.append(section('Selection needs review',result.reason || 'AI has not selected a comment.'));
  if(analysis?.totalComments!=null){const count=document.createElement('p');count.className='hint';count.textContent=`${analysis.totalComments} comments received · newest ${analysis.consideredComments} considered by AI`;details.append(count);}
  row.findings.append(details);
  if(result.reason)row.findings.append(section(result.decisionBasis==='CLIENT_TASK'?'Client task accepted':'Result explanation',result.reason,'resultReason'));
  if(result.decisionBasis==='CLIENT_TASK'){const note=document.createElement('p');note.className='hint';note.textContent='Task acknowledged for human action. No document error has been established.';row.findings.append(note);}
  for(const issue of result.issues || []){
    const block=section('Client claim',issue.clientClaim || issue.claim,'issueFinding');
    if(issue.decision)block.append(section(issue.decision.replaceAll('_',' '),issue.reason || ''));
    if(issue.requiredFiles?.length)block.append(section('Evidence requested',issue.requiredFiles.map(f=>f.fileType.replaceAll('_',' ')).join(', ')));
    for(const evidence of issue.evidence || [])block.append(section(`${evidence.document}${evidence.page?' · page '+evidence.page:''}`,evidence.finding+(evidence.quotedText?'\nQuote: '+evidence.quotedText:''),'evidenceFinding'));
    if(issue.nextSteps?.length)block.append(section('Recommended next steps',issue.nextSteps.map((step,i)=>`${i+1}. ${step}`).join('\n'),'nextSteps'));
    row.findings.append(block);
  }
  if(result.nextSteps?.length)row.findings.append(section('Next steps',result.nextSteps.map((step,i)=>`${i+1}. ${step}`).join('\n'),'nextSteps'));
  if(result.documents)showDocuments(row,result.documents);
}
function showDocuments(row,documents) {
  row.documents.replaceChildren();
  if(!documents.length)return;
  const heading=document.createElement('h3');heading.textContent='Documents';row.documents.append(heading);
  const list=document.createElement('ul');
  const labels={FOUND:'Found',DOWNLOADED:'Downloaded',ANALYZING:'Sent for analysis',ANALYZED:'Analyzed',UNVERIFIED:'Could not verify',FAILED:'Download failed'};
  for(const doc of documents){const item=document.createElement('li');item.textContent=`${doc.name} — ${labels[doc.status] || doc.status}`;list.append(item);}
  row.documents.append(list);
}
async function openOrder(task) {
  const target=new URL(task.url);
  if(target.origin!=='https://tv.datatracetitle.com'||!/\/OrderOverview\.aspx$/i.test(target.pathname)||target.username||target.password)throw Error('Only the verified Order Overview link can be opened.');
  let tab=sourceTabId?await chrome.tabs.get(sourceTabId).catch(()=>null):null;
  if(!tab)tab=await currentTab();
  await chrome.tabs.update(tab.id,{url:target.href,active:true});sourceTabId=tab.id;
  status(`Opened ${task.orderNumber}. Choose Start analysis when ready.`);
}
function renderTasks() {
  $("tasks").replaceChildren();taskCards.clear();
  for(const task of discoveredTasks){
    const card=document.createElement('article');card.className='orderCard';
    const header=document.createElement('div');header.className='orderHeader';
    const label=document.createElement('button');label.type='button';label.className='orderLink';label.textContent=task.orderNumber || task.name;label.title='Open Order Overview';
    label.addEventListener('click',()=>run(()=>openOrder(task)));
    const badge=document.createElement('span');badge.setAttribute('role','status');
    const start=document.createElement('button');start.type='button';start.className='primary startAnalysis';start.textContent='Start analysis';start.setAttribute('aria-label',`Start analysis for ${task.orderNumber}`);
    start.addEventListener('click',()=>run(()=>processTask(task)));
    header.append(label,badge,start);
    const content=document.createElement('div');content.className='orderContent';content.hidden=true;
    const progress=document.createElement('p');progress.className='orderProgress';progress.setAttribute('aria-live','polite');
    const findings=document.createElement('div'),documents=document.createElement('div'),actions=document.createElement('div');documents.className='documentProgress';
    content.append(progress,findings,documents,actions);card.append(header,content);$("tasks").append(card);
    taskCards.set(task.url,{card,badge,content,progress,findings,documents,actions,start});setTaskState(task,'PENDING');
  }
  $("tasksSection").hidden=!discoveredTasks.length;
  $("orderCount").textContent=`${discoveredTasks.length} found`;
}
async function scan() {
  $("activitySection").hidden = false;
  log('scan.start');
  const tab = await currentTab();
  sourceTabId = tab.id;
  const data = await inject(tab.id, readOrderPage, [settings]);
  discoveredTasks = [...new Map(data.tasks.map(task=>[task.url,task])).values()];
  renderTasks();
  log('scan.complete', {count:discoveredTasks.length});
  $("toggleApiKey").hidden = false;
  status(discoveredTasks.length ? `Found ${discoveredTasks.length} SearchFix orders. Choose Start analysis beside the order you want to review.` : "No SearchFix orders found on this page. Open All Active and Available Tasks, load the desired rows, and scan again.");
  return data;
}
async function navigate(url) {
  const tab = await currentTab();
  const target = new URL(url);
  if (target.origin !== new URL(tab.url).origin || !/\/(Queues|OrderOverview)\.aspx$/i.test(target.pathname)) throw new Error("Only same-site queue and Order Overview navigation is allowed.");
  status("Opening the read-only page…");
  await chrome.tabs.update(tab.id, { url: target.href });
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const updated = await chrome.tabs.get(tab.id);
    if (updated.status === "complete" && updated.url === target.href) {
      const data = await scan();
      if (data.comments.length || data.tasks.length) return;
    }
  }
  status("The page is still loading. Use Scan the page when it finishes.");
}
$("scan").addEventListener("click", () => run(async () => {
  const data = await scan();
  if (data.tasks.length) return;
  if (data.queueLinks.length) await navigate(data.queueLinks[0].url);
}));
async function processTask(task) {
  if(!apiKey){$("apiKeySection").hidden=false;$("toggleApiKey").setAttribute('aria-expanded','true');$("apiKey").focus();throw Error('Add your Gemini API key, then choose Start analysis.');}
  const row=taskCards.get(task.url);row.content.hidden=false;row.findings.replaceChildren();row.documents.replaceChildren();row.actions.replaceChildren();
  queueRunner=new QueueRunner({tabs:chrome.tabs,inject,api,settings,log,
    onProgress:message=>{status(message);row.progress.textContent=message;},
    onOrderState:setTaskState,
    onAnalysis:result=>showAnalysis(row,result),
    onDocuments:documents=>showDocuments(row,documents),
    onResult:async result=>{
      showAnalysis(row,result);row.progress.textContent=`Analysis finished: ${(result.overallDecision || result.status).replaceAll('_',' ')}`;
      const copy=document.createElement('button');copy.textContent='Copy findings';copy.disabled=busy;
      copy.addEventListener('click',()=>run(async()=>{await navigator.clipboard.writeText(buildAssistantText(result));status('Findings copied.');}));row.actions.append(copy);
      await forwardActivity();
    }
  });
  try{await queueRunner.run([task]);status(`Finished reviewing ${task.orderNumber}.`);}
  finally{queueRunner=null;await forwardActivity();}
}
// Opening the extension does not read or navigate the website. Scan is explicit.
$("copyActivity").addEventListener("click", () => run(async () => {
  await navigator.clipboard.writeText(activity.text());
  status("Activity log copied. It contains step metadata, not document contents or API keys.");
}));
