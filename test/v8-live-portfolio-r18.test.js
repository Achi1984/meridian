import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pricingAsset,buildLivePriceOverlay,clearStaleLivePrices} from '../v8-clean/live-price-core-r18.js';

test('R18 maps wrapped assets to canonical live price assets',()=>{
  assert.equal(pricingAsset('BETH'),'ETH');
  assert.equal(pricingAsset('OKSOL'),'SOL');
  assert.equal(pricingAsset('XRP'),'XRP');
});

test('R18 builds fresh prices without sending or fabricating holdings values',()=>{
  const data={portfolio:{holdings:[
    {symbol:'BTC',quantity:1,venue:'OKX'},
    {symbol:'BETH',quantity:2,venue:'OKX'},
    {symbol:'USDC',quantity:100,venue:'Ledger'},
    {symbol:'VSN',quantity:10,venue:'Bitpanda'},
    {symbol:'BTC',quantity:1,venue:'Pionex'}
  ]},livePrices:{BTC:{price:1}}};
  const out=buildLivePriceOverlay(data,[{symbol:'BTCUSDT',price:'80000'},{symbol:'ETHUSDT',price:'4000'}],123);
  assert.equal(out.livePrices.BTC.price,80000);
  assert.equal(out.livePrices.BETH.price,4000);
  assert.equal(out.livePrices.USDC.price,1);
  assert.equal(out.livePrices.VSN,undefined);
  assert.equal(out.livePriceMeta.requestedCount,4);
  assert.equal(out.livePriceMeta.resolvedCount,3);
  assert.equal(out.livePriceMeta.privacyMode,'ALL_TICKERS_NO_HOLDING_QUERY');
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
  assert.match(html,/app\.js\?v=8\.0-r33/);
  assert.ok(html.indexOf('live-price-adapter-r18.js')<html.indexOf('app.js'));
  assert.match(adapter,/api\/v3\/ticker\/price/);
  assert.doesNotMatch(adapter,/symbols=/);
  assert.doesNotMatch(adapter,/quantity/);
  assert.doesNotMatch(adapter,/dashboard-update|holdings-sync/);
});
