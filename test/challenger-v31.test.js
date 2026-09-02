import test from 'node:test';
import assert from 'node:assert/strict';
import { challengerV31Decision } from '../challenger-v31.js';

const base={side:'LONG',entry:100,sl:95,tp1:107,technical:88,candidate:86,regime:'BULL',distanceAtr:.35,status:'READY'};

test('V3.1 keeps Baseline READY as soft evidence only',()=>{
  const x=challengerV31Decision({...base,status:'WAIT_ENTRY_ZONE',technical:95,candidate:94,distanceAtr:.4});
  assert.notEqual(x.decision,'SKIP');
  assert.equal(x.baselineReadyDependency,false);
});

test('V3.1 sharply reduces risk outside READY without hard blocking',()=>{
  const ready=challengerV31Decision({...base});
  const wait=challengerV31Decision({...base,status:'WAIT_ENTRY_ZONE',technical:99,candidate:99,distanceAtr:.2});
  assert.ok(wait.riskPct>0);
  assert.ok(wait.riskPct<ready.riskPct);
});

test('distance penalty is materially steeper than near-entry setup',()=>{
  const near=challengerV31Decision({...base,distanceAtr:.2});
  const far=challengerV31Decision({...base,distanceAtr:1.5});
  assert.ok(near.confidence>far.confidence);
  assert.ok(far.reasons.includes('ENTRY_DISTANCE_SOFT_PENALTY'));
});

test('NO_SETUP remains theoretically tradeable only with exceptional evidence',()=>{
  const strong=challengerV31Decision({...base,status:'NO_SETUP',technical:100,candidate:100,distanceAtr:.05});
  assert.ok(['TRADE','CAUTION','SKIP'].includes(strong.decision));
  assert.equal(strong.baselineReadyDependency,false);
  if(strong.decision!=='SKIP')assert.ok(strong.riskPct<=.25);
});

test('invalid geometry remains a true safety gate',()=>{
  const x=challengerV31Decision({...base,sl:0});
  assert.equal(x.decision,'SKIP');
  assert.deepEqual(x.reasons,['INVALID_SIGNAL']);
});
