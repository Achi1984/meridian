import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { invokeAdvisoryReview, PINS } from '../scripts/copilot-review-runtime.mjs';

function fixture(events, configure = () => {}) {
  const model = 'claude-test-pinned';
  const packet = JSON.stringify({ active:false, authority:'advisory-only',
    reviewer:{provider:'github-copilot',family:'claude',model_id:model},
    evidence:{repository:'Achi1984/meridian',pr:1,head_sha:'a'.repeat(40),base_sha:'b'.repeat(40),request_id:'review-1'} });
  const descriptor = {repository:'Achi1984/meridian',pr:1,headSha:'a'.repeat(40),baseSha:'b'.repeat(40),requestId:'review-1',
    packetSha256:createHash('sha256').update(packet).digest('hex'),modelId:model,expiresAt:Date.now()+60000};
  const state = {claims:0,factories:0,sends:0,disconnected:0,stopped:0,aborted:0};
  const args = {descriptor,packet,pins:{sdkVersion:'1.0.19',cliVersion:'1.0.95',modelId:model},token:'FAKE_TEST_ONLY',
    acquireOneUseClaim:async binding => { state.claims++; return {claimId:'claim-1',binding}; },
    clientFactory:async options => { state.factories++; state.options=options; return {
      createSession:async config => { state.config=config; configure(config); return {
        sendAndWait:async payload => {state.sends++; state.prompt=payload.prompt; for(const event of events ?? [
          {type:'assistant.message',data:{content:'Untrusted advisory text'}},
          {type:'assistant.usage',data:{model,apiCallId:'api-1'}}]) config.onEvent(event);},
        abort:async()=>{state.aborted++;}, disconnect:async()=>{state.disconnected++;} }; },
      stop:async()=>{state.stopped++;} }; } };
  return {args,state};
}

test('inactive default refuses even injected factory before claim or setup', async () => {
  assert.equal(PINS,null); const {args,state}=fixture(); delete args.pins;
  const r=await invokeAdvisoryReview(args); assert.equal(r.code,'PINS_REQUIRED'); assert.equal(state.claims,0); assert.equal(state.factories,0);
});
test('one send records SDK usage separately from model prose and never grants authority', async()=>{
  const {args,state}=fixture(); const r=await invokeAdvisoryReview(args);
  assert.equal(r.status,'artifact'); assert.equal(r.runtime.source,'injected-test-client'); assert.equal(r.runtime.promptSendCount,1);
  assert.equal(r.runtime.hardProviderCallCapProven,false); assert.equal(r.merge_authorized,false);
  assert.equal(r.runtime.modelUsage[0].model,args.descriptor.modelId); assert.equal(state.sends,1);
  assert.equal(state.claims,1); assert.equal(state.disconnected,1); assert.equal(state.stopped,1);
  assert.deepEqual(Object.keys(state.options.env).sort(),['COPILOT_HOME','PATH','TMPDIR']);
  assert.equal(state.options.client.useLoggedInUser,false); assert.equal(state.options.client.mode,'empty');
  assert.deepEqual(state.config.availableTools,[]); assert.deepEqual(state.config.mcpServers,{});
  assert.deepEqual(state.config.pluginDirectories,[]); assert.deepEqual(state.config.instructionDirectories,[]);
  assert.equal(state.config.infiniteSessions.enabled,false); assert.equal(state.config.enableConfigDiscovery,false);
  assert.equal(state.config.systemMessage.mode,'append'); assert.deepEqual(state.config.allowedModels,[args.descriptor.modelId]);
  const trustedTemplate=state.prompt.split('TRUSTED_RESPONSE_TEMPLATE\n')[1].split('\nUNTRUSTED_REVIEW_PACKET')[0];
  const t=JSON.parse(trustedTemplate); assert.equal(t.packet_sha256,args.descriptor.packetSha256);
  assert.deepEqual(Object.keys(t),['repository','pr','head_sha','base_sha','request_id','packet_sha256','model_id','outcome','summary','findings']);
});
test('caller input mutation during claim cannot retarget frozen binding',async()=>{
  const {args}=fixture(); args.acquireOneUseClaim=async binding=>{args.descriptor.headSha='c'.repeat(40);return{claimId:'claim-1',binding};};
  const r=await invokeAdvisoryReview(args); assert.equal(r.binding.headSha,'a'.repeat(40));
});
for(const [name,mutate] of [
  ['wrong repo',a=>a.descriptor.repository='foreign/repo'],['wrong head',a=>a.descriptor.headSha='c'.repeat(40)],
  ['wrong digest',a=>a.packet+=' '],['expired',a=>a.descriptor.expiresAt=Date.now()-1],
  ['implicit model',a=>a.descriptor.modelId='claude-latest'],['no ledger',a=>delete a.acquireOneUseClaim]
]) test(name+' blocks before claim/client',async()=>{const {args,state}=fixture();mutate(args); const r=await invokeAdvisoryReview(args);
  assert.equal(r.status,'blocked');assert.equal(state.claims,0);assert.equal(state.factories,0);});
