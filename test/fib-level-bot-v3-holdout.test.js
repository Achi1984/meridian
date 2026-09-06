import test from 'node:test';
import assert from 'node:assert/strict';
import {FIB_V3_HOLDOUT,evaluateFibV3Holdout} from '../fib-level-bot-v3-holdout.js';

test('decision is blocked before both time and sample eligibility',()=>{const x=evaluateFibV3Holdout({summary:{closedBaskets:200}},'2027-01-01T00:00:00Z');assert.equal(x.status,'NOT_ELIGIBLE');assert.equal(x.reviewPermitted,false)});
test('passing evidence permits review but never promotion',()=>{const good={closedBaskets:40,profitFactor:1.2,expectancy:.1},snapshot={summary:{...good,closedBaskets:120,maxDrawdownR:10},walkForward:[1,2,3].map(()=>({summary:good})),bySide:{LONG:good,SHORT:good},bySymbol:Object.fromEntries(['BTC','ETH','SOL','XRP','ADA','AVAX','LINK'].map(k=>[k,good])),byUniverseGroup:{CORE:good,EXPANSION:good},positiveNetRConcentrationPct:Object.fromEntries(['BTC','ETH','SOL','XRP','ADA','AVAX','LINK'].map(k=>[k,100/7])),dataAdequate:true},x=evaluateFibV3Holdout(snapshot,FIB_V3_HOLDOUT.earliestEligibility);assert.equal(x.status,'REVIEW_ELIGIBLE');assert.equal(x.reviewPermitted,true);assert.equal(x.promotionPermitted,false)});
