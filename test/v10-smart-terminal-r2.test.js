import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8').replaceAll('\r\n','\n');
const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('v10 r7 keeps validated v9 engine and isolated adapter',()=>{
  assert.match(html,/10\.0-r7/);
  assert.match(html,/\.\.\/v9\/v9\.js\?v=10\.0-r7/);
  assert.match(html,/\.\/v10\.js\?v=10\.0-r7/);
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

test('v10 renders one actionable asset card for long plus short and hides reference bots',()=>{
  assert.match(js,/function pairCard/);
  assert.match(js,/function pairCard/);
  assert.match(js,/Referenzbots bleiben aus dieser Ansicht entfernt/);
  assert.match(js,/KEINE BESTÄTIGTEN BOT-ROWS/);
  assert.match(js,/private API-Row ist UNVERIFIED und aus Actions ausgeschlossen/);
});

test('v10 command places critical asset and guarded next action ahead of legacy risk views',()=>{
  assert.match(js,/KRITISCHSTES ASSET/);
  assert.match(js,/Safety\/Data Guard überstimmt Trading-Signal/);
  assert.match(js,/KEINE AKTION · DATEN PRÜFEN/);
  assert.match(js,/LIQ-PUFFER PRÜFEN/);
  assert.match(js,/PROFIT LOCK PRÜFEN/);
  assert.match(js,/\.command-bots/);
  assert.match(js,/\.data-truth/);
});

test('v10 scanner requires aligned 1h and 4h confirmation',()=>{
  assert.match(js,/MARKET SIGNALS/);
  assert.match(js,/CONFIRMED braucht 1h \+ 4h Alignment/);
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
  assert.match(js,/PRIVATE MATCH/);
  assert.match(js,/g\.matched\+'\/'\+g\.raw/);
  assert.match(js,/LIVE LAYER BLOCKED/);
  for(const sel of ['risk-cockpit','exposure-card','manual-strip','okx-strip','risk-v2','lock-radar','quick-grid','command-bots','data-truth']){
    assert.match(js,new RegExp(sel.replaceAll('-','\\-')));
  }
  assert.match(js,/PIONEX_BOT_READ_API_KEY \+ PIONEX_BOT_READ_API_SECRET/);
});

test('v10 keeps stale venue snapshots behind a reference-only disclosure',()=>{
  assert.match(js,/function snapshotDetails/);
  assert.match(js,/REFERENCE SNAPSHOTS/);
  assert.match(js,/Nur Ansicht · keine Risk-\/Next-Action-Ableitung/);
  assert.match(css,/\.v10-snapshot-details/);
});


test('v10 r7 bots collapse stale private fields instead of rendering empty action grids',()=>{
  assert.match(js,/stale-pair-card/);
  assert.match(js,/Private Bot-Felder ausgeblendet/);
  assert.match(js,/kein Risk\/PNL\/Next-Action aus altem Snapshot/);
  assert.match(js,/function marketPrice/);
});

test('v10 r7 market is a multi-asset public-data board independent from bot freshness',()=>{
  assert.match(js,/function btcRegimeLabel/);
  assert.doesNotMatch(js,/BTC REGIME<\/span><b>'\+String\(s\.market/);
  assert.match(js,/function marketUniverse/);
  assert.match(js,/REGIME \+ FIB MAP \+ ASSET TAPE/);
  assert.match(js,/Öffentliche Marktdaten · unabhängig vom privaten Bot-Snapshot/);
  assert.match(js,/ASSET TAPE/);
  assert.match(js,/market-list/);
});

test('v10 r7 scanner ranks confirmed setups before raw pressure',()=>{
  assert.match(js,/B\.rank-A\.rank\|\|B\.score-A\.score/);
  assert.match(js,/BEAR CONFIRMED/);
  assert.match(js,/BULL CONFIRMED/);
  assert.match(js,/const confirmed=/);
  assert.match(js,/slice\(0,4\)/);
  assert.match(js,/TOP SETUPS/);
});

test('v10 r7 lab is a compact research hub over the existing paired backtest',()=>{
  assert.match(js,/RESEARCH HUB/);
  assert.match(js,/ACTIVE LAB/);
  assert.match(js,/PAIRED TEST/);
  assert.match(js,/METHODIK & WARUM/);
  assert.match(js,/\$\$\('\.card',view\)\.find/);
  assert.match(css,/\.lab-overview/);
});
