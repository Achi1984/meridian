import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r109 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r109');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/SCREENSHOT-DATA-TRUTH/);
  assert.equal(manifest.start_url,'./v10/?build=r109&fresh=r109');
  assert.ok(v10.includes("const BUILD='10.0-r109'"));
});

test('r109 24h and 7d deltas fail closed while portfolio authority is incomplete',()=>{
  const start=v10.indexOf('function historyDelta(windowMs){');
  const end=v10.indexOf('const PORTFOLIO_CHART_WINDOWS',start);
  const block=v10.slice(start,end);
  assert.match(block,/p\.complete!==true\|\|p\.total==null/);
  assert.match(block,/reason:'PORTFOLIO_AUTHORITY_INCOMPLETE'/);
  assert.match(block,/Portfolio Authority unvollständig/);
  assert.doesNotMatch(block,/current=Number\(s\?\.portfolio\?\.total\)/);
});

test('r109 command venue cards render missing authority as unknown instead of numeric zero',()=>{
  const start=v10.indexOf('function portfolioChartHeroHtml()');
  const end=v10.indexOf('function bindCommandPortfolioHero',start);
  const block=v10.slice(start,end);
  assert.match(block,/sourceMoney=v=>v!=null&&Number\.isFinite\(Number\(v\)\)/);
  assert.match(block,/AUTHORITY FEHLT/);
});

test('r109 portfolio chart never publishes a current delta without current canonical total',()=>{
  const start=v10.indexOf('function portfolioChartModel(');
  const end=v10.indexOf('function portfolioChartRangeLabel',start);
  const block=v10.slice(start,end);
  assert.match(block,/deltaAvailable=series\.currentIncluded&&/);
  assert.match(v10,/AKTUELLER TOTAL FEHLT · NUR VALIDIERTE HISTORIE/);
});

test('r109 low-priced assets use dynamic market-price precision',()=>{
  assert.match(v10,/function marketMoney\(v\)/);
  assert.match(v10,/n>=\.1\?4:n>=\.01\?5:n>=\.001\?6:8/);
  assert.ok((v10.match(/marketMoney\(mp\.value\)/g)||[]).length>=3);
});

test('r109 depot distinguishes wallet residue from bot exposure',()=>{
  assert.match(v10,/venue:'Pionex Wallet',source:'READ API BALANCE'/);
  assert.match(v10,/<span>WALLET <b>/);
  assert.match(v10,/Bot-Exposure wird im BOTS-Tab bewertet und nicht zum Depotwert addiert/);
});

test('r109 screenshot fixes remain presentation-only',()=>{
  const start=v10.indexOf('function historyDelta(windowMs){');
  const end=v10.indexOf('function renderDepot(force=false)',start);
  const block=v10.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|\/trade\/order/);
});
