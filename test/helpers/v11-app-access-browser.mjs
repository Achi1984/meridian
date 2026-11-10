import assert from 'node:assert/strict';

export const VERIFY_ENDPOINT='https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w';
const TEST_PASSWORD='synthetic-browser-gate-password';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function unlockAppThroughGate(call,{additionalFetchUrls=[],blockOtherRequests=false}={}){
 const additional=new Set(additionalFetchUrls);
 assert.ok(Array.isArray(additionalFetchUrls)&&additional.size===additionalFetchUrls.length&&
  typeof blockOtherRequests==='boolean');
 for(const url of additional)assert.ok(typeof url==='string'&&url.startsWith('https://')&&!url.includes('*')&&url!==VERIFY_ENDPOINT,
  'additional interception must identify exact HTTPS URLs owned by another fixture listener');
 const patterns=urls=>urls.map(url=>({urlPattern:url,requestStage:'Request'}));
 let verified=false,failure=null,off;
 const body=Buffer.from(JSON.stringify({version:'browser-access-verification'})).toString('base64');
 off=call.onEvent('Fetch.requestPaused',event=>{
  void (async()=>{
   if(additional.has(event.request.url))return; // The existing exact-route fixture owns this event.
   if(event.request.url!==VERIFY_ENDPOINT)throw Error('Unexpected app verification URL');
   if(event.request.method==='OPTIONS'){
    await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:204,responseHeaders:[
     {name:'Access-Control-Allow-Origin',value:'*'},
     {name:'Access-Control-Allow-Methods',value:'GET'},
     {name:'Access-Control-Allow-Headers',value:'authorization,accept'},
     {name:'Access-Control-Max-Age',value:'0'}]});
    return;
   }
   assert.equal(event.request.method,'GET');
   const authorization=Object.entries(event.request.headers||{})
    .find(([name])=>name.toLowerCase()==='authorization')?.[1];
   assert.equal(authorization,'Bearer '+TEST_PASSWORD);
   await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[
    {name:'Access-Control-Allow-Origin',value:'*'},
    {name:'Content-Type',value:'application/json'},
    {name:'Cache-Control',value:'no-store'}],body});
   verified=true;
  })().catch(error=>{failure=error;});
 });
 await call('Fetch.enable',{patterns:patterns([VERIFY_ENDPOINT,...additional])});
 try{
  const initial=await call('Runtime.evaluate',{expression:`({
   hidden:document.getElementById('app').hidden,
   gateHidden:document.getElementById('app-access-gate').hidden,
   form:!!document.getElementById('app-access-form')
  })`,returnByValue:true});
  assert.deepEqual(initial.result.value,{hidden:true,gateHidden:false,form:true},'test starts at the real locked app gate');
  await call('Runtime.evaluate',{expression:`(()=>{
   const input=document.getElementById('app-access-password');
   input.value=${JSON.stringify(TEST_PASSWORD)};
   document.getElementById('app-access-form').requestSubmit();
   return true;
  })()`,returnByValue:true});
  for(let attempt=0;attempt<150;attempt++){
   if(failure)throw failure;
   const state=await call('Runtime.evaluate',{expression:`({
    hidden:document.getElementById('app').hidden,
    status:document.getElementById('app-access-status').textContent
   })`,returnByValue:true});
   if(state.result.value.hidden===false){
    assert.equal(verified,true,'the actual access request must receive the bounded mock server response');
    assert.match(state.result.value.status,/Zugang geprüft/);
    assert.equal(await call('Runtime.evaluate',{expression:`document.getElementById('app-access-password').value`,returnByValue:true})
     .then(result=>result.result.value),'','successful submit clears the password field');
    return;
   }
   await delay(10);
  }
  if(failure)throw failure;
  const finalState=await call('Runtime.evaluate',{expression:`({
   hidden:document.getElementById('app').hidden,
   status:document.getElementById('app-access-status').textContent,
   input:document.getElementById('app-access-password').value
  })`,returnByValue:true});
  assert.fail('central app gate did not unlock after mocked server validation; state='+
   JSON.stringify(finalState.result.value)+'; verified='+verified+'; failure='+(failure?.message||'none'));
 }finally{
  off();
  if(additional.size||blockOtherRequests)await call('Fetch.enable',{patterns:patterns([
   ...additional,...(blockOtherRequests?['*']:[])
  ])});
  else await call('Fetch.disable');
 }
}
