import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r72 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r72');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r72-COMMAND-DEPOT-BOT-CONTROL-FORECAST-SCANNER');
  assert.match(root,/10\.0-r72-production/);
  assert.match(html,/10\.0-r72/);
  assert.match(v10,/const BUILD='10\.0-r72'/);
  assert.equal(manifest.start_url,'./v10/?build=r72&fresh=r72');
});

test('r72 Opportunity Quality is market-context only and excludes bot linkage from scoring',()=>{
  const score=block('function opportunityContext(symbol){','function forecastContextHtml(symbol){');
  for(const token of ['Fresh market feed','1h + 4h bestätigt','Momentum 1h/4h','Trendstruktur','FIB-Kontext'])assert.ok(score.includes(token),token);
  assert.doesNotMatch(score,/matchedRows|referenceRows|referenceBots|pionex|botFeed|liveLinked|refLinked/i);
  assert.match(score,/Math\.max\(0,Math\.min\(100,Math\.round\(score\)\)\)/);
  assert.match(score,/CONFLICT/);
});

test('r72 Forecast shows selected-asset opportunity context above the existing Fib map',()=>{
  assert.match(v10,/function forecastContextHtml\(symbol\)/);
  assert.match(v10,/FORECAST FOCUS/);
  assert.match(v10,/Opportunity Quality ist Markt-Kontext, keine Renditeprognose oder Order-Freigabe/);
  const render=block('function renderMarket(force=false){','function scannerCard(symbol){');
  assert.ok(render.indexOf('forecastContextHtml(fibUi.symbol)')<render.indexOf('fibMapHtml()'));
  assert.match(css,/\.forecast-focus/);
  assert.match(css,/\.forecast-focus-grid/);
});

test('r72 scanner ranks fresh markets by Opportunity Quality and labels it as context',()=>{
  const render=block('function renderScanner(force=false){','function skNum(');
  assert.match(render,/opportunityContext\(a\)/);
  assert.match(render,/B\.score-A\.score/);
  assert.match(render,/TOP QUALITY/);
  assert.match(render,/Opportunity Quality ist ein transparenter Kontext-Score, keine erwartete Rendite/);
  assert.match(render,/Bot-Verknüpfung beeinflusst Ranking nicht/);
});

test('r72 scanner card exposes momentum Fib context MTF state and Forecast bridge',()=>{
  const card=block('function scannerCard(symbol){','function renderScanner(force=false){');
  for(const token of ['OPPORTUNITY QUALITY','MOMENTUM','NEAREST FIB','MTF STATUS','IM FORECAST ÖFFNEN'])assert.ok(card.includes(token),token);
  assert.match(card,/data-forecast-asset/);
  assert.match(css,/\.opportunity-score/);
  assert.match(css,/\.scan-forecast-open/);
});

test('r72 Forecast bridge resets asset-specific manual Fib state before opening AUTO context',()=>{
  const render=block('function renderScanner(force=false){','function skNum(');
  assert.match(render,/fibUi\.symbol=String\(btn\.dataset\.forecastAsset/);
  assert.match(render,/fibUi\.mode='AUTO'/);
  assert.match(render,/fibUi\.manualHigh=null/);
  assert.match(render,/fibUi\.manualLow=null/);
  assert.match(render,/showSecondaryView\('market','market'\)/);
});

test('r72 preserves five-tab IA and keeps research Lab secondary',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="more"/);
});

test('r72 UI bridge remains read-only and browser-syntax valid',()=>{
  const start=v10.indexOf('function opportunityContext(symbol){');
  const end=v10.indexOf('function skNum(',start);
  const ui=v10.slice(start,end);
  assert.doesNotMatch(ui,/submitOrder|placeOrder|createOrder|cancelOrder|method:\s*['"]POST|\/trade\/order/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
