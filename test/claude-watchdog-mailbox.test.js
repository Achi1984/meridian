import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMailbox, seenFingerprint } from '../scripts/watchdog-mailbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WORKFLOW = readFileSync(join(ROOT,'.github/workflows/claude-watchdog-15m.yml'),'utf8');
const H='a'.repeat(40), M='b'.repeat(40), B='c'.repeat(40), H2='d'.repeat(40), FP='e'.repeat(64);
const NOW=Date.parse('2026-10-07T06:30:00Z');
const OWNER={login:'Achi1984',id:319562141,type:'User'};
const BOT={login:'claude[bot]',id:209825114,type:'Bot'};
const OUTSIDER={login:'other-user',id:17,type:'User'};
function req(id='R130-REVIEW',o={}) {
  const {head=H,base=B,pr=595,commentId=1,user=OWNER,time=NOW-1800000}=o;
  return {id:commentId,user,created_at:new Date(time).toISOString().replace('.000Z','Z'),
    body:`@claude\n\nCROSS_MODEL_REQUEST ${id}`+(head?`\nexact_head_sha: ${head}`:'')+
      (base?`\nexact_base_sha: ${base}`:'')+(pr?`\npr: ${pr}`:'')};
}
function res(id='R130-REVIEW',o={}) {
  const {head=H,base=B,commentId=2,user=BOT,time=NOW-1500000,verdict='GREEN_LIGHT'}=o;
  return {id:commentId,user,created_at:new Date(time).toISOString().replace('.000Z','Z'),
    body:`**Claude finished @Achi1984's task in 1m** —— [View job](https://github.com/Achi1984/meridian/actions/runs/1)\n\n---\nCROSS_MODEL_RESPONSE ${id}\nverdict: ${verdict}\nreviewed_head: ${head}`+(base?`\nreviewed_base: ${base}`:'')};
}
function pr(o={}) { return {number:595,state:'open',head:{sha:H,ref:'r130-test'},base:{sha:B},title:'R130 safety fix',draft:true,updated_at:'2026-10-07T06:00:00Z',...o}; }
function audit(pages,o={}) {return resolveMailbox({pages,prPages:[[pr()]],mainSha:M,nowMs:NOW,...o});}
const key=(id='R130-REVIEW',h=H,b=B)=>`${id}@${h}@${b||'NONE'}`;
const state=(comments,o={})=>audit([comments],o).items[0]?.state;
function status(o={}) {return {id:5,user:BOT,created_at:'2026-10-07T06:20:00Z',body:`CROSS_MODEL_STATUS CLAUDE-DEVELOPMENT-WATCHDOG\nfingerprint: ${FP}\nmain: ${M}\nactive_pr: NONE\nverdict: CHALLENGE`,...o};}
const seen=(pages,o={})=>seenFingerprint({pages,fingerprint:FP,nowMs:NOW,...o});
function runScript(name) {
  const start=WORKFLOW.indexOf(`      - name: ${name}\n`);
  assert.ok(start>=0);
  const begin=WORKFLOW.indexOf('        run: |\n',start)+ '        run: |\n'.length;
  const end=WORKFLOW.indexOf('\n      - name: ',begin);
  assert.ok(begin>start&&end>begin);
  return WORKFLOW.slice(begin,end).split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
}

