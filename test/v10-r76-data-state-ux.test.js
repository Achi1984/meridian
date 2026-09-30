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

test('r76 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r76');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r76-COMMAND-DEPOT-BOT-CONTROL-FORECAST-SCANNER-ASSET-DETAIL-PAPER-COCKPIT-MOBILE-HARDENED-DATA-STATE');
  assert.match(root,/10\.0-r76-production/);
  assert.match(html,/10\.0-r76/);
  assert.match(v10,/const BUILD='10\.0-r76'/);
  assert.equal(manifest.start_url,'./v10/?build=r76&fresh=r76');
});

test('r76 keeps exactly five primary tabs and all secondary surfaces',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  for(const id of ['view-asset-detail','view-paper','view-more'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.doesNotMatch(html,/data-v="asset-detail"|data-v="paper"|data-v="more"/);
});

test('r76 data states reuse existing Portfolio Bot Market Paper and Research guards',()=>{
  const src=block('function portfolioReadiness(){','function matchStageDiagnosticsCard(){');
  assert.match(src,/p\.complete===true/);
  assert.match(src,/marketHealth\(\),r=marketReadiness\(m\)/);
  assert.match(src,/syncHealth\(\),r=botReadiness\(g\)/);
  assert.match(src,/paperOverviewTrusted\(d\)/);
  assert.match(src,/skLabUi\.running/);
  assert.match(src,/profitAgentUi\.result/);
  assert.match(src,/holdoutUi\.combined/);
});

test('r76 evaluates only the sources assigned to each view scope',()=>{
  const src=block('function dataStateStripHtml(scope){','function matchStageDiagnosticsCard(){');
  for(const mapping of [
    "command:['portfolio','bots','market']",
    "depot:['portfolio','bots']",
    "bots:['bots','market']",
    "market:['market']",
    "research:['market','bots']",
    "asset:['portfolio','bots','market']",
    "paper:['paper']",
    "lab:['research']"
  ]) assert.ok(src.includes(mapping),mapping);
  assert.match(src,/items=\(map\[scope\]\|\|\[\]\)\.map\(key=>sources\[key\]\(\)\)/);
});

test('r76 does not introduce an aggregate readiness score or modify scanner ranking',()=>{
  const state=block('function portfolioReadiness(){','function matchStageDiagnosticsCard(){');
  assert.doesNotMatch(state,/opportunityContext|marketSignal|pairStatus|\.sort\(|score\s*[+=-]/);
  const scanner=block('function renderScanner(force=false){','function skNum(');
  assert.match(scanner,/B\.score-A\.score\|\|sb\.rank-sa\.rank\|\|sb\.score-sa\.score/);
  assert.match(scanner,/dataStateStripHtml\('research'\)/);
  assert.match(state,/Bot-Status beeinflusst Scanner-Ranking nicht/);
});

test('r76 exposes explicit ready partial stale blocked error and last-good states',()=>{
  const src=block('function portfolioReadiness(){','function matchStageDiagnosticsCard(){');
  for(const token of ['READY','PARTIAL','BLOCKED','STALE','ERROR','LAST GOOD','LOADING','NOT LOADED','IDLE','LOADED'])assert.ok(src.includes(token),token);
});

test('r76 renders the unified strip in all primary and secondary UI surfaces',()=>{
  for(const scope of ['command','depot','bots','market','research','asset','paper','lab'])assert.match(v10,new RegExp("dataStateStripHtml\\('"+scope+"'\\)"),scope);
  assert.match(css,/\.data-state-strip/);
  assert.match(css,/\.data-state-item\.tone-safe/);
  assert.match(css,/\.data-state-item\.tone-watch/);
  assert.match(css,/\.data-state-item\.tone-danger/);
});

test('r76 escapes source detail text at the rendering boundary',()=>{
  const src=block('function dataStateStripHtml(scope){','function matchStageDiagnosticsCard(){');
  assert.match(src,/<small>'\+esc\(x\.detail\)\+'<\/small>/);
  assert.match(src,/esc\(notes\[scope\]\|\|'Vorhandene Guards'\)/);
});

test('r76 keeps data-state presentation read-only and mobile-friendly',()=>{
  const state=block('function portfolioReadiness(){','function matchStageDiagnosticsCard(){');
  assert.doesNotMatch(state,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
  assert.match(css,/@media\(max-width:760px\)\{[\s\S]*\.data-state-strip\{grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:430px\)\{[\s\S]*\.data-state-items\{grid-template-columns:1fr\}/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
