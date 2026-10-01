import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=fs.readFileSync(new URL('../portfolio-data-contract.js',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../portfolio-history-store.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r105 contract remains coherent and execution neutral on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=105);
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardConsistency,'7.64-CANONICAL-PORTFOLIO-HISTORY-V3');
  assert.match(String(release.dashboardShell||''),/PIONEX-HISTORY-SOURCE-ALIGNMENT/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r105 centralizes fresh Pionex authority and prefers the read-only wallet source',()=>{
  assert.match(contract,/export function authoritativePionexEquitySnapshot\(/);
  assert.match(contract,/PIONEX_EQUITY_AUTHORITY_MAX_AGE_MS=15\*60\*1000/);
  assert.match(contract,/walletStatus=String\(data\?\.pionexAccount\?\.walletStatus/);
  assert.match(contract,/syncStatus=String\(data\?\.pionexAccountSync\?\.status/);
  assert.match(contract,/source:'PIONEX_WALLET_READ_API'/);
  assert.match(v9,/authoritativePionexEquitySnapshot\(d,now\)/);
});

test('r105 history writer uses fresh authority value instead of stale portfolio seed',()=>{
  assert.match(store,/authoritativePionexEquitySnapshot\(strictData,timestamp\)/);
  assert.match(store,/pionexEquityUsd:tradingAuthority\.found\?tradingAuthority\.value:null/);
  assert.match(store,/tradingAuthorityComplete=tradingAuthority\?\.found===true&&tradingAuthority\?\.fresh===true/);
  assert.match(store,/tradingAuthorityVersion:tradingAuthorityComplete\?'PIONEX_FRESH_V1':'MISSING'/);
  assert.match(store,/tradingUpdatedAt:tradingAuthority\?\.updatedAt\|\|null/);
});

test('r105 rejects all legacy rows without timestamped fresh Pionex provenance',()=>{
  assert.match(store,/authorityVersion==='PIONEX_FRESH_V1'/);
  assert.match(store,/tradingFresh&&authorityVersion==='PIONEX_FRESH_V1'/);
  assert.match(store,/provenanceFresh/);
  assert.match(v10,/function portfolioHistoryTradingAuthorityFresh\(x\)/);
  assert.match(v10,/tradingAuthorityVersion\|\|''\)==='PIONEX_FRESH_V1'/);
  assert.match(v10,/SPOT \+ FRESH PIONEX/);
});

test('r105 does not fabricate history or alter trading execution',()=>{
  assert.doesNotMatch(contract+store+v10,/syntheticPortfolioHistory|interpolatePortfolioHistory|backfillFakeHistory/i);
  assert.doesNotMatch(v10,/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/);
});
