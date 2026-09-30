import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function block(start,end){
  const a=js.indexOf(start),b=js.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return js.slice(a,b);
}

test('r80 release identity remains execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r80');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(release.dashboardShell,/TRUST-SEMANTIC-CONSISTENCY/);
  assert.equal(manifest.start_url,'./v10/?build=r80&fresh=r80');
  assert.match(html,/10\.0-r80/);
  assert.match(js,/const BUILD='10\.0-r80'/);
});

test('r80 canonicalizes BTC market intelligence across Forecast and Scanner',()=>{
  assert.match(js,/function marketIntel\(symbol\)/);
  const health=block('function marketHealth(){','function stopLossIssue');
  assert.match(health,/marketIntel\(symbol\)/);
  assert.match(health,/marketIntel\('BTC'\)/);
  const opportunity=block('function opportunityContext(symbol){','function forecastContextHtml');
  assert.match(opportunity,/const i=marketIntel\(symbol\)/);
  const forecast=block('function forecastContextHtml(symbol){','function marketRow');
  assert.match(forecast,/i=marketIntel\(symbol\)/);
  assert.match(forecast,/OPPORTUNITY /);
  const scanner=block('function scannerCard(symbol){','function renderScanner');
  assert.match(scanner,/i=marketIntel\(symbol\)/);
});

test('r80 separates true safety danger from technical structure review',()=>{
  const pair=block('function pairStatus(symbol){','function exposure');
  assert.match(pair,/PROTECTION RISK'.*tone:'danger',rank:160/s);
  assert.match(pair,/LIQ RISK'.*tone:'danger',rank:150/s);
  assert.match(pair,/DATA STALE'.*rank:140/s);
  assert.match(pair,/UNVERIFIED'.*rank:130/s);
  assert.match(pair,/MARKET STALE'.*rank:120/s);
  assert.match(pair,/STRUCTURE REVIEW'.*tone:'watch',rank:70/s);
  const next=block('function nextAction(){','function syncHealth');
  assert.match(next,/STRUCTURE REVIEW/);
  assert.match(next,/MTF-Konflikt prüfen/);
});

test('r80 names forecast scores by semantic domain and gates green regime state',()=>{
  const market=block('function renderMarket(force=false){','function scannerCard');
  assert.match(market,/btcCtx=opportunityContext\('BTC'\)/);
  assert.match(market,/btcCtx\.score>=60\?'safe'/);
  assert.match(market,/REGIME /);
  const forecast=block('function forecastContextHtml(symbol){','function marketRow');
  assert.match(forecast,/OPPORTUNITY /);
});

test('r80 exposes FIB zone position instead of ambiguous equal emphasis',()=>{
  const zone=block('function fibZonePosition(zone,current){','function fibZoneBand');
  assert.match(zone,/return'below'/);
  assert.match(zone,/return'above'/);
  assert.match(zone,/return'inside'/);
  assert.match(zone,/position\.toUpperCase\(\)/);
  assert.match(css,/\.sk-zone\.state-below,\.sk-zone\.state-above/);
  assert.match(css,/\.sk-zone\.state-inside/);
});

test('r80 clarifies holdings, account positions and bot identity counts',()=>{
  assert.match(js,/<span>HOLDING <b>/);
  const bots=block('function renderBots(force=false){','function marketUniverse');
  assert.match(bots,/<span>OPEN FUTURES<\/span>/);
  assert.match(bots,/<span>BOT IDENTITIES<\/span>/);
  assert.match(bots,/wallet rows/);
});

test('r80 reports granular portfolio authority instead of generic source failure',()=>{
  assert.match(js,/function portfolioAuthorityDetail\(/);
  assert.match(js,/Ledger unbestätigt/);
  assert.match(js,/OKX fehlt/);
  assert.match(js,/Pionex fehlt/);
  const overview=block('function commandOverviewHtml(){','function commandActionHubHtml');
  assert.match(overview,/portfolioAuthorityDetail\(p\)/);
  assert.doesNotMatch(overview,/Ledger\/OKX\/Pionex Quellen sind noch nicht vollständig aktuell/);
});

test('r80 consolidates Next Action and fixes mobile collision/safe-space guards',()=>{
  const hub=block('function commandActionHubHtml(){','function bindCommandActionHub');
  assert.match(hub,/NEXT \/ OPEN/);
  assert.match(hub,/class="command-next-decision"/);
  assert.match(hub,/NEXT ACTION/);
  assert.match(css,/\.command-attention>\.section-title\{display:flex;flex-direction:column/);
  assert.match(css,/#view-market \.fib-output\{padding-bottom:calc\(68px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.match(gate,/canonical market-intel resolver missing/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
