import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';

const NOW=Date.parse('2026-09-28T20:45:00.000Z');
function bot(overrides={}){
  return {
    id:'raw-secret-bot-id',
    botOrderId:'987654321',
    symbol:'HBAR',
    side:'LONG',
    leverage:4,
    lower:0.05,
    upper:0.15,
    liquidationPrice:0.06089,
    takeProfit:0.15,
    stopLoss:null,
    grids:287,
    position:35829.92,
    positionOpenPrice:0.11576,
    extraMargin:0,
    investmentUsd:null,
    investCurrency:'HBAR',
    quoteInvestment:35829.92,
    pnlUsd:-33.75,
    totalProfitPct:-0.82,
    source:'PIONEX_BOT_API',
    ...overrides
  };
}
function state(overrides={}){
  return {
    pionexRisk:{
      snapshotAt:'2026-09-28T20:40:00.000Z',
      detailsComplete:true,
      bots:[bot()]
    },
    pionexBotSync:{status:'OK',lastSuccessAt:'2026-09-28T20:40:00.000Z'},
    pionexAccountSync:{status:'OK',lastSuccessAt:'2026-09-28T20:39:00.000Z'},
    ...overrides
  };
}

test('asset-watch bridge exports only a fresh complete read-only Pionex bot snapshot',()=>{
  const x=buildAssetWatchApiSnapshot(state(),{now:NOW});
  assert.equal(x.usableForOverwrite,true);
  assert.equal(x.source,'PIONEX_BOT_API');
  assert.equal(x.botCount,1);
  assert.equal(x.bots[0].symbol,'HBAR');
  assert.equal(x.bots[0].side,'LONG');
  assert.equal(x.bots[0].limits.lower,0.05);
  assert.equal(x.bots[0].limits.upper,0.15);
  assert.equal(x.bots[0].limits.liquidationPrice,0.06089);
  assert.equal(x.bots[0].limits.takeProfit,0.15);
  assert.equal(x.bots[0].grid.grids,287);
  assert.equal(x.bots[0].position.positionOpenPrice,0.11576);
  assert.equal(x.bots[0].position.breakEvenPrice,null);
  assert.equal(x.readOnly,true);
  assert.equal(x.executionImpact,false);
});

test('asset-watch bridge never leaks raw Pionex bot IDs',()=>{
  const x=buildAssetWatchApiSnapshot(state(),{now:NOW});
  const raw=JSON.stringify(x);
  assert.doesNotMatch(raw,/987654321/);
  assert.doesNotMatch(raw,/raw-secret-bot-id/);
  assert.match(x.bots[0].botRef,/^[a-f0-9]{20}$/);
});

test('stale bot data fails closed and must not overwrite the watch snapshot',()=>{
  const x=buildAssetWatchApiSnapshot(state({
    pionexRisk:{snapshotAt:'2026-09-28T19:00:00.000Z',detailsComplete:true,bots:[bot()]},
    pionexBotSync:{status:'OK',lastSuccessAt:'2026-09-28T19:00:00.000Z'}
  }),{now:NOW});
  assert.equal(x.fresh,false);
  assert.equal(x.usableForOverwrite,false);
  assert.equal(x.overwriteRule,'ONLY_WHEN_usableForOverwrite_IS_TRUE');
});

test('wallet bot detail is an authenticated failover when primary bot sync is stale',()=>{
  const x=buildAssetWatchApiSnapshot(state({
    pionexRisk:{snapshotAt:'2026-09-28T19:00:00.000Z',detailsComplete:true,bots:[bot({symbol:'BTC'})]},
    pionexBotSync:{status:'ERROR',lastSuccessAt:'2026-09-28T19:00:00.000Z'},
    pionexAccount:{
      walletBotRisk:{
        snapshotAt:'2026-09-28T20:41:00.000Z',
        updatedAt:'2026-09-28T20:41:00.000Z',
        detailsComplete:true,
        bots:[bot({symbol:'SUI',source:'PIONEX_WALLET_BOT_DETAIL'})]
      }
    },
    pionexAccountSync:{status:'OK',lastSuccessAt:'2026-09-28T20:41:00.000Z'}
  }),{now:NOW});
  assert.equal(x.source,'PIONEX_WALLET_BOT_DETAIL');
  assert.equal(x.usableForOverwrite,true);
  assert.equal(x.bots[0].symbol,'SUI');
});

test('snapshot fingerprint is stable across bot order and changes when a limit changes',()=>{
  const a=bot({botOrderId:'a',symbol:'BTC',lower:55000});
  const b=bot({botOrderId:'b',symbol:'ETH',lower:1500});
  const s1=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[a,b]}});
  const s2=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[b,a]}});
  const s3=state({pionexRisk:{snapshotAt:'2026-09-28T20:40:00.000Z',detailsComplete:true,bots:[b,{...a,lower:54000}]}});
  const x1=buildAssetWatchApiSnapshot(s1,{now:NOW});
  const x2=buildAssetWatchApiSnapshot(s2,{now:NOW});
  const x3=buildAssetWatchApiSnapshot(s3,{now:NOW});
  assert.equal(x1.snapshotFingerprint,x2.snapshotFingerprint);
  assert.notEqual(x1.snapshotFingerprint,x3.snapshotFingerprint);
});
