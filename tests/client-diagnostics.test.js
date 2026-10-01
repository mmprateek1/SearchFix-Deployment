import {BACKEND_ORIGIN} from '../extension/deployment.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {createApiClient} from '../extension/api-client.js';
import {createActivityLog} from '../extension/activity-log.js';

test('extension activity reaches the authenticated backend with content fields stripped and request correlation',async()=>{
  const logs=[],oldInfo=console.info;
  console.info=value=>logs.push(value);
  const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${server.address().port}`;
  const key='TEST_DIAGNOSTIC_KEY_12345678901234567890';
  try {
    const api=createApiClient({backend:()=> BACKEND_ORIGIN,getKey:()=>key,
      fetcher:(url,options)=>fetch(url.replace(BACKEND_ORIGIN,root),options),timeoutMs:5000});
    const activity=createActivityLog();
    activity.log('attachments.selected',{count:3,selected:['SEARCH_PACKAGE'],apiKey:key,taText:'PRIVATE TA'});
    const records=activity.since(0);
    assert.equal(records.length,1);
    assert.equal(activity.since(records[0].sequence).length,0);
    const events=records.map(({time,event,details})=>({time,event,details:{...details,apiKey:key,comment:'PRIVATE COMMENT',url:'https://private.invalid'}}));
    assert.equal((await api('client-events',{events},true)).received,1);
    const received=logs.map(s=>{try{return JSON.parse(s);}catch{return null;}}).find(e=>e?.event==='extension.activity');
    assert.equal(received.stage,'attachments.selected');
    assert.deepEqual(received.client,{count:3,selected:['SEARCH_PACKAGE']});
    assert.notEqual(received.requestId,'local');
    assert.doesNotMatch(logs.join('\n'),/PRIVATE TA|PRIVATE COMMENT|private\.invalid|TEST_DIAGNOSTIC_KEY/);
    const unauthorized=await fetch(root+'/api/searchfix/client-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})});
    assert.equal(unauthorized.status,401);
    await assert.rejects(api('client-events',{events:[{time:'invalid',event:'bad\nevent',details:{}}]},true),/Invalid activity-log metadata/);
  } finally {await new Promise(resolve=>server.close(resolve));console.info=oldInfo;}
});
