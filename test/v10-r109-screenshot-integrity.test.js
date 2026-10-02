import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r109 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r109');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/SCREENSHOT-INTEGRITY-NULL-AUTHORITY-HISTORY-PRICE-PRECISION/);
  assert.equal(manifest.start_url,'./v10/?build=r109&fresh=r109');
  assert.ok(v10.includes("const BUILD='10.0-r109'"));
});
test('r109 never coerces missing portfolio authority to zero or a fake -100 percent delta',()=>{
  assert.match(v10,/function knownNumber\(v\)/);
  assert.match(v10,/p\.complete!==true\|\|current==null\|\|current<0/);
  assert.match(v10,/reason:'PORTFOLIO_AUTHORITY_INCOMPLETE'/);
  assert.match(v10,/points=strictPortfolioHistoryPoints\(\)/);
  assert.match(v10,/const sourceMoney=v=>knownNumber\(v\)/);
  assert.match(v10,/Portfolio Authority unvollständig/);
});
test('r109 makes stale partial history visibly date-aware instead of looking future-dated',()=>{
  assert.match(v10,/function portfolioChartTimeLabel\(ts,range,withDate=false\)/);
  assert.match(v10,/historyStale=!m\.currentIncluded/);
  assert.match(v10,/portfolioChartTimeLabel\(m\.first\?\.timestamp,range,historyStale\)/);
  assert.match(v10,/portfolioChartTimeLabel\(m\.last\?\.timestamp,range,historyStale\)/);
});
test('r109 distinguishes wallet detail from bot exposure and keeps system readiness authority-aware',()=>{
  assert.match(v10,/<span>WALLET <b>/);
  assert.doesNotMatch(v10,/<span>HOLDING <b>/);
  assert.match(v10,/portfolioReady=S\(\)\?\.portfolio\?\.complete===true/);
  assert.match(v10,/&&portfolioReady/);
  assert.match(v10,/PORTFOLIO '\+\(portfolioReady\?'READY':'PARTIAL'\)/);
});
test('r109 preserves sub-dollar structural price precision without touching notional money formatting',()=>{
  assert.match(v10,/function precisePrice\(v\)/);
  assert.match(v10,/a>=\.1\?4:a>=\.01\?5:a>=\.001\?6:8/);
  assert.match(v10,/MARKET PRICE<\/span><b>'\+precisePrice\(mp\.value\)/);
  assert.match(v10,/rangeText=range\.available\?precisePrice\(b\.lower\)\+' — '\+precisePrice\(b\.upper\)/);
  assert.match(v10,/Number\(b\.be\)>0\?precisePrice\(b\.be\)/);
  assert.match(v10,/KNOWN NET NOTIONAL<\/span><b>'\+\(net==null\?'—':h\.money\?\.\(net\)\)/);
});
test('r109 presentation hardening remains read-only',()=>{
  assert.doesNotMatch(v10,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds)/i);
});


test('r109 current canonical total is required before chart delta is shown',()=>{
  const start=v10.indexOf('function portfolioChartModel(');
  const end=v10.indexOf('function portfolioChartRangeLabel',start);
  const block=v10.slice(start,end);
  assert.match(block,/deltaAvailable=series\.currentIncluded&&/);
  assert.match(v10,/AKTUELLER TOTAL FEHLT · NUR VALIDIERTE HISTORIE/);
});

test('r109 Pionex residue provenance is explicitly wallet detail',()=>{
  assert.match(v10,/venue:'Pionex Wallet',source:'READ API BALANCE'/);
  assert.match(v10,/<span>WALLET DETAIL<\/span>/);
});
