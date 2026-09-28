import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r25 COMMAND total uses the canonical current Spot + Pionex contract',()=>{
  assert.ok(v9.includes("canonicalPortfolioSnapshot,latestPortfolioHistorySnapshot,pionexEquitySnapshot"));
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/snapshot=canonicalPortfolioSnapshot\(canonicalInput,Date\.now\(\)\)/);
  assert.match(block,/total=privateComplete\?snapshot\.totalUsd:null/);
  assert.doesNotMatch(block,/total=pionex\+ledger\+okx/);
  assert.doesNotMatch(block,/state\.manual\.ledger/);
});

test('r25 current Spot valuation uses privacy-safe all-ticker overlay with fail-closed fallback',()=>{
  assert.ok(v9.includes("buildLivePriceOverlay,clearStaleLivePrices"));
  const transport=v9.slice(v9.indexOf('async function portfolioSpotTickers'),v9.indexOf('function okxKnownBotEquity'));
  assert.match(transport,/api\.binance\.com\/api\/v3\/ticker\/price/);
  assert.match(transport,/data-api\.binance\.vision\/api\/v3\/ticker\/price/);
  assert.doesNotMatch(transport,/symbols?=/);
  const sync=v9.slice(v9.indexOf('async function sync(){'),v9.indexOf('window.MERIDIAN_V10_BRIDGE'));
  assert.match(sync,/portfolioSpotTickers\(\)\.catch/);
  assert.match(sync,/buildLivePriceOverlay\(raw,tickers,Date\.now\(\)\)/);
  assert.match(sync,/clearStaleLivePrices\(raw,Date\.now\(\)/);
});

test('r25 history is diagnostic and cannot replace the current canonical total',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/historyPoint=latestPortfolioHistorySnapshot\(history\)/);
  assert.match(block,/historyComparable=total!=null&&historyPoint\.found/);
  assert.match(block,/historyDeltaUsd=historyComparable\?historyPoint\.totalUsd-total:null/);
  assert.doesNotMatch(block,/total=useHistory/);
  assert.match(v10,/HIST Δ/);
});

test('r25+ legacy OKX DCA snapshot remains reference-only outside the canonical total',()=>{
  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.match(command,/OKX DCA (?:REF|OLD REF)/);
  assert.match(command,/(?:OUTSIDE CANONICAL TOTAL|NICHT IM TOTAL)/);
  assert.match(command,/CANONICAL TOTAL · (?:SPOT|EXTERNAL) \+ PIONEX/);
});

test('r25 release identity is canonical and adapters parse',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=25);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v9.includes("live-price-core-r18.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
