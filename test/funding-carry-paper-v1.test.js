import test from 'node:test';
import assert from 'node:assert/strict';
import {newFundingCarryPaperState,fundingEligibility,openFundingCarryPaper,applyFundingSettlements,markFundingCarryPaper,fundingCarryExitReason,closeFundingCarryPaper,fundingCarryPaperStatus,FUNDING_CARRY_PAPER_V1_RULESET} from '../funding-carry-paper-v1.js';

const HOUR=3600000,DAY=86400000;
function fundingRows(now,rate=.00006,count=90){return Array.from({length:count},(_,i)=>({fundingTime:now-(count-i)*8*HOUR,fundingRate:rate,markPrice:100000}));}

test('entry requires sufficient persistent funding above the frozen cost buffer',()=>{
  const now=Date.UTC(2026,8,9),pass=fundingEligibility(fundingRows(now),now),fail=fundingEligibility(fundingRows(now,.00001),now);
  assert.equal(pass.eligible,true);assert.equal(pass.periods,90);assert.equal(pass.sumFundingRate,.0054);
  assert.equal(fail.eligible,false);assert.ok(fail.reasons.includes('FUNDING_BELOW_COST_BUFFER'));
});

test('paper basket is delta neutral, reserves all costs and applies funding once',()=>{
  const now=Date.UTC(2026,8,9),eligibility=fundingEligibility(fundingRows(now),now);
  let s=openFundingCarryPaper(newFundingCarryPaperState(now),{spotPrice:100000,perpMarkPrice:100100},eligibility,{now,id:'cycle-1'});
  assert.equal(s.basket.quantity,.1);assert.equal(s.basket.spotSide,'LONG');assert.equal(s.basket.perpSide,'SHORT');
  assert.ok(s.basket.netPnl<0); // round-trip fees and slippage are reserved before profit is claimed
  const settlement={fundingTime:now+8*HOUR,fundingRate:.001,markPrice:100000};
  s=applyFundingSettlements(s,[settlement],now+9*HOUR);const once=s.basket.fundingIncome;
  s=applyFundingSettlements(s,[settlement],now+10*HOUR);
  assert.equal(s.basket.fundingIncome,once);assert.equal(s.settlements.length,1);
  s=markFundingCarryPaper(s,{spotPrice:101000,perpMarkPrice:101100},now+10*HOUR);
  assert.equal(s.basket.basisPnl,0);assert.equal(s.ruleset,FUNDING_CARRY_PAPER_V1_RULESET);
});

test('30-day checkpoint stops one prospective cycle for review without re-entry',()=>{
  const now=Date.UTC(2026,8,9),eligibility=fundingEligibility(fundingRows(now),now);
  let s=openFundingCarryPaper(newFundingCarryPaperState(now),{spotPrice:100000,perpMarkPrice:100000},eligibility,{now,id:'cycle-1'});
  const review=now+30*DAY;
  assert.equal(fundingCarryExitReason(s,[],review),'REVIEW_30D');
  s=closeFundingCarryPaper(s,{spotPrice:100000,perpMarkPrice:100000},'REVIEW_30D',review);
  assert.equal(s.lifecycle,'STOPPED_REVIEW');assert.equal(s.basket,null);assert.equal(s.closedCycles.length,1);
  const status=fundingCarryPaperStatus(s);assert.equal(status.executionImpact,false);assert.equal(status.autoPromotion,false);
});

test('basis divergence and account loss are explicit stop conditions',()=>{
  const now=Date.UTC(2026,8,9),eligibility=fundingEligibility(fundingRows(now),now);
  let s=openFundingCarryPaper(newFundingCarryPaperState(now),{spotPrice:100000,perpMarkPrice:100000},eligibility,{now});
  s=markFundingCarryPaper(s,{spotPrice:100000,perpMarkPrice:101600},now+HOUR);
  assert.equal(fundingCarryExitReason(s,[],now+HOUR),'BASIS_DIVERGENCE');
});
