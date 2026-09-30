import test from 'node:test';
import assert from 'node:assert/strict';
import {runTsmomV2Discovery} from '../research/paper-profit-tsmom-v2-evaluator.js';

function synthetic(days=900){
  const start=Date.UTC(2022,0,1),symbols=['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'];
  return Object.fromEntries(symbols.map((s,j)=>[s,Array.from({length:days},(_,i)=>{
    const p=100*Math.exp((0.0006+0.00001*j)*i)*(1+0.02*Math.sin(i/17+j));
    return{openTime:start+i*86400000,closeTime:start+(i+1)*86400000-1,open:p,high:p*1.01,low:p*.99,close:p,volume:1};
  })]));
}

test('TSMOM V2 fails closed when split cannot produce Stage-B discovery sample',()=>{
  const r=runTsmomV2Discovery(synthetic(500));
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.decision,'INSUFFICIENT_SPLIT_SAMPLE');
  assert.equal(r.holdout,null);
});

test('TSMOM V2 never evaluates holdout when discovery fails',()=>{
  const data=synthetic(1880);
  for(const rows of Object.values(data))for(let i=1;i<rows.length;i++)rows[i].close=100+(i%2?1:-1)*0.01;
  const r=runTsmomV2Discovery(data);
  assert.notEqual(r.decision,'TSMOM_V2_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED');
  if(r.decision==='TSMOM_V2_DISCOVERY_FAIL')assert.equal(r.holdout,null);
});

test('TSMOM V2 workflow remains read-only',async()=>{
  const fs=await import('node:fs');
  const y=fs.readFileSync('.github/workflows/paper-profit-tsmom-v2.yml','utf8');
  assert.ok(y.includes('workflow_dispatch:'));
  assert.ok(y.includes('permissions:\n  contents: read'));
  assert.ok(y.includes('node research/run-paper-profit-tsmom-v2.mjs'));
});
