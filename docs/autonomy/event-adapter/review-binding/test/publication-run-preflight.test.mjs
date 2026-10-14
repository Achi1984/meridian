import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,now} from './publication-preflight-fixture.mjs';
import {preflightPublication} from '../scripts/publication-run-preflight.mjs';
import {planForPublication} from '../scripts/publication-plan-process.mjs';
function fixture(){
 const s=setup(),pins=JSON.parse(s.config.pinsRaw),scope=JSON.parse(s.config.scopeRaw);
 const root='https://api.github.com/repos/Achi1984/meridian';
 const run=(id,workflowId,headSha,path,status)=>({id,url:root+'/actions/runs/'+id,
  repository:{id:pins.repositoryId},head_repository:{id:pins.repositoryId},run_attempt:1,
  workflow_id:workflowId,head_sha:headSha,head_branch:'main',path,event:'workflow_dispatch',
  status,conclusion:status==='completed'?'success':null});
 const approval={id:pins.ownerApprovalCommentId,url:root+'/issues/comments/'+pins.ownerApprovalCommentId,
  issue_url:root+'/issues/571',user:{id:s.config.ownerId,type:'User'},author_association:'OWNER',
  performed_via_github_app:null,body:s.snapshot.approval.body,updated_at:s.config.approvalUpdatedAt};
 const records=new Map([
  [root,{id:pins.repositoryId,full_name:'Achi1984/meridian',owner:{id:s.config.ownerId,login:'Achi1984'}}],
  [approval.url,approval],
  [root+'/pulls/'+scope.prNumber,{number:scope.prNumber,url:root+'/pulls/'+scope.prNumber,
   base:{repo:{id:pins.repositoryId},sha:scope.baseSha},head:{repo:{id:pins.repositoryId},sha:scope.headSha},state:'open'}],
  [root+'/actions/runs/'+scope.ci.runId,run(scope.ci.runId,scope.ci.workflowId,scope.ci.headSha,'.github/workflows/check.yml','completed')],
  [root+'/actions/runs/'+pins.runId,run(pins.runId,pins.workflowId,pins.controlSha,pins.workflowPath,'in_progress')]
 ]);
 const context={repository:'Achi1984/meridian',actorId:s.config.ownerId,event:'workflow_dispatch',
  ref:'refs/heads/main',runAttempt:1,runId:pins.runId,sha:pins.controlSha};
 const urls=[];
 const deps={clock:()=>now,fetchFn:async(url,options)=>{
  urls.push(url);assert.equal(options.method??'GET','GET');
  if(records.has(url))return {status:200,url,redirected:false,body:new Response(JSON.stringify(records.get(url))).body};
  return s.deps.fetchFn(url,options);
 }};
 return {...s,context,deps,urls,approval};
}
test('real crypto, Python contract and fixed GET readers reach no-send boundary',async()=>{
 const s=fixture();const r=await preflightPublication(s.request,s.config,s.context,s.deps);
 assert.equal(r.kind,'PREFLIGHT_VALIDATED_NO_SEND');assert.equal(r.sendAllowed,false);
 assert.equal(r.authorized,false);assert.equal(s.calls(),0);assert.equal(s.urls.length,6);
});
test('context, replay and request bypasses reject before any I/O',async()=>{
 for(const edit of [s=>s.context.runAttempt=2,s=>s.context.actorId++,s=>s.context.sha='0'.repeat(40),
  s=>s.context.event='push',s=>s.context.ref='refs/heads/dev',s=>s.context.runId++,
  s=>s.context.repository='other/repo',s=>s.context.sendAllowed=true,s=>s.request.sendAllowed=true]){
  const s=fixture();edit(s);assert.equal((await preflightPublication(s.request,s.config,s.context,s.deps)).kind,'PREFLIGHT_REJECTED');
  assert.equal(s.urls.length,0);
 }
});
test('App-authored owner approval and changed bytes fail actual reader checks',async()=>{
 for(const edit of [a=>a.performed_via_github_app={id:1},a=>a.body+='changed']){
  const s=fixture();edit(s.approval);
  assert.equal((await preflightPublication(s.request,s.config,s.context,s.deps)).kind,'PREFLIGHT_REJECTED');assert.equal(s.calls(),0);
 }
});
test('input/config/context mutations after invocation cannot alter the snapshot',async()=>{
 const s=fixture();const work=preflightPublication(s.request,s.config,s.context,s.deps);
 s.request.body='changed';s.config.pinsRaw='{}';s.context.runAttempt=2;
 assert.equal((await work).kind,'PREFLIGHT_VALIDATED_NO_SEND');
});
test('plan process yields event loop and rejects oversized input without leaking data',async()=>{
 const s=fixture();let ticked=false;setImmediate(()=>{ticked=true;});
 const plan=await planForPublication(s.request.body,s.config);
 assert.equal(ticked,true);assert.equal(plan.kind,'OFFLINE_ACTIONS_PUBLICATION_PLAN');
 await assert.rejects(planForPublication('x'.repeat(65537),s.config),/^Error: PLAN_REJECTED$/);
 await assert.rejects(planForPublication('PRIVATE_BAD_BODY',s.config),/^Error: PLAN_REJECTED$/);
});
