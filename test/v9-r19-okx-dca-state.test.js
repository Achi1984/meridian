import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('r19 replaces closed OKX positions with the two screenshot-confirmed Futures DCA bots',()=>{
  assert.doesNotMatch(js,/OKX-INJ-LONG-3X/);
  assert.doesNotMatch(js,/OKX-XRP-LONG-3X/);
  assert.match(js,/OKX-INJ-FUTURES-DCA-3X/);
  assert.match(js,/OKX-XRP-FUTURES-DCA-3X/);
  assert.match(js,/symbol:'INJ'.*leverage:3.*investUsd:65\.32.*totalPnlUsd:\.1729.*price:7\.977.*tp:8\.28.*avgCost:7\.908.*safetyMax:7/s);
  assert.match(js,/symbol:'XRP'.*leverage:3.*investUsd:65\.32.*totalPnlUsd:-\.014.*price:1\.5291.*tp:1\.5924.*avgCost:1\.5296.*safetyMax:9/s);
});

test('r19 does not invent liquidation prices for OKX DCA bots',()=>{
  assert.match(js,/OKX-INJ-FUTURES-DCA-3X'.*liq:null/s);
  assert.match(js,/OKX-XRP-FUTURES-DCA-3X'.*liq:null/s);
  assert.match(js,/Gesch\. Liq: —/);
  assert.match(js,/SAFETY/);
});

test('r19 derives known OKX bot equity from the new DCA snapshot and removes stale old fallback',()=>{
  assert.match(js,/function okxKnownBotEquity\(\)/);
  assert.match(js,/num\(x\.investUsd\).*num\(x\.totalPnlUsd\)/);
  assert.match(js,/okx=okxKnownBotEquity\(\)\?\?state\.manual\.okx/);
  assert.match(js,/manual:\{pionex:3126\.12,bitpanda:0,ledger:776\.74,okx:0\}/);
});

test('r19 labels OKX correctly as DCA snapshot and keeps it outside live Pionex action logic',()=>{
  assert.match(js,/OKX FUTURES DCA · SCREENSHOT/);
  assert.match(js,/OKX BOT EQUITY/);
  assert.match(js,/DCA SNAPSHOT/);
  assert.match(js,/state\.okxDcaBots/);
  assert.doesNotMatch(js,/state\.okxPositions/);
  assert.match(js,/state\.bots\.filter\(liveMatched\)/);
});

test('r19 cross-checks OKX DCA symbols with the public market feed',()=>{
  assert.match(js,/state\.okxDcaBots\|\|\[\]/);
  assert.match(js,/OKX \+ BINANCE PRICE/);
});

test('r19 production version is consistent',()=>{
  assert.match(html,/v9 · r19 · COIN-M COMMAND CENTER/);
  assert.match(html,/9\.0-r19/);
});
