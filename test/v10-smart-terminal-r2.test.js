import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8').replaceAll('\r\n','\n');
const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('v10 r13 keeps validated v9 engine and isolated adapter',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(html,/\.\.\/v9\/v9\.js\?v=10\.0-r\d+/);
  assert.match(html,/\.\/v10\.js\?v=10\.0-r\d+/);
  assert.match(js,/No trading logic lives here/);
  assert.match(engine,/MERIDIAN_V10_BRIDGE/);
});

test('engine bridge blocks stale reference inheritance for action-critical fields',()=>{
  for(const field of ['lower','upper','be','liq','tp','buffer','price','pnl','profitPct','invest']){
    assert.match(engine,new RegExp(field+':num\\(x\\.'+field+'\\)'));
  }
  assert.match(engine,/_liveLiq:num\(x\.liq\)>0\|\|num\(x\.buffer\)>0/);
  assert.match(engine,/_liveBe:num\(x\.be\)>0/);
  assert.match(engine,/_liveTp:num\(x\.tp\)>0/);
});

test('v10 safety/data guard pre-empts trading statuses',()=>{
  const p=js.indexOf('function pairStatus');
  const q=js.indexOf('function exposure',p);
  const fn=js.slice(p,q);
  assert.ok(fn.indexOf('DATA_STALE')<fn.indexOf('LIQ_RISK'));
  assert.ok(fn.indexOf('UNVERIFIED')<fn.indexOf('LIQ_RISK'));
  for(const label of ['LIQ RISK','RISK REVIEW','PROFIT LOCK','WATCH PROFIT','HOLD'])assert.match(fn,new RegExp(label));
});

test('v10 renders actionable pair cards only from fresh private rows and keeps reference bots separate',()=>{
  assert.match(js,/function pairCard/);
  assert.match(js,/KEINE FRISCHEN LIVE-AKTIONSKARTEN/);
  assert.match(js,/Asset Watch = Referenz/);
  assert.match(js,/ASSET WATCH SNAPSHOT/);
  assert.match(js,/unterstützte private Bot-Row\(s\) sind UNVERIFIED und aus Actions ausgeschlossen/);
});

test('v10 command places critical asset and guarded next action ahead of legacy risk views',()=>{
  if(js.includes('function commandProModel(now=Date.now()){')){
    // R132 replaces the legacy title with one verified, prioritized decision surface.
    assert.match(js,/data-command-decision-owner="r132"/);
    assert.match(js,/JETZT WICHTIG/);
    assert.match(js,/const urgent=verified&&\['LIQ_RISK','PROTECTION_RISK'\]\.includes\(critical\.status\.code\)/);
    assert.match(js,/decision\.insertAdjacentElement\('afterend',portfolio\)/);
    assert.match(js,/\.sort\(\(a,b\)=>b\.status\.rank-a\.status\.rank\)/);
  }else{
    assert.match(js,/LIVE RISK PRIORITY/);
  }
  if(js.includes('function commandProModel(now=Date.now()){')){
    assert.match(js,/matchedRows\(critical\.symbol\)\.length/);
    assert.match(js,/PORTFOLIO-VOLLSTÄNDIGKEIT PRÜFEN/);
    assert.match(js,/BOT-DATEN PRÜFEN/);
    assert.match(js,/MARKTDATEN PRÜFEN/);
  }else{
    assert.match(js,/Liquidation.*(?:Teilstatus|Substatus)/);
  }
  assert.match(js,/KEINE AKTION · DATEN PRÜFEN/);
  assert.match(js,/LIQ-PUFFER PRÜFEN/);
  assert.match(js,/PROFIT LOCK PRÜFEN/);
  assert.match(js,/\.command-bots/);
  assert.match(js,/\.data-truth/);
});

