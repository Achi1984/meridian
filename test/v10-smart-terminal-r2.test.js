import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('v10 r2 uses its own runtime and five final surfaces',()=>{
  assert.match(html,/10\.0-r2/);
  assert.match(html,/\.\/v10\.js\?v=10\.0-r2/);
  assert.doesNotMatch(html,/\.\.\/v9\/v9\.js/);
  for(const v of ['command','bots','market','scanner','lab']){
    assert.match(html,new RegExp('id="view-'+v+'"'));
    assert.match(html,new RegExp('data-v="'+v+'"'));
  }
});

test('v10 action roster starts empty and never falls back to phantom reference bots',()=>{
  assert.match(js,/const state=\{bots:\[\],referenceBots:FALLBACK/);
  assert.match(js,/state\.bots=live\.length\?mergeReferenceV10\(live\):\[\]/);
  assert.doesNotMatch(js,/state\.bots=live\.length\?mergeReference\(live\):FALLBACK\.map/);
  assert.match(js,/Reference rows are diagnostics only and never enter v10 action views/);
});

test('v10 matched bots cannot inherit stale action-critical reference fields',()=>{
  for(const field of ['lower','upper','be','liq','tp','price','pnl','profitPct','invest','buffer']){
    assert.match(js,new RegExp(field+':num\\(x\\.'+field+'\\)'));
  }
  assert.match(js,/_liveLiq:num\(x\.liq\)>0\|\|num\(x\.buffer\)>0/);
  assert.match(js,/_source:'PRIVATE_UNMATCHED'/);
});

test('v10 safety and data guard pre-empt trading statuses',()=>{
  const p=js.indexOf('function v10PairStatus');
  const q=js.indexOf('function v10LegRow',p);
  const fn=js.slice(p,q);
  assert.ok(fn.indexOf("DATA_STALE")<fn.indexOf("LIQ_RISK"));
  assert.ok(fn.indexOf("UNVERIFIED")<fn.indexOf("LIQ_RISK"));
  for(const label of ['LIQ RISK','RISK REVIEW','PROFIT LOCK','WATCH PROFIT','HOLD']){
    assert.match(fn,new RegExp(label));
  }
});

test('v10 command follows portfolio critical action risk profit-lock data-truth order',()=>{
  const p=js.indexOf('function commandV10');
  const q=js.indexOf('function botsV10',p);
  const fn=js.slice(p,q);
  const order=['GESAMTPORTFOLIO','KRITISCHSTES ASSET','NEXT ACTION','exposure-card','profitLockRadar()','dataTruthCard()'];
  let last=-1;
  for(const token of order){const i=fn.indexOf(token);assert.ok(i>last,token+' must be ordered');last=i}
});

test('v10 combines long and short per asset and visually separates live from paper',()=>{
  assert.match(js,/function v10PairCard/);
  assert.match(js,/LONG · /);
  assert.match(js,/ SHORT · /);
  assert.match(js,/function v10ModeBand/);
  assert.match(js,/function labV10\(\)\{return v10ModeBand\('PAPER'\)\+research\(\)\}/);
  assert.match(js,/market:\(\)=>v10ModeBand\('LIVE'\)\+market\(\)/);
  assert.match(css,/\.mode-live/);
  assert.match(css,/\.mode-paper/);
});

test('v10 scanner keeps 4h confirmation above 15m and 1h warnings',()=>{
  assert.match(js,/function scannerV10/);
  assert.match(js,/4h = Bestätigung · 15m\/1h = Frühwarnung/);
  assert.match(js,/Scanner allein löst keinen Exit aus/);
});

test('v10 is mobile-first for paired cards',()=>{
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.pair-legs\{grid-template-columns:1fr\}/);
  assert.match(css,/@media\(max-width:390px\)/);
});
