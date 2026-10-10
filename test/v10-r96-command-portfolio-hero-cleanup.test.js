import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r96 Command portfolio-hero contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=96,'expected r96 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-PORTFOLIO-HERO-CLEANUP/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r96 dominant hero exposes Ledger OKX Pionex composition and history status',()=>{
  const start=js.indexOf('function portfolioChartHeroHtml()'),end=js.indexOf('function bindCommandPortfolioHero',start),block=js.slice(start,end);
  assert.match(block,/portfolio-venue-strip/);
  assert.match(block,/sourceCard\('LEDGER'/);
  assert.match(block,/sourceCard\('OKX'/);
  assert.match(block,/sourceCard\('PIONEX'/);
  assert.match(block,/portfolio-history-status/);
  assert.match(block,/storedPoints\+' PUNKTE/);
});

test('r96 OKX UI uses server authority provenance rather than stale local-ref wording',()=>{
  assert.match(v9,/okxVenueSource:okxVenue\?\.source\|\|null/);
  assert.match(v9,/SERVER AUTH/);
  assert.doesNotMatch(v9,/'LOCAL REF · '\+okxAge/);
  assert.match(js,/okxVenueSource\|\|'SERVER_PORTFOLIO_AUTHORITY'/);
});

test('r96 Command collapses deep diagnostics under one system status disclosure',()=>{
  const start=js.indexOf('function commandSystemDiagnostics()'),end=js.indexOf('function renderSystemHeader()',start),block=js.slice(start,end);
  assert.match(block,/details\.className='command-system-diagnostics command-diagnostics'/);
  assert.match(block,/DIAGNOSTICS/);
  assert.match(block,/dataGuardCard\(true\)/);
  assert.match(block,/accountPositionLayer\(true\)/);
  assert.match(block,/walletDiscoveryLayerCompact\(\)/);
  assert.doesNotMatch(block,/<details[^>]+open/);
});

test('r96 renderCommand inserts one collapsed diagnostics surface after live risk',()=>{
  const start=js.indexOf('function renderCommand(force=false)'),end=js.indexOf('function assetWatchShareCard()',start),block=js.slice(start,end);
  if(js.includes('function commandProModel(now=Date.now()){')){
    // R132 consolidates diagnostics into one closed source disclosure after risk.
    assert.match(block,/source=asNode\(commandDataDisclosure\(\)\)/);
    assert.match(block,/source\.open=opened\.source/);
    assert.match(block,/bindCommandProDisclosures\(view\)/);
    assert.match(block,/risks\.insertAdjacentElement\('afterend',links\)/);
    assert.match(block,/portfolioDetails/);
    assert.match(block,/\.command-system-diagnostics/);
  }else{
    assert.match(block,/const systemDiagnostics=commandSystemDiagnostics\(\)/);
    assert.match(block,/insertAdjacentElement\('afterend',systemDiagnostics\)/);
    assert.match(block,/portfolioDetails/);
    assert.match(block,/\.command-system-diagnostics/);
  }
});

test('r96 Command data state is a compact three-column health row on mobile',()=>{
  assert.match(css,/#view-command \.data-state-items\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/#view-command \.data-state-item>small\{display:none\}/);
  assert.match(css,/\.command-system-diagnostics>summary\{[^}]*min-height:48px/);
});

test('r96 legacy portfolio authority panel keeps actions but hides duplicate venue values',()=>{
  assert.match(css,/#view-command \.command-source-authority>\.source-grid/);
  assert.match(css,/#view-command \.command-source-authority \.portfolio-reconcile:before/);
  assert.match(v9,/LEDGER ASSETS BESTÄTIGEN/);
  assert.match(v9,/OKX WERT AKTUALISIEREN/);
});

test('r96 remains presentation-only in the new adapter surfaces',()=>{
  const start=js.indexOf('function portfolioChartHeroHtml()'),end=js.indexOf('function assetWatchShareCard()',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});
