import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInteractionEvidence, evaluateInteractionEvidence, INTERACTION_SPECS } from '../context-interaction-evidence.js';

const DAY=86400000;
const obs=(extra={})=>({side:'LONG',regime:'RANGE',mtfAlignment:'2',momentum:'NEUTRAL',volume:'NORMAL',volatility:'NORMAL',asset:'AAAUSDT',baselineStatus:'READY',...extra});
const row=(ts,realizedR,extra={})=>({ts,realizedR,observations:obs(extra)});
const windows=(start,count=4)=>Array.from({length:count},(_,i)=>({id:`W${i+1}`,start:start+i*10*DAY,end:start+(i+1)*10*DAY-1}));

test('interaction set is bounded and explicitly predefined',()=>{
  assert.deepEqual(INTERACTION_SPECS.map(x=>x.id),[
    'SIDE_REGIME_MTF','SIDE_REGIME_MOMENTUM','SIDE_REGIME_VOLATILITY','ASSET_SIDE_REGIME','SIDE_MTF_MOMENTUM','SIDE_VOLUME_VOLATILITY'
  ]);
});

test('child equal to negative parent base rate has near-zero residual evidence',()=>{
  const start=Date.UTC(2026,0,1),rows=[];
  for(let i=0;i<160;i++)rows.push(row(start+i*6*60*60000,-0.4,{mtfAlignment:i%2?'2':'1'}));
  const map=buildInteractionEvidence(rows,windows(start));
  const g=map.specs.SIDE_REGIME_MTF.groups['LONG|RANGE|2'];
  assert.ok(g.eligible);
  assert.ok(Math.abs(g.rawResidualR)<0.001);
  assert.ok(Math.abs(g.residualR)<0.001);
});

test('interaction learns positive residual relative to a negative parent rather than rewarding the parent loss',()=>{
  const start=Date.UTC(2026,0,1),rows=[];
  for(let i=0;i<240;i++){
    const special=i%3===0;
    rows.push(row(start+i*4*60*60000,special?0.35:-0.55,{mtfAlignment:special?'3':'1'}));
  }
  const map=buildInteractionEvidence(rows,windows(start));
  const g=map.specs.SIDE_REGIME_MTF.groups['LONG|RANGE|3'];
  assert.ok(g.eligible);
  assert.ok(g.parent.avgR<0);
  assert.ok(g.rawResidualR>0);
  assert.ok(g.residualR>0);
});

test('small fragmented interaction buckets are ineligible and neutral',()=>{
  const start=Date.UTC(2026,0,1),rows=[];
  for(let i=0;i<150;i++)rows.push(row(start+i*6*60*60000,-0.2,{asset:i<20?'TINYUSDT':'AAAUSDT'}));
  const map=buildInteractionEvidence(rows,windows(start));
  const g=map.specs.ASSET_SIDE_REGIME.groups['TINYUSDT|LONG|RANGE'];
  assert.equal(g.eligible,false);
  assert.equal(g.residualR,0);
});

test('evaluator uses only eligible reliable residual components',()=>{
  const start=Date.UTC(2026,0,1),rows=[];
  for(let i=0;i<320;i++){
    const special=i%2===0;
    rows.push(row(start+i*3*60*60000,special?0.45:-0.6,{
      mtfAlignment:special?'3':'1',momentum:special?'STRONG':'WEAK',volatility:special?'NORMAL':'COMPRESSION'
    }));
  }
  const map=buildInteractionEvidence(rows,windows(start));
  const e=evaluateInteractionEvidence(obs({mtfAlignment:'3',momentum:'STRONG',volatility:'NORMAL'}),map);
  assert.ok(e.components.length>0);
  assert.ok(e.residualR>0);
  assert.ok(['TRADE','CAUTION'].includes(e.decision));
});
