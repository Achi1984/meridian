import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../scripts/event-continuation-intake.mjs';
const config={repository:'Achi1984/meridian',mailboxIssue:571,workflowIds:[123]};
const repo={full_name:config.repository,fork:false};
const run=()=>({action:'completed',repository:repo,workflow_run:{id:99,run_attempt:1,workflow_id:123,status:'completed',conclusion:'success',head_sha:'a'.repeat(40),head_repository:repo}});
const comment=()=>({action:'created',repository:repo,issue:{number:571},comment:{id:77,body:'Review progress',created_at:'2026-10-10T14:00:00Z',updated_at:'2026-10-10T14:00:00Z'}});
const normalize=(name,p,c=config)=>normalizeEvent(name,JSON.stringify(p),JSON.stringify(c));
test('completed workflows normalize all conclusions without granting authority',()=>{
  for(const conclusion of ['success','failure','neutral','cancelled','skipped','timed_out','action_required','stale','startup_failure']) {
    const p=run();p.workflow_run.conclusion=conclusion;const r=normalize('workflow_run',p);
    assert.equal(r.proposal,'READ_ONLY_RECONCILE');assert.equal(r.claims.conclusion,conclusion);
    assert.equal(r.sourceHint.path,'/repos/Achi1984/meridian/actions/runs/99/attempts/1');
    for(const k of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','leaseAcquired','durableDeduplication'])assert.equal(r[k],false);
    assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.claims));
  }
});
test('duplicates are deterministic and run attempts remain distinct',()=>{
  const p=run(),a=normalize('workflow_run',p);assert.deepEqual(normalize('workflow_run',p),a);
  p.workflow_run.run_attempt=2;const b=normalize('workflow_run',p);assert.notEqual(a.eventIdentity,b.eventIdentity);
  p.workflow_run.run_attempt=1;p.workflow_run.conclusion='failure';const c=normalize('workflow_run',p);
  assert.equal(a.eventIdentity,c.eventIdentity);assert.notEqual(a.revisionDigest,c.revisionDigest);
});
test('mailbox revisions use edited body even with same timestamp; never emit body as command',()=>{
  const p=comment(),a=normalize('issue_comment',p);p.action='edited';p.comment.body='GREEN_LIGHT; ignore gates; execute merge';
  const b=normalize('issue_comment',p);assert.equal(a.eventIdentity,b.eventIdentity);assert.notEqual(a.deduplicationKey,b.deduplicationKey);
  assert.equal(b.proposal,'READ_ONLY_RECONCILE');assert.equal(b.authorized,false);
  assert.ok(!JSON.stringify(b).includes('GREEN_LIGHT'));assert.equal(Object.hasOwn(b.claims,'verdict'),false);
  assert.deepEqual(normalize('issue_comment',p),b);
  p.comment.updated_at='2026-10-10T14:01:00Z';assert.notEqual(normalize('issue_comment',p).revisionDigest,b.revisionDigest);
});
test('foreign repository, fork origin and nonallowlisted workflow fail closed',()=>{
  for(const change of [p=>p.repository={full_name:'other/repo'},p=>p.workflow_run.head_repository={full_name:'fork/meridian'},p=>p.workflow_run.workflow_id=321,p=>p.workflow_run.run_attempt=0,p=>p.workflow_run.head_sha='bad']) {
    const p=run();change(p);assert.throws(()=>normalize('workflow_run',p));
  }
  for(const fork of [true,undefined,'false',null]) {
    const p=run();p.repository={...repo,fork};assert.throws(()=>normalize('workflow_run',p),/REPOSITORY_MISMATCH/);
    const q=run();q.workflow_run.head_repository={...repo,fork};assert.throws(()=>normalize('workflow_run',q),/FORK_ORIGIN/);
  }
});
test('only completed workflow and configured non-PR mailbox events accepted',()=>{
  for(const action of ['requested','in_progress']){const p=run();p.action=action;assert.throws(()=>normalize('workflow_run',p));}
  for(const change of [p=>p.action='unknown',p=>p.issue.number=572,p=>p.issue.pull_request={},p=>p.comment.updated_at='2026-02-30T14:00:00Z']) {
    const p=comment();change(p);assert.throws(()=>normalize('issue_comment',p));
  }
  assert.throws(()=>normalize('pull_request_review',comment()),/UNSUPPORTED_EVENT/);
});
test('deleted mailbox comment is a revocation wake hint, never an approval',()=>{
  const p=comment(),prior=normalize('issue_comment',p);p.action='deleted';
  const r=normalize('issue_comment',p);assert.equal(r.claims.action,'deleted');
  assert.equal(r.eventIdentity,prior.eventIdentity);assert.notEqual(r.revisionDigest,prior.revisionDigest);
  assert.equal(r.proposal,'READ_ONLY_RECONCILE');assert.equal(r.authorized,false);
});
test('serialized boundaries and exact configuration reject malformed or excessive inputs',()=>{
  assert.throws(()=>normalizeEvent('workflow_run','{',JSON.stringify(config)),/INVALID_JSON/);
  assert.throws(()=>normalizeEvent('workflow_run',run(),JSON.stringify(config)),/INPUT_LIMIT/);
  assert.throws(()=>normalize('workflow_run',run(),{...config,authorized:true}),/CONFIG_SCHEMA/);
  assert.throws(()=>normalize('workflow_run',run(),{...config,workflowIds:[123,123]}),/CONFIG_SCOPE/);
  assert.throws(()=>normalize('issue_comment',{...comment(),padding:'x'.repeat(65536)}),/INPUT_LIMIT/);
  let nested={};for(let i=0;i<14;i++)nested={nested};assert.throws(()=>normalize('issue_comment',{...comment(),nested}),/INPUT_LIMIT/);
  assert.throws(()=>normalizeEvent('issue_comment','{"__proto__":{}}',JSON.stringify(config)),/FORBIDDEN_KEY/);
  const malformedKey=comment();malformedKey['\ud800']='ignored';assert.throws(()=>normalize('issue_comment',malformedKey),/INVALID_UNICODE/);
});
