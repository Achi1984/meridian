import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRawFeatures, featureEdgeMap, crossWindowFeatureStability } from '../feature-attribution.js';

const row=(outcomeR,extra={})=>({
  side:'LONG',regime:'BULL',baselineStatus:'READY',outcomeR,
  frames:{
    '15m':{price:101,ema20:100,ema50:99,rsi:55,macdHist:.5,adx:27,atr:2,volumeRatio:1.2},
    '1h':{price:102,ema20:100,ema50:98,rsi:58,macdHist:1,adx:30,atr:4,volumeRatio:1.1},
    '4h':{price:104,ema20:100,ema50:96,rsi:60,macdHist:2,adx:36,atr:8,volumeRatio:1}
  },...extra
});

test('extractRawFeatures is side-aware and exposes raw evidence buckets',()=>{
  const x=extractRawFeatures(row(1));
  assert.equal(x.mtfAlignment,'3/3');
  assert.equal(x.macdAgreement,'3/3');
  assert.equal(x.emaStructure15,'ALIGNED');
  assert.equal(x.priceVsEma20_15,'ALIGNED');
  assert.equal(x.sideRegime,'LONG×BULL');
  assert.equal(x.emaDistanceAtr15,'0.5-0.75');
});

test('SHORT interpretation flips directional alignment rather than reusing LONG meaning',()=>{
  const x=extractRawFeatures(row(1,{side:'SHORT',regime:'BEAR'}));
  assert.equal(x.emaStructure15,'OPPOSED');
  assert.equal(x.macdAgreement,'0/3');
  assert.equal(x.sideRegime,'SHORT×BEAR');
});

test('featureEdgeMap summarizes normalized R without portfolio gates',()=>{
  const rows=[row(1.4),row(-1),row(1.4),row(-1,{regime:'RANGE'})];
  const x=featureEdgeMap(rows,{minSamples:1,features:['regime','mtfAlignment']});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.equal(x.samples,4);
  assert.equal(x.overall.totalR,.8);
  const bull=x.features.regime.buckets.find(b=>b.bucket==='BULL');
  assert.equal(bull.samples,3);
  assert.equal(bull.avgR,.6);
  assert.equal(bull.adequate,true);
});

test('cross-window stability only marks repeatable adequate direction',()=>{
  const w30=featureEdgeMap([row(1),row(1)],{minSamples:2,features:['mtfAlignment']});
  const w60=featureEdgeMap([row(.5),row(.5)],{minSamples:2,features:['mtfAlignment']});
  const w90=featureEdgeMap([row(-1),row(-1)],{minSamples:2,features:['mtfAlignment']});
  const stable=crossWindowFeatureStability({'30d':w30,'60d':w60,'90d':w90});
  const bucket=stable.features.mtfAlignment.find(x=>x.bucket==='3/3');
  assert.equal(bucket.windows,3);
  assert.equal(bucket.consistentDirection,false);
  assert.equal(bucket.direction,'MIXED');
});
