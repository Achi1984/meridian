import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS,
  averageRanks,
  pearson,
  spearman,
  partialSpearman,
  runSpotPerpBasisVolatilityRegimeV1
} from '../research/spot-perp-basis-volatility-regime-v1.js';

const H=3600000;
const BAR=8*H;
const DAY=24*H;

test('average ranks use deterministic average ties',()=>{
  assert.deepEqual(averageRanks([3,1,1,5]),[3,1.5,1.5,4]);
});

test('Spearman and partial Spearman are positive for monotone independent signal',()=>{
  const x=[1,4,2,5,3,8,6,9,7,10];
  const y=x.map(v=>v*2);
  const z=[10,1,8,2,7,3,6,4,5,0];
  assert.ok(spearman(x,y)>.99);
  assert.ok(partialSpearman(x,y,z)>.9);
  assert.ok(pearson([1,2,3],[2,4,6])>.99);
});

function featureForDay(dayIndex){
  return .0002+(((dayIndex*37)%101)+1)*.00003;
}

function makeSyntheticAsset({positive=true,missingTime=null}={}){
  const start=Date.UTC(2024,4,1);
  const end=Date.UTC(2025,8,2);
  const spot=[],perp=[];
  let perpPrice=100;

  for(let open=start;open<end;open+=BAR){
    const closeAnchor=open+BAR;
    const driverDay=Math.floor((closeAnchor-1)/DAY);
    const dayStart=driverDay*DAY;
    const dIndex=Math.floor((dayStart-start)/DAY);
    const f=featureForDay(dIndex);
    const pos=Math.round((closeAnchor-dayStart)/BAR); // 1,2,3
    const mag=positive?f:(.001+((dIndex*13+pos*7)%19)*.00001);
    const sign=pos===2?-1:1;
    const prev=perpPrice;
    perpPrice=perpPrice*Math.exp(sign*mag);
    const pClose=perpPrice;

    const anchorDay=Math.floor(closeAnchor/DAY);
    const atMidnight=closeAnchor===anchorDay*DAY;
    const signalF=featureForDay(Math.floor((closeAnchor-start)/DAY));
    const basis=atMidnight?(positive?signalF:.001):.0005;
    const sClose=pClose/Math.exp(basis);

    const pOpen=prev;
    const sOpen=sClose;
    const pHigh=Math.max(pOpen,pClose)*1.0001;
    const pLow=Math.min(pOpen,pClose)*.9999;
    const sHigh=sClose*1.0001;
    const sLow=sClose*.9999;

    if(open!==missingTime){
      spot.push([open,open+BAR-1,sOpen,sHigh,sLow,sClose]);
      perp.push([open,open+BAR-1,pOpen,pHigh,pLow,pClose]);
    }
  }
  return{spot,perp};
}

function syntheticDataset(opts={}){
  const out={};
  for(const a of SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS)out[a]=makeSyntheticAsset(opts);
  return out;
}

test('positive synthetic basis-to-forward-vol relation passes frozen discovery gate',()=>{
  const r=runSpotPerpBasisVolatilityRegimeV1(syntheticDataset({positive:true}),{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.dataIntegrityErrors.slice(0,3)));
  assert.equal(r.anchors,364);
  assert.equal(r.byAsset.every(x=>x.observations===364),true);
  assert.ok(r.pooled.spearmanBasisForward>.5,r.pooled.spearmanBasisForward);
  assert.ok(r.pooled.partialSpearmanBasisForwardControllingLag>.2,r.pooled.partialSpearmanBasisForwardControllingLag);
  assert.ok(r.pooled.topQuartileUpliftRatio>1.1,r.pooled.topQuartileUpliftRatio);
  assert.equal(r.stability.positiveWindows,5);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
  assert.equal(r.strategyPnlCalculated,false);
});

test('null synthetic relation fails feature gate without any PnL',()=>{
  const r=runSpotPerpBasisVolatilityRegimeV1(syntheticDataset({positive:false}),{stage:'DISCOVERY'});
  assert.equal(r.strategyPnlCalculated,false);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.length>0);
});

test('one missing exact 8h row fails stage closed',()=>{
  const missing=Date.UTC(2025,0,15,8);
  const d=syntheticDataset({positive:true});
  d.APT=makeSyntheticAsset({positive:true,missingTime:missing});
  const r=runSpotPerpBasisVolatilityRegimeV1(d,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.dataIntegrityErrors.some(x=>x.asset==='APT'));
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});

test('discovery stage ends before holdout and has no strategy fields',()=>{
  const r=runSpotPerpBasisVolatilityRegimeV1(syntheticDataset({positive:true}),{stage:'DISCOVERY'});
  assert.equal(r.end,Date.UTC(2025,7,31));
  assert.equal(r.strategyPnlCalculated,false);
  assert.equal('netPnl' in r,false);
  assert.equal('trades' in r,false);
});
