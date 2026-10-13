import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCrossMarketTrend } from '../docs/strategy-lab/cross-market-trend.mjs';
const months=Array.from({length:13},(_,i)=>`${2024+Math.floor((i+8)/12)}-${String((i+8)%12+1).padStart(2,'0')}`);
const asset=(symbol,end=110)=>({symbol,months:[...months],totalReturnIndex:[100,...Array(11).fill(105),end]});
const input=()=>({asOfMonth:'2025-10',assets:[asset('EQUITY'),asset('BONDS',90),asset('GOLD',100),asset('COMMODITIES',120)]});
function invalid(x){const r=evaluateCrossMarketTrend(x);assert.equal(r.valid,false);assert.equal(r.cashWeight,1);assert.deepEqual(r.signals,[]);assert.ok(r.errors.length);assert.equal(r.executionAuthorized,false);}
test('positive annual signals retain fixed sleeves; negative and flat stay cash',()=>{const r=evaluateCrossMarketTrend(input());assert.equal(r.valid,true);assert.equal(r.cashWeight,.5);assert.deepEqual(r.signals.map(s=>s.weight),[.25,0,0,.25]);assert.equal(r.executionAuthorized,false);assert.equal(r.researchOnly,true);});
test('one eligible asset cannot absorb three inactive sleeves',()=>{const x=input();x.assets[3]=asset('COMMODITIES',95);const r=evaluateCrossMarketTrend(x);assert.equal(r.cashWeight,.75);assert.equal(r.signals[0].weight,.25);});
test('all flat markets remain wholly cash',()=>{const x=input();x.assets=x.assets.map(a=>asset(a.symbol,100));assert.equal(evaluateCrossMarketTrend(x).cashWeight,1);});
test('signal is 12-month endpoint comparison, not a one-month move',()=>{const x=input();x.assets[0].totalReturnIndex[11]=200;const r=evaluateCrossMarketTrend(x);assert.equal(r.signals[0].decision,'LONG');assert.ok(Math.abs(r.signals[0].twelveMonthReturn-.1)<1e-12);});
test('current-month and stale endpoint each reject whole basket',()=>{for(const month of ['2025-09','2025-11']){const x=input();x.asOfMonth=month;invalid(x);}});
test('missing, duplicated or reordered monthly records reject',()=>{for(const mode of ['missing','duplicate','reorder']){const x=input();if(mode==='missing')x.assets[0].months.splice(5,1);if(mode==='duplicate')x.assets[0].months[5]=x.assets[0].months[4];if(mode==='reorder')[x.assets[0].months[4],x.assets[0].months[5]]=[x.assets[0].months[5],x.assets[0].months[4]];invalid(x);}});
test('invalid values at any month and mismatched price counts reject',()=>{for(const v of [0,-1,NaN,Infinity,'100',null]){const x=input();x.assets[1].totalReturnIndex[4]=v;invalid(x);}const x=input();x.assets[1].totalReturnIndex.pop();invalid(x);});
test('duplicate symbols and malformed dates reject',()=>{const x=input();x.assets[1].symbol='EQUITY';invalid(x);for(const d of ['2025-00','2025-13','2025-1','bad']){const x=input();x.asOfMonth=d;invalid(x);}});
test('invalid root, empty universe and unknown fields fail closed',()=>{for(const x of [null,{},[],{...input(),extra:true},{...input(),assets:[]}])invalid(x);});
test('overflowed ratio rejects instead of selecting asset',()=>{const x=input();x.assets[0].totalReturnIndex[0]=Number.MIN_VALUE;x.assets[0].totalReturnIndex[12]=Number.MAX_VALUE;invalid(x);});
test('deterministic and does not mutate input',()=>{const x=input();const before=structuredClone(x);assert.deepEqual(evaluateCrossMarketTrend(x),evaluateCrossMarketTrend(x));assert.deepEqual(x,before);});
