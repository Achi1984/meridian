import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function fallbackBlock(){
  const a=v9.indexOf('const FALLBACK=['),b=v9.indexOf('const HEDGES=',a);
  assert.ok(a>=0&&b>a);
  return v9.slice(a,b);
}

test('r12 imports the authoritative 27 Sep Asset Watch snapshot',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(v9,/ASSET_WATCH_SNAPSHOT_AT='2026-09-27T19:50:00\+02:00'/);
  const block=fallbackBlock();
  assert.equal((block.match(/snapshotAt:ASSET_WATCH_SNAPSHOT_AT/g)||[]).length,34);
  for(const asset of ['BTC','ETH','SOL','XRP','HBAR','PEPE','DOT','ADA','SUI','AVAX','LINK','XLM','TRX','WIF']){
    assert.match(block,new RegExp("symbol:'"+asset+"'"));
  }
});

test('r12 preserves latest Asset Watch long short pair counts',()=>{
  const block=fallbackBlock();
  const count=(symbol,side)=>(block.match(new RegExp("symbol:'"+symbol+"',side:'"+side+"'","g"))||[]).length;
  assert.equal(count('BTC','LONG'),4); assert.equal(count('BTC','SHORT'),1);
  assert.equal(count('ETH','LONG'),3); assert.equal(count('ETH','SHORT'),1);
  assert.equal(count('SOL','LONG'),1); assert.equal(count('SOL','SHORT'),1);
  assert.equal(count('XRP','LONG'),3); assert.equal(count('XRP','SHORT'),0);
  assert.equal(count('HBAR','LONG'),2); assert.equal(count('PEPE','LONG'),2);
  for(const a of ['DOT','ADA','SUI','AVAX','LINK','XLM','WIF']){
    assert.equal(count(a,'LONG'),1,a+' long count');
    assert.equal(count(a,'SHORT'),1,a+' short count');
  }
  assert.equal(count('TRX','LONG'),2); assert.equal(count('TRX','SHORT'),0);
});

test('r12 preserves critical hedge SL versus liquidation facts from Asset Watch',()=>{
  const block=fallbackBlock();
  for(const token of [
    "id:'ETH-SHORT-10X-2709'",'liq:3442.24','sl:3500.05',
    "id:'LINK-SHORT-4X-2709'",'liq:20.057','sl:20.5',
    "id:'XLM-SHORT-5X-2709'",'liq:.33408','sl:.335',
    "id:'WIF-SHORT-4X-2709'",'liq:.348','sl:.35',
    "id:'SUI-SHORT-4X-2709'",'liq:1.5591','sl:1.55',
    "id:'AVAX-SHORT-5X-2709'",'sl:null'
  ]) assert.ok(block.includes(token),'missing '+token);
});

test('r12 removes superseded legacy Pionex hedge/manual snapshot arrays',()=>{
  assert.match(v9,/const HEDGES=\[\];/);
  assert.match(v9,/const MANUAL_POSITIONS=\[\];/);
  assert.match(v9,/const PIONEX_MANUAL=\[\];/);
  assert.match(v9,/referenceBots:FALLBACK/);
  assert.match(v9,/referenceSnapshotAt:ASSET_WATCH_SNAPSHOT_AT/);
});

test('r12 shows Asset Watch only as guarded reference when private bot feed is stale/off',()=>{
  assert.match(js,/ASSET WATCH SNAPSHOT/);
  assert.ok(js.includes("refs.length+' PIONEX BOTS"));
  assert.match(js,/Autoritativer letzter Screenshot-Stand/);
  assert.match(js,/Nur Referenz, solange BOT API nicht frisch ist/);
  assert.match(js,/KEINE FRISCHEN LIVE-AKTIONSKARTEN/);
  assert.match(js,/snapshotDetails\(!g\.fresh\)/);
  assert.match(js,/function snapshotBotLine/);
  assert.match(css,/\.asset-watch-reference/);
  assert.match(css,/\.snapshot-asset/);
  assert.match(css,/\.snapshot-bot-line/);
});

test('r12 reference isolation remains intact under the stricter readiness model',()=>{
  assert.match(v9,/function actionableBot\(b\)\{return liveMatched\(b\)&&livePnlAvailable\(b\)&&botFeedFresh\(\)\}/);
  assert.match(js,/Asset Watch = Referenz/);
  assert.match(js,/SAFETY READY/);
  assert.match(js,/DECISION READY/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('r12 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
