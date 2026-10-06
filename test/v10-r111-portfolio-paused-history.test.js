import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r111 release identity is coherent and execution neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=111);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PORTFOLIO-PARTIAL-KNOWN-VALUE-HISTORY-PAUSED-SEMANTICS/);
  assert.equal(manifest.start_url,'./v10/?build='+release.terminalBuild.split('-').at(-1)+'&fresh='+release.terminalBuild.split('-').at(-1));
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r111 distinguishes paused history from a genuinely building window',()=>{
  const start=js.indexOf('function portfolioHistoryIntegrityHtml()'),end=js.indexOf('// Legacy Command semantic contract',start),block=js.slice(start,end);
  assert.match(block,/historyPaused=!portfolioComplete/);
  assert.match(block,/label='PAUSED'/);
  assert.match(block,/AUTHORITY FEHLT/);
  assert.match(block,/label='BUILDING'/);
  assert.match(block,/LETZTER '\+esc\(latestAge\)/);
});

test('r111 partial portfolio disclosure never masquerades as total',()=>{
  const start=js.indexOf('function portfolioChartHeroHtml()'),end=js.indexOf('function bindCommandPortfolioHero',start),block=js.slice(start,end);
  assert.match(block,/knownSources=\[\['LEDGER',p\.ledgerAutoUsd\],\['OKX',p\.okxVenueUsd\],\['PIONEX',p\.pionex\]\]/);
  assert.match(block,/BEKANNTER TEILWERT/);
  assert.match(block,/NICHT GESAMTPORTFOLIO/);
  assert.match(block,/totalText=ready\?.*:'—'/);
  assert.match(css,/\.portfolio-known-partial\{/);
});

test('r111 explains why stale strict history is not advancing',()=>{
  const start=js.indexOf('function portfolioChartHeroHtml()'),end=js.indexOf('function bindCommandPortfolioHero',start),block=js.slice(start,end);
  assert.match(block,/VERLAUF PAUSIERT · PORTFOLIO AUTHORITY FEHLT/);
  assert.match(block,/Neue Punkte werden erst nach Ledger- und OKX-Authority geschrieben/);
  assert.match(block,/LETZTER '\+strictLatestAge/);
});

test('r117 collapses degraded history and keeps NEXT ACTION room in the top fold',()=>{
  const start=js.indexOf('function portfolioChartHeroHtml()'),end=js.indexOf('function bindCommandPortfolioHero',start),block=js.slice(start,end);
  assert.match(block,/portfolio-degraded-history/);
  assert.match(block,/historySurface=ready\?portfolioHistoryIntegrityHtml\(\)\+chart:degradedHistory/);
  assert.match(block,/portfolio-degraded/);
  assert.match(css,/\.portfolio-degraded-history\{/);
});

test('r117 Depot mirrors the known partial value without presenting it as total',()=>{
  const start=js.indexOf('function renderDepot('),end=js.indexOf('function bindAssetDetailLinks',start),block=js.slice(start,end);
  assert.match(block,/knownDepotSources=\[p\.ledgerAutoUsd,p\.okxVenueUsd,p\.pionex\]/);
  assert.match(block,/TEILWERT, NICHT GESAMT/);
  assert.match(block,/knownDepotPartialText/);
  assert.match(block,/p\.complete\?h\.money\?\.\(p\.total\):'—'/);
});

test('r111 remains presentation-only',()=>{
  const start=js.indexOf('function portfolioHistoryIntegrityHtml()'),end=js.indexOf('function bindCommandPortfolioHero',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson)/i);
});
