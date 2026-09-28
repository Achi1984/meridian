import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=fs.readFileSync(new URL('../portfolio-data-contract.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r26 canonical contract exposes Spot price coverage and source detail',()=>{
  assert.match(contract,/export function portfolioPriceCoverage/);
  assert.match(contract,/requestedCount/);
  assert.match(contract,/resolvedCount/);
  assert.match(contract,/priceCoverage/);
  assert.match(contract,/LIVE_PRICE_COMPLETE/);
  assert.match(contract,/LIVE_PRICE_PARTIAL/);
  assert.match(contract,/SNAPSHOT_FALLBACK/);
});

test('r26+ portfolio model never overstates stale holdings as current',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/priceCoverage=snapshot\.priceCoverage\|\|\{\}/);
  assert.match(block,/spotAuthority=snapshot\.spotAuthority\|\|\{\}/);
  assert.match(block,/privateComplete=spotAuthority\.complete===true&&resolvedPionex\.found===true/);
  assert.match(block,/authorityMode:'STRICT_VENUE_SNAPSHOT'/);
  assert.match(block,/spotRequested:Number\(priceCoverage\.requested\)\|\|0/);
  assert.match(block,/spotResolved:Number\(priceCoverage\.resolved\)\|\|0/);
  assert.doesNotMatch(block,/CANONICAL_CURRENT/);
});

test('r26+ COMMAND visibly identifies portfolio provenance and fail-closed stale holdings',()=>{
  const command=v9.slice(v9.indexOf('function command(){'),v9.indexOf('function botGroup'));
  assert.match(command,/CANONICAL TOTAL · LEDGER AUTO \+ OKX \+ PIONEX/);
  assert.match(command,/nicht autorisierte Alt-Holdings ausgeschlossen/);
  assert.match(command,/OKX DCA OLD REF/);
  const strip=v10.slice(v10.indexOf('function commandDataStrip'),v10.indexOf('function renderSystemHeader'));
  assert.match(strip,/CANONICAL_MIXED/);
  assert.match(strip,/stale Holdings fail-closed/);
  assert.doesNotMatch(strip,/CANONICAL CURRENT/);
});

test('r26 release identity is canonical and execution remains disabled',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=26);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v9.includes("live-price-core-r18.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