test('v10 scanner preserves aligned 1h and 4h confirmation inside successor ranking',()=>{
  assert.match(js,/OPPORTUNITY SCANNER/);
  assert.match(js,/BEAR CONFIRMED/);
  assert.match(js,/BULL CONFIRMED/);
  assert.match(js,/bear1&&bear4/);
  assert.match(js,/bull1&&bull4/);
});

test('v10 visually separates live and paper but keeps one engine',()=>{
  assert.match(js,/POSITION LAYER/);
  assert.match(js,/RESEARCH HUB/);
  assert.match(js,/keine automatische Promotion/i);
  assert.match(css,/data-tone="live"/);
  assert.match(css,/data-tone="paper"/);
});

test('v10 paired cards are mobile first',()=>{
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.pair-legs\{grid-template-columns:1fr\}/);
  assert.match(css,/@media\(max-width:390px\)/);
});


test('v10 blocked-live command collapses legacy risk clutter and fixes private match denominator',()=>{
  assert.match(js,/function syncHealth/);
  assert.match(js,/SUPPORTED MATCH/);
  assert.match(js,/g\.matched\+'\/'\+g\.supported/);
  assert.match(js,/LIVE LAYER BLOCKED/);
  for(const sel of ['risk-cockpit','exposure-card','manual-strip','okx-strip','risk-v2','lock-radar','quick-grid','command-bots','data-truth']){
    assert.match(js,new RegExp(sel.replaceAll('-','\\-')));
  }
  assert.match(js,/Pionex Read API fehlt am Backend/);
});

test('v10 keeps stale venue snapshots behind a reference-only disclosure',()=>{
  assert.match(js,/function snapshotDetails/);
  assert.match(js,/ASSET WATCH SNAPSHOT/);
  assert.match(js,/Nur Referenz, solange BOT API nicht frisch ist/);
  assert.match(js,/keine Risk-\/Next-Action-Ableitung/);
  assert.match(css,/\.v10-snapshot-details/);
});


test('v10 r13 bots suppress stale action cards and expose Asset Watch reference instead',()=>{
  assert.match(js,/if\(!fresh&&!compact\)return ''/);
  assert.match(js,/KEINE FRISCHEN LIVE-AKTIONSKARTEN/);
  assert.match(js,/snapshotDetails\((?:snapshotOpen\?\?)?!g\.fresh\)/);
  assert.match(js,/function marketPrice/);
});

test('v10 market remains a multi-asset public-data Forecast board independent from bot freshness',()=>{
  assert.match(js,/function btcRegimeLabel/);
  assert.doesNotMatch(js,/BTC REGIME<\/span><b>'\+String\(s\.market/);
  assert.match(js,/function marketUniverse/);
  assert.match(js,/REGIME \+ OPPORTUNITY CONTEXT \+ FIB MAP/);
  assert.match(js,/Kontext statt Renditeversprechen/);
  assert.match(js,/ASSET TAPE/);
  assert.match(js,/market-list/);
});

test('v10 scanner ranks Opportunity Quality first while preserving confirmation as tie-break evidence',()=>{
  assert.match(js,/B\.score-A\.score\|\|sb\.rank-sa\.rank\|\|sb\.score-sa\.score/);
  assert.match(js,/BEAR CONFIRMED/);
  assert.match(js,/BULL CONFIRMED/);
  assert.match(js,/const confirmed=/);
  assert.match(js,/slice\(0,4\)/);
  assert.match(js,/TOP MARKET CONTEXTS/);
});

test('v10 r13 lab prioritizes documented edges while retaining SK and paired Profit Lock research',()=>{
  assert.match(js,/RESEARCH HUB/);
  assert.match(js,/VALIDATION LADDER/);
  assert.match(js,/DOCUMENTED EDGE LAB/);
  assert.match(js,/SK SYSTEM LAB/);
  assert.match(js,/PROFIT LOCK LAB/);
  assert.match(js,/Paired Exit-Policy Test/);
  assert.match(js,/profit-lock-module/);
  assert.match(css,/\.lab-overview/);
  assert.match(css,/\.research-module/);
});
