import test from 'node:test';
import assert from 'node:assert/strict';
import {ELLIOTT_ABC_REVERSAL_V1,runElliottAbcReversalV1} from '../elliott-abc-reversal-v1.js';

const H4=4*3600000;

test('frozen ABC contract remains fixed',()=>{
  const c=ELLIOTT_ABC_REVERSAL_V1;
  assert.equal(c.pivot4h,3);
  assert.equal(c.pivot1d,2);
  assert.equal(c.noiseLookbackDays,30);
  assert.equal(c.noiseMultiple,2);
  assert.equal(c.bMin,.382);
  assert.equal(c.bMax,.786);
  assert.equal(c.cMin,.8);
  assert.equal(c.cMax,1.618);
  assert.equal(c.entryFib,.236);
  assert.equal(c.costR,.05);
  assert.deepEqual(c.symbols,['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']);
});

test('engine is research-only and does not expose execution hooks',()=>{
  const bars=[];let p=100;
  for(let i=0;i<60*6;i++){
    const t=i*H4,o=p,c=p+(i%12<6?.1:-.08),h=Math.max(o,c)+.05,l=Math.min(o,c)-.05;
    bars.push({t,o,h,l,c});p=c;
  }
  const r=runElliottAbcReversalV1(bars,{symbol:'BTCUSDT'});
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal('placeOrder' in r,false);
  assert.equal('submitOrder' in r,false);
  assert.ok(Array.isArray(r.closed));
  assert.ok(Array.isArray(r.setups));
});

test('entry window cannot admit fills after its end',()=>{
  const bars=[];let p=100;
  for(let i=0;i<90*6;i++){
    const t=i*H4;
    const wave=Math.sin(i/7)*2+Math.sin(i/31)*5;
    const c=100+i*.01+wave,o=p,h=Math.max(o,c)+.3,l=Math.min(o,c)-.3;
    bars.push({t,o,h,l,c});p=c;
  }
  const end=20*H4;
  const r=runElliottAbcReversalV1(bars,{symbol:'ETHUSDT',entryStart:0,entryEnd:end});
  assert.ok(r.closed.every(x=>x.openedAt<end));
  assert.ok(r.open.every(x=>x.openedAt<end));
});
