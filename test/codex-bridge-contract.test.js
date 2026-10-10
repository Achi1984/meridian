import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROTOCOL,REPOSITORY,PATHS,STATES,BridgeGuardError,canonicalJson,bodyHash,validateRequest,
  reconcileRequest,validateAck,validateDraftPr,createPlan,advance,inspectCommentBinding,
  inspectDraftSnapshot,inspectReviewSet,activationStatus} from '../scripts/codex-bridge-contract.mjs';
const A='8a8a43fc8df4e440294bf7ef5747510b6c6a44d0',B='398674e6b24c65f319462995890377d1760f8c46',C='c'.repeat(40);
const request=()=>({protocol:PROTOCOL,requestId:'CODEX-BRIDGE-R2-001',opId:'BRIDGE-R2-OP-001',
  expectedMain:A,expectedBase:A,expectedHead:B,targetBranch:'fix/codex-bridge-v2-security-r2-20261009',
  model:'gpt-5.3-codex',allowedPaths:[...PATHS],allowedActions:['offline_code','draft_pr'],researchStage:'SOURCE_AUDIT',
  costGuard:{overageAllowed:false,additionalSpendAllowed:false},forbidden:['merge','workflow','trading']});
const fail=(fn,code)=>assert.throws(fn,e=>e instanceof BridgeGuardError&&(!code||e.code===code));
const event=next=>({next,requestId:request().requestId,opId:request().opId,expectedHead:B,expectedBase:A,expectedRevision:0});
const review=()=>({commentId:6085270808,actorId:209825114,requestId:request().requestId,opId:request().opId,
  headSha:C,baseSha:A,bodyHash:'d'.repeat(64),verdict:'GREEN_LIGHT',revoked:false});
const comment=()=>({repository:REPOSITORY,issue:627,id:123,actorId:319562141,
  url:'https://github.com/'+REPOSITORY+'/issues/627#issuecomment-123',body:'offline candidate',headSha:B,baseSha:A,
  requestId:request().requestId,opId:request().opId});
const pin=()=>({actorId:319562141,commentId:123,bodyHash:bodyHash(comment().body)});
const draft=()=>({repository:REPOSITORY,number:999,draft:true,state:'open',merged:false,
  headRef:request().targetBranch,headSha:C,baseSha:A,liveMain:A,
  files:[{path:PATHS[0],oldPath:null,status:'modified',oldMode:'100644',newMode:'100644'}]});

test('R2 request deeply immutable and explicitly unauthorized',()=>{
  const r=validateRequest(request());assert.equal(r.authorized,false);assert.match(r.fingerprint,/^[a-f0-9]{64}$/);
  assert.throws(()=>r.request.allowedPaths.push('server.js'),TypeError);
  assert.equal(validateRequest(r.request).fingerprint,r.fingerprint);
});
test('reordered JSON keys have same scope hash',()=>assert.equal(validateRequest(request()).fingerprint,
  validateRequest(Object.fromEntries(Object.entries(request()).reverse())).fingerprint));
