import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCurrentDepotModel} from '../v11/depot-current-model.js';
const NOW=Date.parse('2026-10-14T00:00:00Z'),iso=x=>new Date(x).toISOString();
const options=()=>({now:NOW,tickersAt:NOW-1000,tickers:[{symbol:'BTCUSDT',price:'100.00'}]});
function fixture(){return {private:true,data:{portfolio:{ledgerAuthorityAt:iso(NOW-10000),
  holdings:[{venue:'Ledger',symbol:'BTC',quantity:2},{venue:'Pionex',symbol:'BTC',quantity:999}],
  manualVenueBalances:[{venue:'OKX',valueUsd:50,updatedAt:iso(NOW-20000),source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'},
    {venue:'Ledger',valueUsd:999,updatedAt:iso(NOW-20000)}],
  pionexEquityUsd:30,pionexEquityUpdatedAt:iso(NOW-30000),pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT'},
  pionexRisk:{bots:[{investmentUsd:999999,pnlUsd:999999}]}}};}
function unknown(model){assert.notEqual(model.status,'FRESH_SNAPSHOT');for(const k of ['totalUsd','spotUsd','tradingUsd','snapshotAt','sourceAt','expiresAt'])assert.equal(model[k],null);assert.equal(model.readOnly,true);assert.equal(model.executionAllowed,false);}
test('current server valuation is independent of history and bot capital, avoids double counting Ledger',()=>{
  const p=fixture(),before=JSON.stringify(p),m=buildCurrentDepotModel(p,options());
  assert.equal(m.status,'FRESH_SNAPSHOT');assert.equal(m.totalUsd,280);assert.equal(m.spotUsd,250);assert.equal(m.tradingUsd,30);
  assert.equal(m.snapshotAt,iso(NOW-30000));assert.equal(m.sourceAt,iso(NOW-30000));assert.equal(m.expiresAt,NOW-1000+180000);
  assert.equal(m.source,'SERVER_PORTFOLIO_CURRENT');assert.equal(m.readOnly,true);assert.equal(m.executionAllowed,false);
  assert.equal(JSON.stringify(p),before);assert.doesNotMatch(JSON.stringify(m),/999999|BTC|privateRevision/);
});
test('complete server venue aggregates work without tickers and preserve genuine zero',()=>{
  const p=fixture();delete p.data.portfolio.ledgerAuthorityAt;
  const m=buildCurrentDepotModel(p,{now:NOW});assert.equal(m.totalUsd,1079);assert.equal(m.expiresAt,NOW-30000+900000);
  p.data.portfolio.manualVenueBalances.forEach(r=>r.valueUsd=0);p.data.portfolio.pionexEquityUsd=0;
  assert.equal(buildCurrentDepotModel(p,{now:NOW}).totalUsd,0);
});
test('missing server authority cannot be supplied by private old prices, holdings or bot investments',()=>{
  const p=fixture();delete p.data.portfolio.ledgerAuthorityAt;p.data.portfolio.manualVenueBalances=p.data.portfolio.manualVenueBalances.slice(0,1);
  p.data.livePrices={BTC:{price:999}};p.data.livePriceMeta={fresh:true};unknown(buildCurrentDepotModel(p,options()));
  const q=fixture();q.data.portfolio.manualVenueBalances=[];unknown(buildCurrentDepotModel(q,options()));
});
test('fresh actual wallet wins only with both OK statuses; never invent wallet authority',()=>{
  const p=fixture();p.data.pionexAccount={walletStatus:'OK',updatedAt:iso(NOW-2000),wallet:{totalInUsdt:40}};p.data.pionexAccountSync={status:'OK'};
  assert.equal(buildCurrentDepotModel(p,options()).totalUsd,290);
  p.data.pionexAccountSync.status='ERROR';assert.equal(buildCurrentDepotModel(p,options()).totalUsd,280);
  delete p.data.portfolio.pionexEquityUsd;unknown(buildCurrentDepotModel(p,options()));
});
test('Pionex selects newer direct authority over an older wallet and accepts zero wallet',()=>{
  const p=fixture();p.data.pionexAccount={walletStatus:'OK',updatedAt:iso(NOW-50000),wallet:{totalInUsdt:40}};p.data.pionexAccountSync={status:'OK'};
  assert.equal(buildCurrentDepotModel(p,options()).tradingUsd,30);
  p.data.pionexAccount.updatedAt=iso(NOW-1000);p.data.pionexAccount.wallet.totalInUsdt=0;
  assert.equal(buildCurrentDepotModel(p,options()).tradingUsd,0);
});
test('all selected source deadlines are enforced, with no provenance from request time',()=>{
  for(const mutate of [p=>p.data.portfolio.pionexEquityUpdatedAt=iso(NOW-900001),
    p=>p.data.portfolio.manualVenueBalances[0].updatedAt=iso(NOW-86400001)]){
    const p=fixture();mutate(p);const m=buildCurrentDepotModel(p,options());unknown(m);assert.equal(m.status,'STALE');
  }
  const m=buildCurrentDepotModel(fixture(),{...options(),tickersAt:NOW-180001});unknown(m);assert.equal(m.status,'STALE');
  const p=fixture();p.data.portfolio.ledgerAuthorityAt=iso(NOW-86400000+1000);
  assert.equal(buildCurrentDepotModel(p,options()).expiresAt,NOW+1000);
  p.data.portfolio.ledgerAuthorityAt=iso(NOW-86400001);
  // V10 server semantics fall back only to a genuinely current Ledger aggregate.
  assert.equal(buildCurrentDepotModel(p,{now:NOW}).totalUsd,1079);
});
test('future, normalized impossible, missing and malformed timestamps fail closed',()=>{
  const mutations=[p=>p.data.portfolio.ledgerAuthorityAt=iso(NOW+1),p=>p.data.portfolio.manualVenueBalances[0].updatedAt=iso(NOW+1),
    p=>p.data.portfolio.pionexEquityUpdatedAt=iso(NOW+1),p=>p.data.portfolio.pionexEquityUpdatedAt='2026-02-30T00:00:00Z',
    p=>delete p.data.portfolio.pionexEquityUpdatedAt];
  for(const mutate of mutations){const p=fixture();mutate(p);unknown(buildCurrentDepotModel(p,options()));}
  for(const tickersAt of [undefined,null,true,'',NOW+1,Infinity])unknown(buildCurrentDepotModel(fixture(),{...options(),tickersAt}));
});
test('missing prices never fall back to holding/stored values; all-price request may include an unrelated zero',()=>{
  const p=fixture();Object.assign(p.data.portfolio.holdings[0],{price:999,value:999,valueUsd:999});
  for(const tickers of [undefined,[],[{symbol:'BTCUSDT',price:'0'}],[{symbol:'ETHUSDT',price:'1'}],
    [{symbol:'BTCUSDT',price:'100'},{symbol:'BTCUSDT',price:'200'}]])unknown(buildCurrentDepotModel(p,{...options(),tickers}));
  assert.equal(buildCurrentDepotModel(p,{...options(),tickers:[...options().tickers,{symbol:'DEADUSDT',price:'0'}]}).totalUsd,280);
});
test('malformed amounts cannot be coerced into money or a partial total',()=>{
  for(const value of [null,undefined,'', ' ', '1e2', '0x10', '+10', '01', '-1',true,false,NaN,Infinity,-1]){
    for(const mutate of [p=>p.data.portfolio.manualVenueBalances[0].valueUsd=value,p=>p.data.portfolio.holdings[0].quantity=value,
      p=>p.data.portfolio.pionexEquityUsd=value]){
      const p=fixture();mutate(p);unknown(buildCurrentDepotModel(p,options()));
    }
  }
  for(const price of [null,undefined,true,false,'','NaN',Infinity,-1])unknown(buildCurrentDepotModel(fixture(),{...options(),tickers:[{symbol:'BTCUSDT',price}]}));
  const p=fixture();p.data.pionexAccount={walletStatus:'OK',updatedAt:iso(NOW-1000),wallet:{totalInUsdt:true}};p.data.pionexAccountSync={status:'OK'};
  unknown(buildCurrentDepotModel(p,options()));
});
test('canonical decimal strings match numeric holdings, venue and API wallet amounts',()=>{
  const p=fixture();p.data.portfolio.holdings[0].quantity='2.000';
  p.data.portfolio.manualVenueBalances.forEach(r=>r.valueUsd=String(r.valueUsd));
  p.data.portfolio.pionexEquityUsd='30.00';
  assert.equal(buildCurrentDepotModel(p,options()).totalUsd,280);
  p.data.pionexAccount={walletStatus:'OK',updatedAt:iso(NOW-2000),wallet:{totalInUsdt:'40.00'}};
  p.data.pionexAccountSync={status:'OK'};assert.equal(buildCurrentDepotModel(p,options()).tradingUsd,40);
  p.data.pionexAccount.wallet.totalInUsdt='0.000';assert.equal(buildCurrentDepotModel(p,options()).tradingUsd,0);
});
test('RFC3339 offsets are equivalent to UTC with exact calendar validation',()=>{
  const p=fixture(),expected=buildCurrentDepotModel(p,options());
  p.data.portfolio.ledgerAuthorityAt='2026-10-14T01:59:50+02:00';
  p.data.portfolio.manualVenueBalances[0].updatedAt='2026-10-13T18:59:40-05:00';
  p.data.portfolio.pionexEquityUpdatedAt='2026-10-14T01:59:30.000000+02:00';
  assert.deepEqual(buildCurrentDepotModel(p,{...options(),tickersAt:'2026-10-14T01:59:59+02:00'}),expected);
  for(const value of ['2026-02-30T01:00:00+01:00','2026-13-01T00:00:00+01:00',
    '2026-10-13T24:00:00+01:00','2026-10-13T20:60:00+01:00','2026-10-13T20:00:60+01:00',
    '2026-10-13T20:00:00+24:00','2026-10-13T20:00:00+01:60','2026-10-14T03:00:00+02:00']){
    const bad=fixture();bad.data.portfolio.pionexEquityUpdatedAt=value;unknown(buildCurrentDepotModel(bad,options()));
  }
});
test('bounds, private wrapper, overflow and fallback sources do not yield a value',()=>{
  for(const mutate of [p=>p.private=false,p=>p.data.portfolio.holdings=Array(1001).fill({}),
    p=>p.data.portfolio.manualVenueBalances=Array(101).fill({}),p=>p.data.portfolio.pionexEquitySource='FALLBACK_SCREENSHOT',
    p=>p.data.portfolio.holdings[0].quantity=Number.MAX_VALUE]){
    const p=fixture();mutate(p);unknown(buildCurrentDepotModel(p,options()));
  }
  unknown(buildCurrentDepotModel(fixture(),{...options(),tickers:Array(10001).fill({})}));
  const p=fixture();p.data.portfolio.pionexEquitySource='secret<error>';
  const m=buildCurrentDepotModel(p,options());unknown(m);assert.doesNotMatch(JSON.stringify(m),/secret/);
});
