import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {getPaperReadiness} from '../v11/paper-readiness.js';

const source=readFileSync(new URL('../v11/paper-readiness.js',import.meta.url),'utf8');
const contract=readFileSync(new URL('../docs/strategy-lab/FORWARD_PAPER_V1_CONTRACT_SPEC.md',import.meta.url),'utf8');

test('readiness presents source preparation only and cannot admit a run',()=>{
  const model=getPaperReadiness();
  assert.equal(model.scope,'SOURCE_PREPARATION_ONLY');
  assert.equal(model.status,'NOT_READY');
  for(const key of ['paperAuthorized','liveAuthorized','canStart'])assert.equal(model[key],false);
  assert.equal(getPaperReadiness({paperAuthorized:true,status:'READY',canStart:true}),model,
    'caller data is never admission authority');
  assert.doesNotMatch(source,/\b(?:fetch|localStorage|sessionStorage|setInterval|Date|process)\b/);
  assert.doesNotMatch(source,/^import\b/m,'presentation does not import or execute a simulator');
});

test('all twelve groups and exact fields track the canonical unset configuration',()=>{
  const section=contract.slice(contract.indexOf('## 3.'),contract.indexOf('## 4.'));
  const rows=section.split('\n').filter(line=>line.startsWith('| `'));
  const fields=rows.map(line=>[...line.split('|')[1].matchAll(/`([^`]+)`/g)].map(match=>match[1]));
  assert.equal(rows.length,12,'canonical choices changed; update projection explicitly');
  assert.deepEqual(getPaperReadiness().choices.map(item=>item.fields),fields);
  for(const item of getPaperReadiness().choices)assert.equal(item.status,'REQUIRED_UNSET');
  assert.equal(new Set(getPaperReadiness().choices.map(item=>item.id)).size,12);
});

test('nested source snapshot is immutable across consumers',()=>{
  const model=getPaperReadiness();
  assert.throws(()=>{model.choices[0].status='SELECTED';},TypeError);
  assert.throws(()=>{model.choices[0].fields.push('extra');},TypeError);
  assert.throws(()=>{model.gates.length=0;},TypeError);
  assert.throws(()=>{model.prepared[0].evidencePath='untrusted';},TypeError);
  assert.equal(getPaperReadiness().choices.length,12);
  assert.equal(getPaperReadiness().gates.length,5);
});

test('implemented synthetic model stays separate from missing operational gates',()=>{
  const model=getPaperReadiness();
  assert.deepEqual(model.prepared.map(item=>item.id),['contracts','accounting','unknown']);
  assert.deepEqual(model.gates.map(item=>[item.id,item.status]),[
    ['qualification','UNVERIFIED'],['source-time','UNVERIFIED'],['journal','UNVERIFIED'],
    ['reconciliation-contract','UNSPECIFIED'],['admission','NOT_AUTHORIZED'],
  ]);
  const receipt=readFileSync(new URL('../docs/strategy-lab/SYNTHETIC_PAPER_HARNESS_RECEIPT.md',import.meta.url),'utf8');
  assert.match(receipt,/ephemeral in-memory fake journal/);
  assert.match(receipt,/does not implement reconciliation/);
  assert.match(contract,/reconciliation-resolution receipt envelope is \*\*UNSPECIFIED\*\*/);
  for(const item of [...model.prepared,...model.gates]){
    assert.ok(item.label&&item.detail);
    assert.ok(readFileSync(new URL('../'+item.evidencePath,import.meta.url),'utf8').length);
  }
  assert.match(model.nextStep,/Absturztests/);
});

test('dated D2 assessment is scoped to one trial and preserves pending private acceptance',()=>{
  const gate=getPaperReadiness().gates.find(item=>item.id==='qualification');
  assert.deepEqual(gate.assessment,{
    sourceCheckedOn:'2026-10-31',sourcePath:'MERIDIAN_LIVE_CHECKPOINT.json',
    sourceKey:'currentWork.d2NoEdge935',issue:935,snapshotCommentId:6448721244,
    assessmentCommentId:6449045864,completedTrialCount:1,screenResult:'NO_EDGE',
    fullPrivateResultIndependentAcceptance:'PENDING',
  });
  assert.match(gate.detail,/keine Bewertung aller zwölf Hypothesen/);
  assert.match(gate.detail,/Abnahme des vollständigen privaten Ergebnisses bleibt offen/);
  assert.equal(gate.status,'UNVERIFIED','NO_EDGE is not a readiness verdict');
  assert.throws(()=>{gate.assessment.screenResult='PASS';},TypeError);
});
