import test from 'node:test';
import assert from 'node:assert/strict';
import { executableUniverseEvidence, __test } from '../meta-executable-universe-evidence.js';

const row=({ts=1,r=1,b='TRADE',s='SKIP',c='TRADE',rg='TRADE',bs='LONG',rs='LONG'}={})=>({
  ts,outcome:{realizedR:r},actions:{supportive:[b,s,c,rg].filter(x=>['TRADE','CAUTION'].includes(x)).length},
  disagreement:{sideConflict:bs!==rs&&['TRADE','CAUTION'].includes(rg),hardDisagreement:[b,s,c,rg].some(x=>['TRADE','CAUTION'].includes(x))&&[b,s,c,rg].some(x=>x==='SKIP')},
  opinions:[{bot:'BASELINE',action:b,side:bs},{bot:'SHADOW',action:s,side:bs},{bot:'CHALLENGER',action:c,side:bs},{bot:'REGIME',action:rg,side:rs}]
});

test('classifies baseline-ready before broader universes',()=>{
  assert.equal(__test.universeKey(row()),'BASELINE_READY');
  assert.equal(__test.universeKey(row({b:'SKIP',rg:'TRADE'})),'REGIME_ONLY');
  assert.equal(__test.universeKey(row({b:'SKIP',rg:'SKIP',c:'CAUTION'})),'ANY_SUPPORT');
});

test('predeclared baseline subclasses are emitted',()=>{
  const k=__test.subclasses(row({s:'TRADE',c:'CAUTION',rg:'TRADE'}));
  assert(k.includes('BASELINE_READY|SHADOW_SUPPORT'));
  assert(k.includes('BASELINE_READY|CHALLENGER_CAUTION'));
  assert(k.includes('BASELINE_READY|NO_REGIME_SIDE_CONFLICT'));
});

test('candidate class requires positive multi-fold evidence',()=>{
  const rows=[];
  for(let i=0;i<30;i++)rows.push(row({ts:i*1000,r:.4,s:'TRADE',c:'TRADE',rg:'TRADE'}));
  const e=executableUniverseEvidence(rows,{folds:5});
  const x=e.candidateClasses.find(x=>x.key==='BASELINE_READY|SHADOW_SUPPORT');
  assert(x);
  assert.equal(x.activeFolds,5);
  assert.equal(x.positiveFolds,5);
  assert.equal(e.promotion.allowed,false);
});