// These cases preserve the prior R129 trigger and quota contracts, but execute the
// resolver/decision path instead of only matching the presence of source strings.
test('R129: :57, dispatch, completed Release Safety and success-only fallback unchanged',()=>{
  assert.match(WORKFLOW,/schedule:\n\s+- cron: '57 \* \* \* \*'/);
  assert.match(WORKFLOW,/workflow_dispatch:/);
  const trigger=WORKFLOW.slice(WORKFLOW.indexOf('\non:'),WORKFLOW.indexOf('\npermissions:'));
  assert.match(trigger,/workflow_run:\n\s+workflows:\n\s+- MERIDIAN Release Safety\n\s+types:\n\s+- completed/);
  assert.doesNotMatch(trigger,/MERIDIAN Visual QA|MERIDIAN Runtime Smoke|MERIDIAN Agent Orchestration Safety/);
  const gate=WORKFLOW.slice(WORKFLOW.indexOf('jobs:'),WORKFLOW.indexOf('\n    runs-on:'));
  assert.match(gate,/github\.event_name != 'workflow_run'/);
  assert.match(gate,/workflow_run\.name == 'MERIDIAN Release Safety'/);
  assert.match(gate,/workflow_run\.conclusion == 'success'/);
});
test('R129: Claude, credential and cache-save gates remain decision-controlled',()=>{
  assert.equal((WORKFLOW.match(/if: steps\.decision\.outputs\.run_claude == 'true'/g)||[]).length,3);
  assert.match(WORKFLOW,/cancel-in-progress: false/);
  assert.match(WORKFLOW,/--disallowedTools Edit,Write/);
  assert.match(WORKFLOW,/MERIDIAN DEVELOPMENT COPILOT — STATE-CHANGE WATCHDOG/);
});
test('R130: no action-expression interpolation in either shell run script',()=>{
  assert.doesNotMatch(runScript('Compute cheap development fingerprint'),/\$\{\{/);
  assert.doesNotMatch(runScript('Decide whether Claude is needed'),/\$\{\{/);
  for(const key of ['CACHE_HIT','CI_PENDING','UNRESOLVED_REQUEST','MAILBOX_REVIEW_PENDING']) assert.match(WORKFLOW,new RegExp(`          ${key}: \\$\\{\\{`));
});
test('R130: permissions unchanged and Node runtime explicitly selected',()=>{
  assert.match(WORKFLOW,/permissions:\n  contents: read\n  issues: write\n  pull-requests: read\n  actions: read\n  id-token: write/);
  assert.match(WORKFLOW,/actions\/setup-node@v4\n        with:\n          node-version: '22'/);
});
test('response on another page resolves exact ID/head/base',()=>{
  const a=audit([[req()],[res()]]); assert.equal(a.unresolved,''); assert.equal(a.items[0].state,'ANSWERED');
});
test('two page-separated unresolved scopes become one stable output line',()=>{
  const a=req('R-A'),b=req('R-B',{commentId:2});
  assert.equal(audit([[b],[a],[a]]).unresolved,`${key('R-A')}|${key('R-B')}`);
  assert.equal(audit([[b],[a]]).unresolved,audit([[a,b]]).unresolved);
});
test('owner RETURN template cannot self-satisfy',()=>{
  const r=req();r.body+=`\n\nRETURN\nCROSS_MODEL_RESPONSE R130-REVIEW\nreviewed_head: ${H}\nreviewed_base: ${B}\nverdict: GREEN_LIGHT`;
  assert.equal(audit([[r]]).unresolved,key());
});
for(const [label,user] of [['non-owner',OUTSIDER],['wrong owner ID',{...OWNER,id:1}],['wrong owner type',{...OWNER,type:'Bot'}]]) {
  test(`reject request from ${label}`,()=>assert.deepEqual(audit([[req(undefined,{user})]]).items,[]));
}
for(const [label,user] of [['owner',OWNER],['outsider',OUTSIDER],['wrong reviewer ID',{...BOT,id:1}],['wrong reviewer type',{...BOT,type:'User'}]]) {
  test(`reject response from ${label}`,()=>assert.equal(state([req(),res(undefined,{user})]),'UNRESOLVED'));
}
for(const id of ['bad;id','bad"id','$(touch SENTINEL)','a|b','a:b','a b','a\r\nb','x'.repeat(129)]) {
  test(`reject unsafe/ambiguous ID ${JSON.stringify(id).slice(0,38)}`,()=>assert.deepEqual(audit([[req(id)]]).items,[]));
}
test('quoted response in bot status does not count',()=>{
  const r=res();r.body='CROSS_MODEL_STATUS EXPLANATION\n'+r.body;
  assert.equal(state([req(),r]),'UNRESOLVED');
});
test('code-block response does not count',()=>{
  const r=res();r.body='```text\n'+r.body+'\n```';assert.equal(state([req(),r]),'UNRESOLVED');
});
test('same head with another ID/PR reference cannot resolve a scope',()=>{
  const r=res('OTHER');r.body+='\npr: 595';assert.equal(state([req(),r]),'UNRESOLVED');
});
for(const change of [{head:H2},{base:H2},{base:null},{time:NOW-3600000},{verdict:'WORKING'}]) {
  test(`mismatched/old response remains open ${JSON.stringify(change)}`,()=>assert.equal(state([req(),res(undefined,change)]),'UNRESOLVED'));
}
test('same ID different bases produce distinct keys, not collapsed fingerprint',()=>{
  // Main audits have no PR-base retirement requirement.
  const a=req('SAME',{head:M,pr:null}),b=req('SAME',{head:M,pr:null,base:H2,commentId:3});
  assert.equal(audit([[a,b]],{prPages:[[]]}).unresolved,[key('SAME',M,B),key('SAME',M,H2)].sort().join('|'));
});
test('latest duplicate request cannot reuse a preceding response',()=>{
  assert.equal(state([req(),res(),req(undefined,{commentId:3,time:NOW-1200000})]),'UNRESOLVED');
});
test('duplicate metadata is rejected, never inferred',()=>{
  const r=res();r.body+=`\nreviewed_head: ${H}`;assert.equal(state([req(),r]),'UNRESOLVED');
});
test('missing exact request head is ignored without granting anything',()=>{
  const a=audit([[req(undefined,{head:null})]]);assert.equal(a.unresolved,'');assert.equal(a.reviewAuthorization,false);
});
for(const [age,expected] of [[599999,'YOUNG'],[600000,'UNRESOLVED'],[86400000,'UNRESOLVED'],[86401000,'EXPIRED']]) {
  test(`age boundary ${age} => ${expected}`,()=>{
    const r=req(undefined,{time:NOW-age});
    // GitHub API timestamps use full seconds; normalize the sub-second boundary upward.
    if(age===599999)r.created_at='2026-10-07T06:20:01Z';
    assert.equal(state([r]),expected);
  });
}
test('closed PR retires delivery, never review authority',()=>{
  const a=audit([[req()]],{prPages:[[]]});assert.equal(a.items[0].state,'RETIRED_TARGET');assert.equal(a.reviewAuthorization,false);
});
test('replaced PR head retires delivery',()=>assert.equal(state([req()],{prPages:[[pr({head:{sha:H2,ref:'new'}})]]}),'RETIRED_TARGET'));
test('changed PR base retires the old exact-base request',()=>assert.equal(state([req()],{prPages:[[pr({base:{sha:H2}})]]}),'RETIRED_TARGET'));
test('current-main audit survives absence of open PRs',()=>assert.equal(audit([[req(undefined,{head:M,pr:null})]],{prPages:[[]]}).unresolved,key(undefined,M)));
test('head on a later PR page is not wrongly retired',()=>assert.equal(state([req()],{prPages:[[],[pr()]]}),'UNRESOLVED'));
test('explicit same-target supersedes retires only the named scope',()=>{
  const b=req('REPLACEMENT',{commentId:3,time:NOW-1200000});b.body+='\nsupersedes: R130-REVIEW';
  const a=audit([[req(),req('OTHER',{commentId:2}),b]]);
  assert.equal(a.items[0].state,'SUPERSEDED_DELIVERY');assert.ok(a.unresolved.includes(key('OTHER')));
});
test('cross-target supersedes is not a review or retirement',()=>{
  const b=req('REPLACEMENT',{head:M,pr:null,commentId:3});b.body+='\nsupersedes: R130-REVIEW';assert.equal(state([req(),b]),'UNRESOLVED');
});
test('head-less STALE_HEAD stops delivery only for one exact ID/base scope',()=>{
  const a=audit([[req(),res(undefined,{head:'none',verdict:'STALE_HEAD'})]]);
  assert.equal(a.items[0].state,'STALE_RESPONSE');assert.equal(a.reviewAuthorization,false);assert.equal(a.executionImpact,false);
});
test('head-less STALE_HEAD cannot consume same ID with multiple head/base scopes',()=>{
  const a=audit([[req(),req(undefined,{head:M,pr:null,commentId:3}),res(undefined,{commentId:4,head:'none',verdict:'STALE_HEAD',time:NOW-1000000})]]);
  assert.ok(a.items.every(x=>x.state==='UNRESOLVED'));
});
test('CHANGES_REQUIRED delivery is not approval',()=>{
  const a=audit([[req(),res(undefined,{verdict:'CHANGES_REQUIRED'})]]);assert.equal(a.items[0].state,'ANSWERED');assert.equal(a.reviewAuthorization,false);
});
for(const pages of [null,[],{},[{message:'API error'}],[[{id:1}]]]) {
  test(`invalid mailbox shape fails closed ${JSON.stringify(pages)}`,()=>assert.throws(()=>audit(pages)));
}
for(const prPages of [null,[],[{}],[[{number:595}]],[[pr({head:{sha:[H],ref:'x'}})]]]) {
  test(`invalid PR shape fails closed ${JSON.stringify(prPages).slice(0,35)}`,()=>assert.throws(()=>audit([[req()]],{prPages})));
}
test('conflicting copies from pagination abort',()=>{
  const x=req();assert.throws(()=>audit([[x],[{...x,body:'different'}]]),/conflicting/);
});
test('invalid API time aborts instead of ignoring all requests',()=>{
  assert.throws(()=>audit([[{...req(),created_at:'yesterday'}]]),/timestamp/);
});
test('real bot fingerprint across pages is recognized',()=>assert.equal(seen([[],[status()]]),true));
for(const [label,patch] of [['owner',{user:OWNER}],['wrong ID',{user:{...BOT,id:1}}],['quote',{body:'CROSS_MODEL_STATUS OTHER\n'+status().body}],['prefix-only',{body:status().body.replace(FP,FP+'ff')}],['duplicate-field',{body:status().body+'\nfingerprint: '+FP}]]) {
  test(`false fingerprint from ${label} cannot suppress review`,()=>assert.equal(seen([[status(patch)]]),false));
}

/** Real shell snippets extracted from the candidate workflow; gh/date are local fixtures. */
function shell(which, fixture={}, extraEnv={}) {
  const dir=mkdtempSync(join(tmpdir(),'meridian-r130-'));
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'bin'));
  copyFileSync(join(ROOT,'scripts/watchdog-mailbox.mjs'),join(dir,'scripts/watchdog-mailbox.mjs'));
  writeFileSync(join(dir,'fixture.json'),JSON.stringify({pages:[[req()],[res()]],prPages:[[pr()]],main:M,
    runPages:[{workflow_runs:[{name:'MERIDIAN Release Safety',status:'completed',conclusion:'success'}]}],
    reviewRuns:{total_count:0,workflow_runs:[]},...fixture}));
  writeFileSync(join(dir,'bin','gh'),`#!${process.execPath}\nconst fs=require('node:fs');const f=JSON.parse(fs.readFileSync(process.env.FIXTURE,'utf8'));const a=process.argv.slice(2);const q=a.join(' ');fs.appendFileSync(process.env.GH_CALLS,q+'\\n');if(f.fail&&q.includes(f.fail))process.exit(17);let out;if(q.includes('commits/main')){process.stdout.write(f.main+'\\n');process.exit(0)}else if(q.includes('/pulls?'))out=f.prPages;else if(q.includes('/issues/571/comments?'))out=f.pages;else if(q.includes('/actions/runs?'))out=f.runPages;else if(q.includes('/actions/workflows/')){console.log(JSON.stringify(f.reviewRuns));process.exit(0)}else process.exit(18);if(!a.includes('--paginate')||!a.includes('--slurp'))process.exit(19);console.log(JSON.stringify(out));`,{mode:0o755});
  writeFileSync(join(dir,'bin','date'),`#!${process.execPath}\nconsole.log(${NOW/1000});`,{mode:0o755});
  const script=runScript(which==='state'?'Compute cheap development fingerprint':'Decide whether Claude is needed');
  const output=join(dir,'output');const calls=join(dir,'calls');
  const run=spawnSync('bash',['-c',script],{cwd:dir,encoding:'utf8',timeout:10000,
    env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,FIXTURE:join(dir,'fixture.json'),GH_CALLS:calls,
      GITHUB_REPOSITORY:'Achi1984/meridian',GITHUB_OUTPUT:output,GH_TOKEN:'fixture-only',
      STATE_FINGERPRINT:FP,CACHE_HIT:'',CI_PENDING:'false',UNRESOLVED_REQUEST:'',MAILBOX_REVIEW_PENDING:'false',...extraEnv}});
  const text=existsSync(output)?readFileSync(output,'utf8'):'';
  const result={...run,text,values:Object.fromEntries(text.trim().split('\n').filter(Boolean).map(x=>{const n=x.indexOf('=');return[x.slice(0,n),x.slice(n+1)]})),
    calls:existsSync(calls)?readFileSync(calls,'utf8'):'',sentinel:existsSync(join(dir,'SENTINEL'))};
  rmSync(dir,{recursive:true,force:true});return result;
}
test('full state shell aggregates pages and writes valid single-line key=value output',()=>{
  const a=shell('state',{pages:[[req('R-A')],[req('R-B',{commentId:2})]]});
  assert.equal(a.status,0,a.stderr);assert.equal(a.values.unresolved_request,`${key('R-A')}|${key('R-B')}`);
  assert.ok(a.text.trim().split('\n').every(x=>/^[a-z_]+=/.test(x)));
});
test('full state shell validates exact page-separated response and full PR snapshot',()=>{
  const a=shell('state',{prPages:[[],[pr()]]});assert.equal(a.status,0,a.stderr);assert.equal(a.values.unresolved_request,'');assert.equal(a.values.active_pr,'595');
});
for(const fixture of [{fail:'/issues/'},{fail:'/pulls?'},{pages:[{message:'failure'}]},{prPages:[{}]},{runPages:[{message:'failure'}]},{reviewRuns:{message:'failure'}}]) {
  test(`state API failure does not write success outputs ${JSON.stringify(fixture)}`,()=>{
    const a=shell('state',fixture);assert.notEqual(a.status,0);assert.equal(a.text,'');
  });
}
for(const [env,reason] of [[{CACHE_HIT:'true'},'UNCHANGED'],[{CI_PENDING:'true'},'CI_PENDING'],[{UNRESOLVED_REQUEST:key(),MAILBOX_REVIEW_PENDING:'true'},'MAILBOX_REVIEW_PENDING']]) {
  test(`real decision path suppresses ${reason}`,()=>{
    const a=shell('decision',{},env);assert.equal(a.status,0,a.stderr);assert.equal(a.values.reason,reason);assert.equal(a.values.run_claude,'false');assert.equal(a.calls,'');
  });
}
test('real decision path suppresses only authenticated fingerprint',()=>{
  const a=shell('decision',{pages:[[],[status()]]});assert.equal(a.status,0,a.stderr);assert.equal(a.values.reason,'FINGERPRINT_ALREADY_COMMENTED');
  const b=shell('decision',{pages:[[status({user:OWNER})]]});assert.equal(b.status,0,b.stderr);assert.equal(b.values.reason,'STATE_CHANGED');
});
test('real decision fresh state authorizes only one invocation path',()=>{
  const a=shell('decision',{pages:[[]]});assert.equal(a.status,0,a.stderr);assert.equal(a.values.run_claude,'true');assert.equal(a.values.reason,'STATE_CHANGED');
});
for(const fixture of [{fail:'/issues/'},{pages:[{message:'error'}]}]) {
  test(`decision dedupe failure aborts rather than spending ${JSON.stringify(fixture)}`,()=>{
    const a=shell('decision',fixture);assert.notEqual(a.status,0);assert.equal(a.text,'');
  });
}
for(const value of ['$(touch SENTINEL)','x"; touch SENTINEL; #','x\nrun_claude=true']) {
  test(`shell boundary treats hostile environment as data ${JSON.stringify(value)}`,()=>{
    const a=shell('decision',{}, {UNRESOLVED_REQUEST:value});assert.notEqual(a.status,0);assert.equal(a.sentinel,false);assert.equal(a.text,'');assert.equal(a.calls,'');
  });
}
test('public forged request cannot inject shell text through complete state+decision path',()=>{
  const a=shell('state',{pages:[[req('$(touch SENTINEL)',{user:OUTSIDER})]]});
  assert.equal(a.status,0,a.stderr);assert.equal(a.values.unresolved_request,'');assert.equal(a.sentinel,false);
});

test('response with an earlier comment ID is not reused',()=>assert.equal(state([req(undefined,{commentId:10}),res(undefined,{commentId:9})]),'UNRESOLVED'));

test('duplicate response headers are ambiguous, never accepted',()=>{
  const r=res();r.body+='\nCROSS_MODEL_RESPONSE SECOND';assert.equal(state([req(),r]),'UNRESOLVED');
});
test('impossible calendar dates fail shape validation',()=>assert.throws(()=>audit([[{...req(),created_at:'2026-02-30T06:00:00Z'}]]),/timestamp/));
test('future response is not accepted',()=>assert.equal(state([req(),res(undefined,{time:NOW+300000})]),'UNRESOLVED'));
test('empty-but-successful paginated API snapshots are valid',()=>{
  const a=audit([[]],{prPages:[[]]});assert.equal(a.unresolved,'');assert.equal(a.reviewAuthorization,false);
});
