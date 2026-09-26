import test from 'node:test';
import assert from 'node:assert/strict';
import {newFundingCarryV2State,fundingEligibilityV2,openFundingCarryV2,applyFundingSettlementsV2,markFundingCarryV2,fundingCarryV2ExitReason,fundingCarryV2Status,FUNDING_CARRY_V2_CONFIG,FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED,FUNDING_CARRY_V2_RETIREMENT_REASON} from '../funding-carry-paper-v2.js';

const DAY=86400000,now=Date.UTC(2026,8,13),snapshot={spotAsk:100000,spotBid:99990,perpBid:100020,perpAsk:100030};
function rows(rate=.0001){return Array.from({length:90},(_,i)=>({fundingTime:now-(89-i)*8*3600000,fundingRate:rate,markPrice:100000}));}

test('V2 rejects carry that cannot amortize conservative executable costs',()=>{
  const e=fundingEligibilityV2(rows(.00004),snapshot,now);assert.equal(e.eligible,false);assert.ok(e.reasons.includes('NET_CARRY_BELOW_HURDLE'));assert.equal(e.estimatedRoundTripCostsUsd,42);
});

test('V2 accepts persistent high carry with fresh complete history',()=>{
  const e=fundingEligibilityV2(rows(.00012),snapshot,now);assert.equal(e.eligible,true);assert.ok(e.grossCostCoverage>=2);
});

test('V2 settlement application deduplicates duplicate timestamps in one payload and restart',()=>{
  const cfg={...FUNDING_CARRY_V2_CONFIG,minGrossCostCoverage:0};let s=newFundingCarryV2State(now-2*DAY,cfg),e={eligible:true};s=openFundingCarryV2(s,snapshot,e,now-2*DAY);
  const row={fundingTime:now-DAY,fundingRate:.0001,markPrice:100000};s=applyFundingSettlementsV2(s,[row,row],now);const income=s.basket.fundingIncome;s=applyFundingSettlementsV2(s,[row],now);
  assert.equal(s.settlements.length,1);assert.equal(s.basket.fundingIncome,income);
});

test('V2 basis exit uses change from entry, not absolute basis',()=>{
  const cfg={...FUNDING_CARRY_V2_CONFIG,minGrossCostCoverage:0,maxBasisChangePct:1.5,maxLossPct:100};let s=newFundingCarryV2State(now,cfg);s=openFundingCarryV2(s,snapshot,{eligible:true},now);
  s=markFundingCarryV2(s,{spotBid:100000,perpAsk:101500},now+1);assert.equal(fundingCarryV2ExitReason(s,[],now+1),null);
  s=markFundingCarryV2(s,{spotBid:100000,perpAsk:101800},now+2);assert.equal(fundingCarryV2ExitReason(s,[],now+2),'BASIS_CHANGE');
});

test('V2 is manage-only after repeatability sample gate result',()=>{
  assert.equal(FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED,false);
  assert.equal(FUNDING_CARRY_V2_RETIREMENT_REASON,'REPEATABILITY_SAMPLE_GATE_6_LT_8');
  const s=fundingCarryV2Status(newFundingCarryV2State(now));
  assert.equal(s.newEntriesAllowed,false);
  assert.equal(s.retirementReason,'REPEATABILITY_SAMPLE_GATE_6_LT_8');
});
