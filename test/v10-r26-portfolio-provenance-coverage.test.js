import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalPortfolioSnapshot, portfolioPriceCoverage } from '../portfolio-data-contract.js';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r26 canonical Spot coverage reports complete, partial, missing, and invalid prices',()=>{
  const now=1000,quote=()=>({price:100,source:'BINANCE_SPOT',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:900,providerObservedAt:null}),data=(symbols,quoted,provenance=quoted)=>({
    portfolio:{holdings:symbols.map(symbol=>({symbol,quantity:1,venue:'Ledger'}))},
    livePrices:Object.fromEntries(quoted.map(symbol=>[symbol,provenance.includes(symbol)?quote():{price:100}])),
    livePriceMeta:{perSymbol:Object.fromEntries(provenance.map(symbol=>[symbol,quote()]))}
  });
  const complete=canonicalPortfolioSnapshot(data(['BTC','ETH'],['BTC','ETH']),now);
  assert.deepEqual({requested:complete.priceCoverage.requested,resolved:complete.priceCoverage.resolved,missing:complete.priceCoverage.missingSymbols,partial:complete.priceCoverage.partial,complete:complete.priceCoverage.complete},{requested:2,resolved:2,missing:[],partial:false,complete:true});
  assert.equal(complete.sourceDetail.spot,'LIVE_PRICE_COMPLETE');

  const partial=portfolioPriceCoverage(data(['BTC','ETH'],['BTC','ETH'],['BTC']),now);
  assert.equal(partial.requested,2);
  assert.equal(partial.resolved,1);
  assert.deepEqual(partial.missingSymbols,[{symbol:'ETH',reason:'PROVENANCE_MISSING_OR_UNSUPPORTED'}]);
  assert.equal(partial.partial,true);
  assert.equal(partial.complete,false);
  assert.equal(canonicalPortfolioSnapshot(data(['BTC','ETH'],['BTC']),now).sourceDetail.spot,'LIVE_PRICE_PARTIAL');

  const missing=canonicalPortfolioSnapshot(data(['BTC','ETH'],[]),now);
  assert.equal(missing.priceCoverage.requested,2);
  assert.equal(missing.priceCoverage.resolved,0);
  assert.deepEqual(missing.priceCoverage.missingSymbols.map(row=>row.symbol),['BTC','ETH']);
  assert.equal(missing.priceCoverage.partial,false);
  assert.equal(missing.priceCoverage.complete,false);
  assert.equal(missing.sourceDetail.spot,'SNAPSHOT_FALLBACK');

  const invalid=portfolioPriceCoverage({...data(['BTC'],['BTC']),livePrices:{BTC:{...quote(),price:0}},livePriceMeta:{perSymbol:{BTC:{...quote(),price:0}}}},now);
  assert.equal(invalid.requested,1);
  assert.equal(invalid.resolved,0);
  assert.deepEqual(invalid.missingSymbols,[{symbol:'BTC',reason:'PRICE_MISSING_OR_INVALID'}]);
  assert.equal(invalid.complete,false);
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
