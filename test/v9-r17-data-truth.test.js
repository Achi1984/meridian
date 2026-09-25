import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('v9 r17 numeric formatters preserve missing and negative values',()=>{
  assert.match(js,/num=v=>v===null\|\|v===undefined\|\|v===''\?null/);
  assert.match(js,/Math\.abs\(x\)<\.001/);
  assert.doesNotMatch(js,/if\(x<\.001\)/);
});

test('v9 r17 reference rows cannot drive Profit Lock actions',()=>{
  assert.match(js,/function liveMatched\(b\)/);
  assert.match(js,/function livePnlAvailable\(b\)/);
  assert.match(js,/if\(!liveMatched\(b\)\)return\{code:'SYNC',label:'REFERENCE · VERIFY'/);
  assert.match(js,/if\(!livePnlAvailable\(b\)\)return\{code:'SYNC',label:'SYNC · PNL'/);
  assert.match(js,/function critical\(\)\{return botFeedFresh\(\)\?/);
  assert.match(js,/function status\(b\)\{if\(!liveMatched\(b\)\)return\['REF','muted'\]/);
  assert.match(js,/price:num\(x\.price\),pnl:num\(x\.pnl\),profitPct:num\(x\.profitPct\),invest:num\(x\.invest\)/);
  assert.match(js,/state\.bots\.filter\(liveMatched\)\.map/);
});

test('v9 r17 exposure is based on confirmed live capital only',()=>{
  assert.match(js,/const botNotional=b=>liveInvestAvailable\(b\)\?/);
  assert.match(js,/confirmed=botFeedFresh\(\)\?state\.bots\.filter\(liveMatched\):\[\]/);
  assert.match(js,/unknownBots/);
  assert.match(js,/KNOWN LIVE BOT LONG/);
  assert.match(js,/pair\.hedgePct!=null&&pair\.hedgePct<15/);
  assert.match(js,/Referenzwerte dürfen keine Profit-Lock\/Next-Action Entscheidung auslösen/);
});

test('v9 r17 cross-checks market prices and labels mixed provenance',()=>{
  assert.match(js,/market\/tickers\?instType=SWAP/);
  assert.match(js,/api\/v3\/ticker\/price/);
  assert.match(js,/spread<=1\.5/);
  assert.match(js,/OKX \+ BINANCE/);
  assert.match(html,/id="data-status">● REFERENCE/);
  assert.match(html,/v9 · r\d+ · COIN-M COMMAND CENTER/);
  assert.match(js,/OKX POSITIONS · SNAPSHOT/);
  assert.match(js,/PIONEX MANUAL · SNAPSHOT/);
});

test('v9 r17 research uses Binance spot symbol names and distinguishes engine version',()=>{
  assert.match(js,/const marketSymbol=symbol\+'USDT'/);
  assert.doesNotMatch(js,/1000PEPE/);
  assert.match(js,/PROFIT LOCK LAB · ENGINE r15/);
});
