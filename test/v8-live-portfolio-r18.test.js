import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pricingAsset,buildLivePriceOverlay,clearStaleLivePrices} from '../v8-clean/live-price-core-r18.js';
import {portfolioPriceCoverage} from '../portfolio-data-contract.js';

test('R18 maps wrapped assets to canonical live price assets',()=>{
  assert.equal(pricingAsset('BETH'),'ETH');
  assert.equal(pricingAsset('OKSOL'),'SOL');
  assert.equal(pricingAsset('XRP'),'XRP');
});

test('R18 overlays fetched prices and marks fixed stable values as policy assumptions',()=>{
  const data={portfolio:{holdings:[
    {symbol:'BTC',quantity:1,venue:'OKX'},
    {symbol:'BETH',quantity:2,venue:'OKX'},
    {symbol:'USDC',quantity:100,venue:'Ledger'},
    {symbol:'VSN',quantity:10,venue:'Bitpanda'},
    {symbol:'BTC',quantity:1,venue:'Pionex'}
  ]},livePrices:{BTC:{price:1}}};
  const out=buildLivePriceOverlay(data,[{symbol:'BTCUSDT',price:'80000'},{symbol:'ETHUSDT',price:'4000'}],123);
  assert.equal(out.livePrices.BTC.price,80000);
  assert.equal(out.livePrices.BTC.fetchedAt,123);
  assert.equal(out.livePrices.BTC.sourceQuality,'PUBLIC_LIVE_FETCH');
  assert.equal(out.livePrices.BETH.price,4000);
  assert.equal(out.livePrices.USDC.price,1);
  assert.equal(out.livePrices.USDC.source,'STABLE_VALUE_POLICY');
  assert.equal(out.livePrices.USDC.sourceQuality,'POLICY_ASSUMPTION');
  assert.equal(out.livePrices.VSN,undefined);
  assert.equal(out.livePriceMeta.requestedCount,4);
  assert.equal(out.livePriceMeta.resolvedCount,2);
  assert.equal(out.livePriceMeta.policyAssumptionCount,1);
  assert.equal(out.livePriceMeta.fresh,false);
  assert.equal(out.livePriceMeta.privacyMode,'ALL_TICKERS_NO_HOLDING_QUERY');
});

test('R18 does not normalize whitespace symbols into a certified market mark',()=>{
  const data={portfolio:{holdings:[{symbol:' BTC ',quantity:1,venue:'Ledger'}]}};
  const out=buildLivePriceOverlay(data,[{symbol:'BTCUSDT',price:'80000'}],1000);
  assert.equal(out.livePrices.BTC,undefined);
  assert.equal(out.livePriceMeta.fresh,false);
  assert.equal(portfolioPriceCoverage(out,1001).complete,false);
});

test('R18 overlay treats fixed stable values as assumptions, not complete observed prices',()=>{
  const data={portfolio:{holdings:[{symbol:'USDC',venue:'Ledger',quantity:100}]}};
  const assumed=buildLivePriceOverlay(data,[],1000);
  assert.equal(assumed.livePrices.USDC.price,1);
  assert.equal(portfolioPriceCoverage(assumed,1001).complete,false);
  const observed=buildLivePriceOverlay(data,[{symbol:'USDCUSDT',price:'0.987'}],1000);
  assert.equal(observed.livePrices.USDC.price,0.987);
  assert.equal(observed.livePrices.USDC.source,'BINANCE_SPOT');
  assert.equal(portfolioPriceCoverage(observed,1001).complete,true);
});

test('R18 cache reuse preserves the original market-fetch receipt timestamp',()=>{
  const data={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]}},rows=[{symbol:'BTCUSDT',price:'50000'}],cache={at:1000,rows};
  const first=buildLivePriceOverlay(data,cache.rows,cache.at),reused=buildLivePriceOverlay(data,cache.rows,cache.at);
  assert.equal(first.livePrices.BTC.fetchedAt,1000);
  assert.equal(reused.livePrices.BTC.fetchedAt,1000);
  assert.equal(portfolioPriceCoverage(reused,21000).symbols[0].fetchedAt,1000);
  const adapter=fs.readFileSync(new URL('../v8-clean/live-price-adapter-r18.js',import.meta.url),'utf8');
  assert.match(adapter,/return\{rows:cache\.rows,fetchedAt:cache\.at\}/);
  assert.match(adapter,/buildLivePriceOverlay\(data,tickers\.rows,tickers\.fetchedAt\)/);
});

test('R18 adapter reuses ticker data without renewing its receipt timestamp',async()=>{
  const originalWindow=globalThis.window,originalNow=Date.now,initialNow=1_000,requests=[];
  let now=initialNow;
  const rawFetch=async input=>{
    const url=typeof input==='string'?input:input?.url||'';
    requests.push(url);
    if(new URL(url,'https://meridian.invalid').hostname==='api.binance.com')return new Response(JSON.stringify([{symbol:'BTCUSDT',price:'50000'}]),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({data:{portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]}}}),{status:200,headers:{'content-type':'application/json'}});
  };
  globalThis.window={fetch:rawFetch};
  Date.now=()=>now;
  try{
    await import(`../v8-clean/live-price-adapter-r18.js?adapter-cache-${initialNow}`);
    const first=await (await window.fetch('/api/private/dashboard')).json();
    now=initialNow+20_000;
    const reused=await (await window.fetch('/api/private/dashboard')).json();
    assert.equal(first.data.livePrices.BTC.fetchedAt,initialNow);
    assert.equal(reused.data.livePrices.BTC.fetchedAt,initialNow);
    assert.equal(portfolioPriceCoverage(reused.data,now).complete,true);
    assert.equal(requests.filter(url=>new URL(url,'https://meridian.invalid').hostname==='api.binance.com').length,1);
  }finally{
    Date.now=originalNow;
    if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
  }
});

test('R18 clears stale persisted live prices when public feed is unavailable',()=>{
  const out=clearStaleLivePrices({livePrices:{BTC:{price:1}}},456,'fail');
  assert.deepEqual(out.livePrices,{});
  assert.equal(out.livePriceMeta.fresh,false);
  assert.equal(out.livePriceMeta.reason,'fail');
});

test('R18 adapter loads before canonical app and does not disclose holding symbols in market query',()=>{
  const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
  const adapter=fs.readFileSync(new URL('../v8-clean/live-price-adapter-r18.js',import.meta.url),'utf8');
  assert.match(html,/live-price-adapter-r18\.js\?v=8\.0-r18/);
  assert.match(html,/app\.js\?v=8\.0-r45/);
  assert.ok(html.indexOf('live-price-adapter-r18.js')<html.indexOf('app.js'));
  assert.match(adapter,/api\/v3\/ticker\/price/);
  assert.match(adapter,/catch\(_e\)\{augmented=clearStaleLivePrices\(data,Date\.now\(\),'MARKET_FEED_UNAVAILABLE'\)\}/);
  assert.doesNotMatch(adapter,/symbols=/);
  assert.doesNotMatch(adapter,/quantity/);
  assert.doesNotMatch(adapter,/dashboard-update|holdings-sync/);
});
