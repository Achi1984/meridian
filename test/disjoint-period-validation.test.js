import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDisjointPeriods } from '../disjoint-period-validation.js';

function row(outcomeR,raw){return{outcomeR,side:raw.side||'LONG',regime:raw.regime||'RANGE',baselineStatus:raw.baselineStatus||'READY',frames:{'15m':{price:100,ema20:100,ema50:99,atr:1,adx:raw.adx15??20,rsi:raw.rsi15??55,volumeRatio:raw.volume15??1.6,macdHist:1},'1h':{price:100,ema20:100,ema50:99,atr:1,adx:20,rsi:55,volumeRatio:1,macdHist:1},'4h':{price:100,ema20:100,ema50:99,atr:1,adx:20,rsi:55,volumeRatio:1,macdHist:1}}};}

test('marks a candidate robust across disjoint periods',()=>{
  const periods={P0:[],P1:[],P2:[],P3:[]};
  for(const p of Object.keys(periods))for(let i=0;i<40;i++)periods[p].push(row(i<24?1.4:-1,{volume15:1.7,rsi15:54}));
  const report=validateDisjointPeriods(periods,{minSamples:30,candidates:[{id:'X',match:{volume15:'>=1.5',rsi15:'50-58'}}]});
  assert.equal(report.candidates[0].adequatePeriods,4);
  assert.equal(report.candidates[0].positivePeriods,4);
  assert.equal(report.candidates[0].robust,true);
});

test('rejects insufficient or inconsistent candidates',()=>{
  const periods={P0:[],P1:[],P2:[],P3:[]};
  for(let i=0;i<40;i++){periods.P0.push(row(1,{volume15:1.7,rsi15:54}));periods.P1.push(row(-1,{volume15:1.7,rsi15:54}));periods.P2.push(row(-1,{volume15:1.7,rsi15:54}));}
  for(let i=0;i<10;i++)periods.P3.push(row(1,{volume15:1.7,rsi15:54}));
  const report=validateDisjointPeriods(periods,{minSamples:30,candidates:[{id:'X',match:{volume15:'>=1.5',rsi15:'50-58'}}]});
  assert.equal(report.candidates[0].adequatePeriods,3);
  assert.equal(report.candidates[0].positivePeriods,1);
  assert.equal(report.candidates[0].robust,false);
});
