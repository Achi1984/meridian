import test from 'node:test';
import assert from 'node:assert/strict';
import {gate,frozenCosts,eligibleSetup,findTrigger,openCandidate} from '../research/paper-edge-v1-discovery-engine.js';

test('frozen costs charge fee plus slippage once per fill',()=>assert.equal(frozenCosts(10000),8));

test('discovery gate passes only full frozen contract',()=>{
 const byAsset=Object.fromEntries(['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>[s,{closedTrades:20,netPnl:1}]));
 const s={closedTrades:60,byAsset,profitFactor:1.3,stressProfitFactor:1.1,expectancyR:.1,maxDrawdownPct:5,positiveWindows:5,positivePnlConcentrationPct:40,bySide:{LONG:{closedTrades:30,profitFactor:1},SHORT:{closedTrades:30,profitFactor:1}},integrityOk:true};
 assert.equal(gate(s).pass,true);
 assert.equal(gate({...s,profitFactor:1.19}).decision,'EDGE_V1_DISCOVERY_FAIL');
});

test('eligible setup retains derived daily regime fields',()=>{
 const t=Date.parse('2024-01-02T00:00:00Z');
 const prepared={
  four:[{openTime:t,open:105,high:108,low:104,close:106,closeTime:t+14399999,volume:1,warm:true,ema20:105,ema50:100,atr14:2,adx14:25}],
  daily:[{openTime:t-86400000,open:100,high:110,low:90,close:108,closeTime:t-1,volume:1,ema50:105,ema200:95,regime:'LONG'}]
 };
 const setup=eligibleSetup(prepared,0);
 assert.equal(setup?.side,'LONG');
 assert.equal(setup?.daily?.regime,'LONG');
});


test('initial stop uses completed trigger-bar ATR, never entry-bar ATR',()=>{
 const daily=[{openTime:0,open:1,high:1,low:1,close:1,closeTime:999,volume:1,regime:'LONG'}];
 const four=[{openTime:1000,atr14:1},{openTime:2000,atr14:2},{openTime:3000,atr14:100,open:110}];
 const trigger={side:'LONG',pullback:{low:99},triggerIndex:1,entryIndex:2,entry:110};
 const p=openCandidate({symbol:'BTCUSDT',prepared:{daily,four},trigger,equity:10000});
 assert.equal(p.stop,99);
});

test('trigger and entry are invalidated when daily regime no longer matches setup side',()=>{
 const daily=[
  {openTime:0,open:1,high:1,low:1,close:1,closeTime:999,volume:1,regime:'LONG'},
  {openTime:1000,open:1,high:1,low:1,close:1,closeTime:1999,volume:1,regime:'SHORT'}
 ];
 const four=[{openTime:1000},{openTime:2000,close:111},{openTime:3000,open:112}],setup={side:'LONG',pullback:{high:110},index:0};
 assert.equal(findTrigger({daily,four},setup),null);
});