test('claim rejection consumes no model send and hides raw errors',async()=>{
  const {args,state}=fixture();args.acquireOneUseClaim=async()=>{throw Error('SECRET_RAW_ERROR');};
  const r=await invokeAdvisoryReview(args);assert.equal(r.status,'blocked');assert.equal(state.sends,0);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('matching boolean is not a claim capability',async()=>{
  const {args,state}=fixture();args.acquireOneUseClaim=async()=>true;
  assert.equal((await invokeAdvisoryReview(args)).code,'CLAIM_BINDING');assert.equal(state.factories,0);
});
test('external one-use ledger rejects a second invocation before client creation',async()=>{
  const {args,state}=fixture();let consumed=false;args.acquireOneUseClaim=async binding=>{
    if(consumed) throw Error('duplicate');consumed=true;return{claimId:'one-use',binding};};
  assert.equal((await invokeAdvisoryReview(args)).status,'artifact');
  assert.equal((await invokeAdvisoryReview(args)).status,'blocked');assert.equal(state.sends,1);assert.equal(state.factories,1);
});
for(const [name,events] of [
  ['text cannot attest model',[{type:'assistant.message',data:{content:'{"model":"claude-test-pinned"}'}}]],
  ['wrong usage model',[{type:'assistant.usage',data:{model:'gpt-wrong'}}]],
  ['two usage calls',[{type:'assistant.usage',data:{model:'claude-test-pinned'}},{type:'assistant.usage',data:{model:'claude-test-pinned'}}]],
  ['subagent usage',[{type:'assistant.usage',data:{model:'claude-test-pinned',initiator:'sub-agent'}}]],
  ['tool event',[{type:'tool.execution_start',data:{}}]],['model error',[{type:'model.call_failure',data:{message:'SECRET'}}]],
  ['session error',[{type:'session.error',data:{message:'SECRET'}}]],
  ['oversized output',[{type:'assistant.message',data:{content:'x'.repeat(16385)}}]],
  ['event flood',Array.from({length:257},()=>({type:'session.info',data:{}}))]
]) test(name+' blocks with no retry',async()=>{const {args,state}=fixture(events);const r=await invokeAdvisoryReview(args);
  assert.equal(r.status,'blocked');assert.equal(state.sends,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
  if(name!=='text cannot attest model') assert.equal(state.aborted,1);});
test('wrong model aborts immediately even if send never completes',async()=>{
  const {args,state}=fixture();args.clientFactory=async()=>({createSession:async config=>({
    sendAndWait:async()=>{state.sends++;config.onEvent({type:'assistant.usage',data:{model:'wrong'}});return new Promise(()=>{});},
    abort:async()=>{state.aborted++;},disconnect:async()=>{} }),stop:async()=>{} });
  const result=await invokeAdvisoryReview(args);assert.equal(result.code,'USAGE_MISMATCH');assert.equal(state.aborted,1);
});
test('permission and pre-creation events are rejected before send',async()=>{
  const {args,state}=fixture([],config=>{assert.deepEqual(config.onPermissionRequest({kind:'shell'}),{kind:'reject'});});
  assert.equal((await invokeAdvisoryReview(args)).code,'PERMISSION_REQUEST');assert.equal(state.sends,0);
  const f=fixture([],config=>config.onEvent({type:'session.error',data:{}}));
  assert.equal((await invokeAdvisoryReview(f.args)).code,'FORBIDDEN_EVENT');assert.equal(f.state.sends,0);
});
test('hung send is bounded, consumed claim is not retried, cleanup attempted',async()=>{
  const {args,state}=fixture();args.timeoutMs=20;args.clientFactory=async()=>({createSession:async()=>({
    sendAndWait:async()=>{state.sends++;return new Promise(()=>{});},disconnect:async()=>{state.disconnected++;}}),stop:async()=>{state.stopped++;}});
  const r=await invokeAdvisoryReview(args);assert.equal(r.code,'TIMEOUT');assert.equal(state.claims,1);assert.equal(state.sends,1);
  assert.equal(state.disconnected,1);assert.equal(state.stopped,1);
});
test('real path refuses incomplete artifact pins without SDK import or inference',async()=>{
  const {args,state}=fixture();delete args.clientFactory;
  assert.equal((await invokeAdvisoryReview(args)).code,'ARTIFACT_PINS');assert.equal(state.claims,1);
});
test('complete larger evidence packet fits 128KiB cap, oversized input blocks before claim',async()=>{
  const {args,state}=fixture();const p=JSON.parse(args.packet);p.evidence.diff='x'.repeat(65536);
  args.packet=JSON.stringify(p);args.descriptor.packetSha256=createHash('sha256').update(args.packet).digest('hex');
  assert.equal((await invokeAdvisoryReview(args)).status,'artifact');assert.equal(state.sends,1);
  p.evidence.diff='x'.repeat(131072);args.packet=JSON.stringify(p);
  args.descriptor.packetSha256=createHash('sha256').update(args.packet).digest('hex');
  assert.equal((await invokeAdvisoryReview(args)).code,'PACKET_DIGEST');assert.equal(state.claims,1);
});