test('identical replay is inert',()=>assert.equal(reconcileRequest(request(),request()).status,'IDENTICAL_REPLAY_NO_ACTION'));
test('new request cannot reuse op ID',()=>fail(()=>reconcileRequest(request(),{...request(),requestId:'CODEX-BRIDGE-R2-002'}),'OP_ID_REUSED'));
test('same request ID cannot change scope',()=>fail(()=>reconcileRequest(request(),{...request(),opId:'BRIDGE-R2-OP-002'}),'DUPLICATE_SCOPE_CONFLICT'));
test('distinct request and op ID remain unauthorized',()=>{
  const x=reconcileRequest(request(),{...request(),requestId:'CODEX-BRIDGE-R2-002',opId:'BRIDGE-R2-OP-002'});
  assert.equal(x.status,'NEW_OFFLINE_REQUEST');assert.equal(x.authorized,false);
});
for(const [name,delta,code] of [
  ['unknown field',{trustedSource:true},'REQUEST_SCHEMA'],['protocol',{protocol:'other'},'PROTOCOL_MISMATCH'],
  ['missing request ID',{requestId:''},'REQUEST_ID_INVALID'],['bad SHA',{expectedHead:'123'},'REQUEST_SHA_INVALID'],
  ['uppercase SHA',{expectedHead:B.toUpperCase()},'REQUEST_SHA_INVALID'],['changed base',{expectedBase:C},'UNEXPECTED_BASE'],
  ['main branch',{targetBranch:'main'},'BRANCH_NOT_ISOLATED'],['ref traversal',{targetBranch:'fix/codex-bridge-v2-x..y'},'BRANCH_NOT_ISOLATED'],
  ['unapproved model',{model:'other'},'MODEL_NOT_ALLOWED'],['model coercion',{model:1},'MODEL_NOT_ALLOWED'],
  ['research activation',{researchStage:'PAPER'},'RESEARCH_STAGE_FORBIDDEN'],
  ['actions string',{allowedActions:'offline_code,draft_pr'},'ACTIONS_FORBIDDEN'],
  ['extra action',{allowedActions:['offline_code','draft_pr','merge']},'ACTIONS_FORBIDDEN'],
  ['extra spend',{costGuard:{overageAllowed:false,additionalSpendAllowed:true}},'COST_GUARD_MISSING'],
  ['billing Boolean',{costGuard:{overageAllowed:false,additionalSpendAllowed:false,includedCreditsVerified:true}},'COST_GUARD_MISSING'],
  ['forbidden string',{forbidden:'merge workflow trading'},'FORBIDDEN_ACTION_GAP'],
  ['empty scope',{allowedPaths:[]},'PATH_SCOPE_MISSING'],['duplicate scope',{allowedPaths:[PATHS[0],PATHS[0]]},'PATH_DUPLICATE'],
])test('request rejects '+name,()=>fail(()=>validateRequest({...request(),...delta}),code));
for(const path of ['./scripts/codex-bridge-contract.mjs','scripts/./codex-bridge-contract.mjs','scripts/../server.js',
  'scripts/','scripts/*','/scripts/codex-bridge-contract.mjs','scripts\\codex-bridge-contract.mjs','.GitHub/workflows/run.yml',
  '.github/workflows/run.yml','MERIDIAN_LIVE_CHECKPOINT.json','MERIDIAN_GO.md','version.json','package.json',
  'scripts/frozen-research-guard.mjs','research/run.js','scripts/codex-bridge-contract.mjs\u0000',
  'scripts/%2e%2e/server.js','SCRIPTS/codex-bridge-contract.mjs']){
  test('protected/noncanonical path '+JSON.stringify(path),()=>fail(()=>validateRequest({...request(),allowedPaths:[path]}),'PATH_SCOPE_INVALID'));
}
test('scope count bounded',()=>fail(()=>validateRequest({...request(),allowedPaths:Array(6).fill(PATHS[0])}),'PATH_SCOPE_MISSING'));
for(const value of [undefined,NaN,Infinity,1.5,1n,new Date(),new Map(),()=>{},Symbol('x'),/x/]){
  test('non-JSON '+String(value)+' rejected',()=>fail(()=>canonicalJson({value})));
}
test('getters not executed',()=>{
  let calls=0;const v={get field(){calls++;return true;}};fail(()=>canonicalJson(v),'JSON_ACCESSOR');assert.equal(calls,0);
});
test('toJSON hook not executed',()=>{let calls=0;fail(()=>canonicalJson({toJSON(){calls++;}}));assert.equal(calls,0);});
test('cycles rejected',()=>{const v={};v.v=v;fail(()=>canonicalJson(v),'JSON_TYPE');});
test('sparse array rejected',()=>fail(()=>canonicalJson(Array(2))));
test('array property rejected',()=>{const v=[1];v.extra=true;fail(()=>canonicalJson(v),'JSON_ARRAY');});
test('symbol property rejected',()=>fail(()=>canonicalJson({[Symbol('x')]:1}),'JSON_KEYS'));
test('malformed Unicode rejected',()=>fail(()=>canonicalJson('\ud800'),'JSON_STRING'));
test('deep JSON rejected',()=>{let v={};for(let i=0;i<14;i++)v={v};fail(()=>canonicalJson(v),'JSON_DEPTH');});
test('oversized JSON rejected',()=>fail(()=>canonicalJson({a:'a'.repeat(40000),b:'b'.repeat(40000)}),'JSON_SIZE'));

