import test from 'node:test';
import assert from 'node:assert/strict';
import { contextDescriptor, buildContextReliabilityMap, crossWindowContextReliability } from '../context-reliability-v776.js';

function row({side='LONG',regime='RANGE',r=1.4,rsi=60,vol=1.3,atr=.8,price=100,aligned=true}={}){
  const ema20=aligned?(side==='LONG'?99:101):(side==='LONG'?101:99);
  const ema50=aligned?(side==='LONG'?98:102):(side==='LONG'?100:100);
  const macd=aligned?(side==='LONG'?1:-1):(side==='LONG'?-1:1);
  const f={price,ema20,ema50,rsi,macdHist:macd,atr,adx:22,volumeRatio:vol};
  return {side,regime,baselineStatus:'READY',candidate:75,technical:74,outcomeR:r,frames:{'15m':f,'1h':f,'4h':f}};
}

test('context descriptor exposes side/regime and context buckets',()=>{
  const d=contextDescriptor(row());
  assert.equal(d.sideRegime,'LONG×RANGE');
  assert.match(d.evidence,/^EVIDENCE_/);
  assert.equal(d.mtf,'MTF_3/3');
  assert.equal(d.volume,'VOLUME_HIGH');
  assert.equal(d.momentum,'MOMENTUM_SUPPORTIVE');
});

test('map computes winner capture and loss exposure relative to side/regime parent',()=>{
  const rows=[];
  for(let i=0;i<20;i++)rows.push(row({r:i<12?1.4:-1,vol:i<10?1.3:.9}));
  const m=buildContextReliabilityMap(rows,{minSamples:5});
  const c=m.cells.find(x=>x.key==='LONG×RANGE|VOLUME_HIGH');
  assert.ok(c);
  assert.equal(c.adequate,true);
  assert.ok(c.winnerCaptureRate>=0&&c.winnerCaptureRate<=100);
  assert.ok(c.lossExposureRate>=0&&c.lossExposureRate<=100);
});

test('cross-window robustness requires positive edge with no negative adequate windows',()=>{
  const make=(avgR,pf)=>({cells:[{key:'LONG×RANGE|MTF_3/3',adequate:true,samples:30,avgR,pf,winRate:55,captureEfficiency:8,winnerCaptureRate:60,lossExposureRate:52}]});
  const r=crossWindowContextReliability({P0:make(.1,1.2),P1:make(.08,1.15),P2:make(.12,1.3),P3:make(.09,1.25)},{minWindows:3});
  assert.equal(r.robustCells.length,1);
  assert.equal(r.robustCells[0].key,'LONG×RANGE|MTF_3/3');
  assert.equal(r.promotionAllowed,false);
});
