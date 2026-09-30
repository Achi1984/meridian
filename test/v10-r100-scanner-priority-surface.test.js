import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(startToken,endToken){
  const start=js.indexOf(startToken),end=js.indexOf(endToken,start);
  assert.ok(start>=0&&end>start,'block missing: '+startToken);
  return js.slice(start,end);
}

test('r100 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r100');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/SCANNER-PRIORITY-SURFACE/);
  assert.equal(manifest.start_url,'./v10/?build=r100&fresh=r100');
  assert.ok(js.includes("const BUILD='10.0-r100'"));
});

test('r100 promotes the existing top Opportunity Quality result without adding a new score',()=>{
  const leader=block('function scannerLeaderCard(symbol){','function scannerCard(symbol){');
  assert.match(leader,/opportunityContext\(symbol\)/);
  assert.match(leader,/marketSignal\(i\)/);
  assert.match(leader,/marketPrice\(symbol\)/);
  assert.match(leader,/TOP MARKET CONTEXTS · PRIORITY 1/);
  assert.match(leader,/Quality ist Markt-Kontext, keine Renditeprognose/);
  assert.doesNotMatch(leader,/score\s*[+*\/-]=|Math\.round\(.*score|newScore|weighted/i);
});

test('r100 keeps the existing ranking and shows one leader plus two next contexts before the remainder',()=>{
  const render=block('function renderScanner(force=false){','function skNum(');
  assert.match(render,/return B\.score-A\.score\|\|sb\.rank-sa\.rank\|\|sb\.score-sa\.score/);
  assert.match(render,/top=fresh\\.slice\\(0,4\\),leader=top\\[0\\]\\|\\|null,next=top\\.slice\\(1,3\\),rest=\\[\\.\\.\\.top\\.slice\\(3\\),\\.\\.\\.fresh\\.slice\\(4\\)\\]/);
  assert.match(render,/leaderHtml=leader\?scannerLeaderCard\(leader\)/);
  assert.match(render,/NÄCHSTE KONTEXTE/);
  assert.match(render,/WEITERE '\+rest\.length\+' FRISCHE MÄRKTE/);
});

test('r100 keeps direct Forecast and Asset Detail drilldowns on the priority card',()=>{
  const leader=block('function scannerLeaderCard(symbol){','function scannerCard(symbol){');
  assert.match(leader,/data-forecast-asset/);
  assert.match(leader,/IM FORECAST ÖFFNEN/);
  assert.match(leader,/assetDetailButton\(symbol,'ASSET DETAIL'\)/);
});

test('r100 places research tools after market-priority surfaces',()=>{
  const render=block('function renderScanner(force=false){','function skNum(');
  assert.match(render,/\+leaderHtml\+nextHtml\+\(rest\.length[\s\S]*\+tools;/);
  assert.match(render,/PAPER COCKPIT/);
  assert.match(render,/LAB ÖFFNEN/);
});

test('r100 keeps Scanner dense and touch-safe on mobile',()=>{
  assert.match(css,/#view-research \.data-state-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.scanner-leader-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/#view-research \.scan-drill-actions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#view-research \.scan-drill-actions \.scan-forecast-open,[\s\S]*min-height:44px/);
});

test('r100 remains presentation-only',()=>{
  const start=js.indexOf('function scannerLeaderCard(symbol){');
  const end=js.indexOf('function skNum(',start);
  const ui=js.slice(start,end);
  assert.doesNotMatch(ui,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});