for(const name of ['ownerApproved','ackValidated','scopeValidated','ciSuccess','independentExecutionProven','includedCreditsVerified']){
  test('forged '+name+' cannot authenticate ACK',()=>fail(()=>validateAck(request(),{[name]:true},
    {trustedSource:true,authenticatedBy:'github-api',actorId:319562141,commentId:123,headSha:B,bodyHash:pin().bodyHash}),'AUTHENTICATED_TRANSPORT_UNAVAILABLE'));
}
test('forged trustedSource cannot authenticate PR',()=>fail(()=>validateDraftPr(request(),draft(),
  {trustedSource:true,authenticatedBy:'github-api'}),'AUTHENTICATED_TRANSPORT_UNAVAILABLE'));
test('even matching comment stays unauthorized',()=>assert.equal(inspectCommentBinding(request(),comment(),pin()).authorized,false));
for(const [name,delta,code] of [
  ['actor ID',{actorId:1},'COMMENT_PIN_MISMATCH'],
  ['comment ID',{id:124,url:'https://github.com/'+REPOSITORY+'/issues/627#issuecomment-124'},'COMMENT_PIN_MISMATCH'],
  ['edited content',{body:'edited'},'COMMENT_PIN_MISMATCH'],['repository',{repository:'attacker/meridian'},'COMMENT_SOURCE_MISMATCH'],
  ['host',{url:'https://github.com.attacker.example/comment'},'COMMENT_SOURCE_MISMATCH'],
  ['head',{headSha:C},'COMMENT_SCOPE_MISMATCH'],['base',{baseSha:C},'COMMENT_SCOPE_MISMATCH'],
  ['request',{requestId:'CODEX-BRIDGE-R2-002'},'COMMENT_SCOPE_MISMATCH'],['operation',{opId:'BRIDGE-R2-OP-002'},'COMMENT_SCOPE_MISMATCH'],
])test('comment pin rejects '+name,()=>fail(()=>inspectCommentBinding(request(),{...comment(),...delta},pin()),code));
test('comment body hash covers exact bytes',()=>assert.notEqual(bodyHash(comment().body),bodyHash(comment().body+'\n')));

