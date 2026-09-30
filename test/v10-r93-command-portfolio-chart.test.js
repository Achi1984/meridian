import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r93 portfolio-chart contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=93,'expected r93 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-PORTFOLIO-CHART-1H-1D-1W/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r93 exposes one dominant canonical portfolio hero with 1h 1d 1w controls',()=>{
  assert.match(js,/function portfolioChartHeroHtml\(\)/);
  assert.match(js,/GESAMTPORTFOLIO/);
  assert.match(js,/PORTFOLIO_CHART_WINDOWS=Object\.freeze\(\{ '1h':60\*60\*1000,'1d':24\*60\*60\*1000,'1w':7\*24\*60\*60\*1000 \}\)/);
  for(const key of ["'1h'","'1d'","'1w'"])assert.ok(js.includes(key),key);
  assert.match(js,/data-portfolio-range=/);
  assert.match(js,/aria-pressed=/);
  assert.match(css,/\.command-portfolio-hero/);
  assert.match(css,/\.portfolio-range-switch button/);
});

test('r93 chart consumes only complete strict-authority portfolio history',()=>{
  const start=js.indexOf('function strictPortfolioHistoryPoints()');
  const end=js.indexOf('function downsamplePortfolioSeries',start);
  const block=js.slice(start,end);
  assert.match(block,/sourceStatus\?\.spot\|\|''\)==='STRICT_AUTHORITY'/);
  assert.match(block,/Math\.abs\(total-\(spot\+trading\)\)<=1/);
  assert.match(block,/total>=0/);
});

test('r93 appends the current total only when canonical portfolio authority is complete',()=>{
  const start=js.indexOf('function portfolioChartSeries(');
  const end=js.indexOf('function portfolioChartGeometry',start);
  const block=js.slice(start,end);
  assert.match(block,/currentIncluded=p\.complete===true&&Number\.isFinite\(current\)&&current>=0/);
  assert.match(block,/if\(currentIncluded\)/);
});

test('r93 inserts the portfolio hero before data state and keeps missing authority fail-closed',()=>{
  const start=js.indexOf('function renderCommand(force=false)');
  const end=js.indexOf('function assetWatchShareCard()',start);
  const block=js.slice(start,end);
  assert.match(block,/portfolioBox\.innerHTML=portfolioChartHeroHtml\(\)/);
  assert.match(block,/insertAdjacentElement\('afterend',portfolioNode\)/);
  assert.match(block,/portfolioNode\.insertAdjacentElement\('afterend',stateNode\)/);
  assert.match(js,/AUTHORITY UNVOLLSTÄNDIG · GESAMTWERT BEWUSST AUSGEBLENDET/);
  assert.match(js,/ready\?\(h\.money\?\.\(total\)\|\|String\(total\)\):'—'/);
});

test('r93 chart remains presentation-only and touch friendly',()=>{
  assert.match(css,/\.portfolio-range-switch button\{[^}]*min-height:44px/);
  assert.match(css,/\.portfolio-chart-line/);
  const start=js.indexOf('const PORTFOLIO_CHART_WINDOWS');
  const end=js.indexOf('function commandOverviewHtml(){',start);
  const block=js.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});
