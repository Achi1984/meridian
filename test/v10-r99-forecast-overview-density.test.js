import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function renderBlock(){
  const start=js.indexOf('function renderMarket(force=false)');
  const end=js.indexOf('function scannerCard(symbol)',start);
  assert.ok(start>=0&&end>start,'renderMarket block missing');
  return js.slice(start,end);
}

test('r99 Forecast overview-density contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=99,'expected r99 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/FORECAST-OVERVIEW-DENSITY/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r99 makes selected Forecast focus and Fib map the primary visible surfaces',()=>{
  const block=renderBlock();
  assert.match(block,/forecastContextHtml\(fibUi\.symbol\)\+technical\+fibMapHtml\(\)\+tape/);
  assert.match(block,/REGIME \+ OPPORTUNITY CONTEXT \+ FIB MAP/);
});

test('r99 collapses healthy market diagnostics but opens them fail-visible on degraded health',()=>{
  const block=renderBlock();
  assert.match(block,/const techOpen=!mh\.fresh\|\|!mh\.coverageComplete\|\|!mh\.priceFresh/);
  assert.match(block,/class="market-tech-details" '\+\(techOpen\?'open':''\)/);
  assert.match(block,/MARKT TECHNIK/);
  assert.match(block,/market-health/);
  assert.match(block,/market-regime/);
  assert.match(block,/market-kpis/);
  assert.doesNotMatch(block,/<details class="market-tech-details" open/);
});

test('r99 keeps Asset Tape available but opens it automatically only when coverage is degraded',()=>{
  const block=renderBlock();
  assert.match(block,/const tapeOpen=mh\.staleAssets>0\|\|mh\.missingAssets>0/);
  assert.match(block,/class="market-tape-details" '\+\(tapeOpen\?'open':''\)/);
  assert.match(block,/ASSET TAPE/);
  assert.match(block,/syms\.map\(marketRow\)\.join\(''\)/);
});

test('r99 keeps market health compact and disclosure controls touch-safe on mobile',()=>{
  assert.match(css,/#view-market \.data-state-items\{grid-template-columns:1fr/);
  assert.match(css,/\.market-tech-details>summary,\.market-tape-details>summary\{[^}]*min-height:46px/);
  assert.match(css,/#view-market \.forecast-focus-head b\{font-size:18px/);
  assert.match(css,/#view-market \.fib-map-shell\{margin:9px 0 10px/);
});

test('r99 remains presentation-only',()=>{
  const block=renderBlock();
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});


test('r99 visual QA avoids RAF starvation in the synchronous bot accordion flow',()=>{
  const start=js.indexOf("}else if(cfg.flow==='bot-toggle'){");
  const end=js.indexOf("}else if(cfg.flow==='bot-filter-return'){",start);
  const block=js.slice(start,end);
  assert.ok(start>=0&&end>start,'bot-toggle QA block missing');
  assert.match(block,/close\?\.click\(\)/);
  assert.match(block,/open\?\.click\(\)/);
  assert.doesNotMatch(block,/await visualQaSettle\(\)/);
});