test('scoped PR stays unauthorized',()=>assert.equal(inspectDraftSnapshot(request(),draft(),C).authorized,false));
for(const [name,delta,code] of [
  ['head',{headSha:B},'PR_HEAD_MISMATCH'],['base',{baseSha:C},'PR_BASE_CHANGED'],['live main',{liveMain:C},'PR_BASE_CHANGED'],
  ['branch',{headRef:'other'},'PR_HEAD_MISMATCH'],['non-draft',{draft:false},'PR_NOT_DRAFT'],['merged',{merged:true},'PR_NOT_DRAFT'],
  ['closed',{state:'closed'},'PR_NOT_DRAFT'],['repository',{repository:'attacker/repo'},'PR_SOURCE_MISMATCH'],
  ['empty diff',{files:[]},'PR_SCOPE_DRIFT'],
])test('PR rejects '+name,()=>fail(()=>inspectDraftSnapshot(request(),{...draft(),...delta},C),code));
for(const [name,delta,code] of [
  ['rename',{oldPath:'server.js',status:'renamed'},'PR_CHANGE_FORBIDDEN'],['delete',{status:'removed'},'PR_CHANGE_FORBIDDEN'],
  ['symlink',{newMode:'120000'},'PR_MODE_FORBIDDEN'],['submodule',{newMode:'160000'},'PR_MODE_FORBIDDEN'],
  ['executable',{newMode:'100755'},'PR_MODE_FORBIDDEN'],['old mode',{oldMode:'120000'},'PR_MODE_FORBIDDEN'],
  ['path',{path:'server.js'},'PR_SCOPE_DRIFT'],
])test('PR rejects '+name+' metadata',()=>fail(()=>inspectDraftSnapshot(request(),{...draft(),files:[{...draft().files[0],...delta}]},C),code));
test('filename alone cannot prove modes',()=>fail(()=>inspectDraftSnapshot(request(),{...draft(),files:[{path:PATHS[0]}]},C),'PR_FILE_SCHEMA'));
test('duplicate changed-file metadata rejected',()=>fail(()=>inspectDraftSnapshot(request(),{...draft(),files:[draft().files[0],draft().files[0]]},C),'PR_SCOPE_DRIFT'));
test('new regular file inspected only offline',()=>assert.equal(inspectDraftSnapshot(request(),
  {...draft(),files:[{...draft().files[0],status:'added',oldMode:null}]},C).authorized,false));

test('literal later-state ledger untrusted',()=>fail(()=>advance({state:'CI_VERIFIED',request:request(),headSha:C},event('CLAUDE_EXACT_HEAD_REVIEWED')),'LEDGER_UNTRUSTED'));
test('copy of real plan loses brand',()=>fail(()=>advance({...createPlan(request())},event('OWNER_AUTHORIZED')),'LEDGER_UNTRUSTED'));
test('serialization loses plan brand',()=>fail(()=>advance(JSON.parse(JSON.stringify(createPlan(request()))),event('OWNER_AUTHORIZED')),'LEDGER_UNTRUSTED'));
for(const evidence of [
  {},{owner:'Achi1984',approvalId:'123'}, {ownerApproved:true,owner:'Achi1984',approvedHead:B,approvedModel:'gpt-5.3-codex',
    overageDisabledVerified:true,includedCreditsVerified:true,additionalSpendAllowed:false},
  {assignmentId:'1',model:'gpt-5.3-codex',ownerApproved:true},
  {ciSuccess:true,headSha:C,runUrl:'https://evil.example/run/1'},
  {independentExecutionProven:true,verdict:'GREEN_LIGHT',headSha:C,reviewUrl:'https://github.com/Achi1984/meridian/issues/571#issuecomment-6085270808'},
])test('caller evidence cannot advance owner authorization '+JSON.stringify(evidence),()=>fail(()=>advance(createPlan(request()),
  {...event('OWNER_AUTHORIZED'),evidence}),'AUTHENTICATED_TRANSPORT_UNAVAILABLE'));
