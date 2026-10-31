import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalletBotRisk,normalizeWalletBotEntries} from '../pionex-account-read-sync.js';
import {buildAssetWatchApiSnapshot} from '../asset-watch-bridge.js';
import {buildBotReadModel} from '../v11/bot-read-model.js';
const AT='2026-10-31T06:40:00.000Z',NOW=Date.parse(AT)+1000;
function row(wallet={},fields={},prices={}){
  const risk=buildWalletBotRisk({candidateCount:1,buOrderTypeCounts:{futures_grid:1},successBuOrderTypeCounts:{futures_grid:1},details:[{
    wallet:{buOrderId:'test-pnl',buOrderType:'futures_grid',baseList:['BTC.PERP'],investmentToken:'USDT',cateType:'FUTURES_MOON',...wallet},
    detail:{base:'BTC.PERP',quote:'USDT',status:'running',buOrderData:{status:'running',trend:'long',...fields}}
  }]},AT,prices);
  assert.equal(risk.bots.length,1);return risk.bots[0];
}
function snapshot(bot){return buildAssetWatchApiSnapshot({pionexRisk:{snapshotAt:AT,detailsComplete:true,bots:[bot]},pionexBotSync:{status:'OK',lastSuccessAt:AT}},{now:NOW});}
function metrics(s){const m=buildBotReadModel(s,{now:NOW});assert.equal(m.status,'FRESH_SNAPSHOT');return m.bots[0].metrics;}
function expect(bot,reason,value=null){assert.equal(bot.pnlUnavailableReason,reason);const s=snapshot(bot);assert.equal(s.bots[0].pnl.unavailableReason,reason);assert.equal(metrics(s).pnlUnavailableReason,reason);assert.equal(metrics(s).pnlUsd,value);}
test('absent or invalid wallet profit never becomes zero or an inferred unit problem',()=>{
  for(const profit of [undefined,null,'',' ',false,true,[],{},'bad',Infinity]){
    const normalized=normalizeWalletBotEntries([{type:'TRADING_BOT',list:[{buOrderId:'x',profit}]}]);
    assert.equal(normalized.length,1);assert.equal(normalized[0].profit,null);
    expect(row({profit}),'USD_VALUE_MISSING');
  }
});
test('actual native profit without confirmed conversion reports unit uncertainty, even zero',()=>{
  for(const cateType of ['FUTURES_MOON','linear',null,'unknown'])for(const profit of [0,'0',-12,'12'])expect(row({cateType,profit}),'WALLET_PROFIT_UNIT_UNCONFIRMED');
  expect(row({cateType:'inverse',investmentToken:'ETH',profit:12}),'WALLET_PROFIT_UNIT_UNCONFIRMED');
});
test('existing inverse conversion differentiates missing USD price and known results',()=>{
  for(const priceInUsd of [undefined,null,'',false,0,-1,'bad'])expect(row({cateType:'inverse',investmentToken:'BTC',profit:2},{},{BTC:{priceInUsd}}),'WALLET_USD_PRICE_MISSING');
  expect(row({cateType:'inverse',investmentToken:'BTC',profit:-2},{},{BTC:{priceInUsd:10}}),null,-20);
  expect(row({cateType:'inverse',investmentToken:'BTC',profit:0},{},{BTC:{priceInUsd:10}}),'ZERO_VALUE_UNCONFIRMED');
});
test('detail USD value has precedence, preserving conservative explicit zero policy',()=>{
  expect(row({profit:100},{totalProfitUsd:0}),'ZERO_VALUE_UNCONFIRMED');
  expect(row({profit:100},{totalProfitUsd:-3}),null,-3);
});
test('old persisted and old bridge rows remain generic; untrusted reason strings are bounded',()=>{
  const bot=row();delete bot.pnlUnavailableReason;
  const s=snapshot(bot);assert.equal(metrics(s).pnlUnavailableReason,'USD_VALUE_MISSING');
  delete s.bots[0].pnl.unavailableReason;assert.equal(s.bots[0].pnl.usd,0);
  assert.equal(metrics(s).pnlUnavailableReason,'USD_VALUE_MISSING');
  for(const invalid of ['<script>',{},'X'.repeat(10000)]){
    assert.equal(snapshot({...bot,pnlUnavailableReason:invalid}).bots[0].pnl.unavailableReason,'USD_VALUE_MISSING');
    s.bots[0].pnl.unavailableReason=invalid;assert.equal(metrics(s).pnlUnavailableReason,'USD_VALUE_MISSING');
  }
  const available=snapshot({...bot,pnlUsd:-5,pnlUnavailableReason:'USD_VALUE_MISSING'});
  assert.equal(available.bots[0].pnl.unavailableReason,null);assert.equal(metrics(available).pnlUnavailableReason,null);
});
