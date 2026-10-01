import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r16 safety risks outrank stale-market and unverified states globally',()=>{
  assert.match(v10,/hardProtection.*rank:130/s);
  assert.match(v10,/code:'LIQ_RISK'.*rank:120/s);
  assert.match(v10,/nearProtection.*rank:115/s);
  assert.match(v10,/code:'RISK_REVIEW'.*rank:100/s);
  assert.match(v10,/code:'UNVERIFIED'.*rank:90/s);
  assert.match(v10,/code:'MARKET_STALE'.*rank:80/s);
});

test('r16 derives OKX close times and confirms higher timeframes on closed candles',()=>{
  assert.match(v9,/MARKET_INTERVAL_MS/);
  assert.ok(v9.includes('closeTime:+x[0]+Math.max(1,span)-1'));
  assert.match(v9,/function closedMarketRows\(rows\)/);
  assert.match(v9,/h1c=closedMarketRows\(h1\),h4c=closedMarketRows\(h4\),d1c=closedMarketRows\(d1\)/);
  assert.match(v9,/confirmationBars:'CLOSED_1H_4H_1D'/);
  assert.match(v9,/confirmationBars:'CLOSED_1H_4H'/);
});

test('r16 historical research excludes an unfinished current candle',()=>{
  const block=v9.slice(v9.indexOf('async function marketKlinesHistory'),v9.indexOf('async function syncCrossPrices'));
  assert.match(block,/filter\(x=>num\(x\.closeTime\)!=null&&num\(x\.closeTime\)<Date\.now\(\)-1000\)/);
});

test('r16 market coverage denominator comes from expected tracked universe, not only successful feeds',()=>{
  assert.match(v10,/\.\.\.\(s\?\.referenceBots\|\|\[\]\)/);
  assert.match(v10,/\.\.\.\(s\?\.okxDcaBots\|\|\[\]\)/);
  assert.match(v10,/universe=marketUniverse\(\)/);
  assert.match(v10,/missingSymbols=rows\.filter\(x=>!x\.intel\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/missingAssets=missingSymbols\.length/);
  assert.match(v10,/coverageComplete:totalAssets>0&&freshAssets===totalAssets/);
});

test('r16 MARKET and SCANNER keep missing assets visible and blocked',()=>{
  assert.match(v10,/NO TECH DATA/);
  assert.match(v10,/keine 15m\/1h\/4h Historie geladen/);
  assert.match(v10,/NO DATA/);
  assert.match(v10,/MTF STATUS <b>BLOCKED/);
  assert.match(v10,/const s=S\(\),h=H\(\),all=marketUniverse\(\)/);
  assert.doesNotMatch(v10,/marketUniverse\(\)\.filter\(x=>s\?\.assetIntel/);
  assert.match(v10,/STALE \/ NO DATA/);
});

test('r16 UI states closed-candle confirmation explicitly',()=>{
  assert.match(v10,/1h\/4h\/1D nur auf geschlossenen Kerzen/);
  assert.match(v10,/bear1&&bear4/);
  assert.match(v10,/bull1&&bull4/);
});

test('r16+ release identity remains canonical',()=>{
  const build=String(release.terminalBuild||'');
  assert.match(build,/^10\.0-r\d+$/);
  assert.ok(html.includes(build));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
});

test('r16 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