for(const next of STATES.filter(x=>!['PLANNED','OWNER_AUTHORIZED','STOPPED'].includes(x))){
  test('cannot jump from plan to '+next,()=>fail(()=>advance(createPlan(request()),{...event(next),evidence:{
    ownerApproved:true,ackValidated:true,scopeValidated:true,ciSuccess:true,independentExecutionProven:true,
    ownerMergeApprovalRequired:true}}),'TRANSITION_FORBIDDEN'));
  test('cannot forge ledger at '+next,()=>fail(()=>advance({state:next,request:request()},event('AWAITING_MERGE_DECISION')),'LEDGER_UNTRUSTED'));
}
test('valid STOP only cancels offline plan',()=>{
  const p=advance(createPlan(request()),{...event('STOPPED'),reason:'UNKNOWN_OUTCOME'});
  assert.equal(p.state,'STOPPED');assert.equal(p.authorized,false);
  fail(()=>advance(p,{...event('STOPPED'),expectedRevision:1,reason:'OWNER_ABORT'}),'TRANSITION_FORBIDDEN');
});
for(const delta of [{requestId:'CODEX-BRIDGE-R2-002'},{opId:'BRIDGE-R2-OP-002'},{expectedHead:C},{expectedBase:C},{expectedRevision:1}]){
  test('STOP rejects mismatched '+Object.keys(delta)[0],()=>fail(()=>advance(createPlan(request()),
    {...event('STOPPED'),reason:'OWNER_ABORT',...delta}),'EVENT_SCOPE_MISMATCH'));
}
test('STOP rejects free-form reason',()=>fail(()=>advance(createPlan(request()),{...event('STOPPED'),reason:'anything'}),'STOP_REASON_INVALID'));
test('STOP rejects unexpected evidence',()=>fail(()=>advance(createPlan(request()),
  {...event('STOPPED'),reason:'OWNER_ABORT',evidence:{trustedSource:true}}),'STOP_SCHEMA'));
test('GREEN review never authorizes',()=>assert.equal(inspectReviewSet(request(),[review()],C).authorized,false));
test('review head moved',()=>assert.equal(inspectReviewSet(request(),[review()],B).status,'STOP_STALE_REVIEW'));
test('review base moved',()=>assert.equal(inspectReviewSet(request(),[{...review(),baseSha:B}],C).status,'STOP_STALE_REVIEW'));
test('review revoked',()=>assert.equal(inspectReviewSet(request(),[{...review(),revoked:true}],C).status,'STOP_REVIEW_REVOKED'));
for(const verdict of ['CHANGES_REQUIRED','NEEDS_MORE_EVIDENCE']){
  test('contradictory '+verdict+' overrides GREEN',()=>assert.equal(inspectReviewSet(request(),
    [review(),{...review(),commentId:1,verdict}],C).status,'STOP_REVIEW_INSUFFICIENT'));
}
test('duplicate/edited review conflicts',()=>assert.equal(inspectReviewSet(request(),
  [review(),{...review(),bodyHash:'e'.repeat(64)}],C).status,'STOP_REVIEW_CONFLICT'));
test('forged reviewer ID rejected',()=>fail(()=>inspectReviewSet(request(),[{...review(),actorId:319562141}],C),'REVIEW_IDENTITY_INVALID'));
test('review operation mismatch rejected',()=>fail(()=>inspectReviewSet(request(),[{...review(),opId:'BRIDGE-R2-OP-002'}],C),'REVIEW_SCOPE_MISMATCH'));
test('empty review set rejected',()=>fail(()=>inspectReviewSet(request(),[],C),'REVIEW_SCHEMA'));
test('all activation gates closed',()=>{
  const s=activationStatus();assert.equal(s.authorized,false);assert.equal(s.status,'DESIGNED_NOT_ACTIVATED');assert.equal(s.blockedBy.length,6);
});
test('repository has no bridge wiring from workflow/product paths',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const allowed=new Set(['scripts/codex-bridge-contract.mjs','scripts/codex-bridge-journal.mjs',
    'test/codex-bridge-contract.test.js','test/codex-bridge-journal.test.js']);
  const walk=(dir,prefix='')=>{for(const e of readdirSync(dir,{withFileTypes:true})){
    if(['.git','node_modules','.cache'].includes(e.name))continue;
    const path=prefix+e.name;
    if(e.isDirectory())walk(join(dir,e.name),path+'/');
    else if(e.isFile()&&/\.(?:[cm]?js|json|html|py|ya?ml)$/.test(path)&&!allowed.has(path)){
      assert.doesNotMatch(readFileSync(join(dir,e.name),'utf8'),/codex-bridge-(?:contract|journal)(?:\.mjs|\/)/,'bridge wired from '+path);
    }
  }};walk(root);
});
