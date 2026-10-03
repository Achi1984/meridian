import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r102 release identity is execution-neutral and cache coherent',()=>{
  assert.ok(Number(String(release.terminalBuild).match(/r(\d+)$/)?.[1]||0)>=102);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/LIVE-HISTORY-INTEGRITY/);
  const rev=String(release.terminalBuild).match(/r\d+$/)?.[0];
  assert.equal(manifest.start_url,`./v10/?build=${rev}&fresh=${rev}`);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.ok(html.includes('v10 '+rev+' · SMART TRADING TERMINAL'));
});

test('r102 exposes deployed build and strict-history integrity beside the portfolio chart',()=>{
  assert.match(js,/function portfolioHistoryIntegrityHtml\(\)/);
  assert.match(js,/class="portfolio-integrity-strip"/);
  assert.match(js,/data-build="/);
  assert.match(js,/data-history-points="/);
  assert.match(js,/STRICT HISTORY/);
  assert.match(js,/STRICT HISTORY/);
  for(const key of ['1h','1d','1w'])assert.ok(js.includes("rangeCard('"+key+"')"));
});

test('r102 derives range readiness from existing canonical chart coverage only',()=>{
  assert.match(js,/ready=m\.deltaAvailable/);
  assert.match(js,/if\(ready\)\{tone='safe';label='READY'/);
  assert.match(js,/historyPaused=!portfolioComplete/);
  assert.match(js,/label='PAUSED'/);
  assert.match(js,/label='BUILDING'/);
  assert.match(js,/label='WAIT'/);
  assert.match(js,/strictPortfolioHistoryPoints\(\)/);
  assert.match(js,/String\(x\?\.sourceStatus\?\.spot\|\|''\)==='STRICT_AUTHORITY'/);
  assert.doesNotMatch(js,/syntheticPortfolioHistory|interpolatePortfolioHistory|backfillFakeHistory/);
});

test('r102 keeps the integrity surface compact on mobile',()=>{
  assert.match(css,/\/\* v10 r102 · live \+ history integrity \*\//);
  assert.match(css,/\.portfolio-integrity-strip\{[\s\S]*grid-template-columns:1fr 1\.35fr repeat\(3,minmax\(0,\.8fr\)\)/);
  assert.ok(css.includes('@media(max-width:600px){'));
  assert.ok(css.includes('.portfolio-integrity-strip{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}'));
  assert.ok(css.includes('.portfolio-integrity-strip>.portfolio-integrity-range:last-child{grid-column:1/-1}'));
});

test('r102 remains presentation-only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
});
