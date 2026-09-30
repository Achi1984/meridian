import test from 'node:test';
import assert from 'node:assert/strict';
import {TSMOM_V2_PREREGISTRATION,freezeTsmomV2Split} from '../research/paper-profit-tsmom-v2-preregistration.js';

test('TSMOM V2 preregistration preserves documented-edge parameters and Stage-B safety',()=>{
  const x=TSMOM_V2_PREREGISTRATION;
  assert.equal(x.ruleset,'PAPER_PROFIT_TSMOM_V2_PREREGISTERED');
  assert.deepEqual(x.universe,['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
  assert.deepEqual(x.config.lookbacks,[30,90,365]);
  assert.equal(x.config.rebalanceDays,30);
  assert.equal(x.config.volLookbackDays,60);
  assert.equal(x.config.targetVolAnnual,0.10);
  assert.equal(x.config.maxLeverage,2);
  assert.equal(x.config.baselineCostBps,8);
  assert.equal(x.config.stressCostBps,16);
  assert.equal(x.config.pyramiding,false);
  assert.equal(x.config.martingale,false);
  assert.equal(x.config.averagingDown,false);
  assert.equal(x.gate.maxDrawdownPct,20);
  assert.equal(x.gate.minPositiveAssets,5);
  assert.equal(x.executionImpact,false);
  assert.equal(x.autoPromotion,false);
});

test('TSMOM V2 chronological split is deterministic and result-independent',()=>{
  const xs=Array.from({length:100},(_,i)=>1000+i);
  const a=freezeTsmomV2Split(xs);
  const b=freezeTsmomV2Split([...xs].reverse().concat(xs.slice(0,10)));
  assert.deepEqual(a,b);
  assert.equal(a.discoveryCount,70);
  assert.equal(a.holdoutCount,30);
  assert.equal(a.splitTimestamp,1070);
});

test('TSMOM V2 documentation freezes no-rescue and holdout rules',async()=>{
  const fs=await import('node:fs');
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-TSMOM-V2-PREREGISTRATION.md','utf8');
  for(const marker of [
    'FROZEN BEFORE RESULT INSPECTION',
    'first 70% of common eligible timestamps',
    'final 30% of common eligible timestamps',
    'INSUFFICIENT_SPLIT_SAMPLE',
    'No label authorizes live execution.'
  ]) assert.ok(doc.includes(marker),marker);
});
