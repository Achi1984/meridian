import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildFibLevels,adjacentFibLevels,detectSwing} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function loadNearestHarness(){
  const a=js.indexOf('function fibNearestContext(');
  const b=js.indexOf('function fibAutoNear(',a);
  assert.ok(a>=0&&b>a,'r115 nearest FIB helper must be present');
  const block=js.slice(a,b);
  return new Function('adjacentFibLevels',`
    ${block}
    return fibNearestContext;
  `)(adjacentFibLevels);
}

test('r115 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r115');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/NEAREST-FIB-AUTO-SYNC/);
  assert.equal(manifest.start_url,'./v10/?build=r115&fresh=r115');
  assert.match(html,/meridian-build" content="10\.0-r115"/);
  assert.ok(js.includes("const BUILD='10.0-r115'"));
});

test('r115 reproduces the INJ screenshot and selects the true nearest AUTO FIB',()=>{
  const fibNearestContext=loadNearestHarness();
  const levels=buildFibLevels(7.124,8.675,'DOWN');
  const current=7.509;
  const next=adjacentFibLevels(levels,current);
  const near=fibNearestContext(levels,current);

  assert.equal(next.above?.ratio,0.382);
  assert.ok(Math.abs(Number(next.above?.price)-7.716482)<1e-9);
  assert.equal(next.below?.ratio,0.236);
  assert.ok(Math.abs(Number(next.below?.price)-7.490036)<1e-9);

  assert.deepEqual(near,{f:0.236,price:7.490036});
  assert.ok(Math.abs((near.price-current)/current*100)<1);
});

test('r115 Forecast Focus prefers fresh AUTO FIB context and keeps legacy feed fallback',()=>{
  const a=js.indexOf('function opportunityContext(symbol)');
  const b=js.indexOf('function forecastContextHtml(',a);
  const block=js.slice(a,b);
  assert.match(block,/const near=fibAutoNear\(symbol\)\|\|i\.near/);
  assert.match(block,/nearPrice=Number\(near\?\.price\)/);
  assert.match(block,/nearRatio=Number\(near\?\.f\)/);
  assert.match(block,/Nahe relevantem FIB-Level/);
});

test('r115 AUTO context is fail-closed, fresh-only and MANUAL cannot feed Opportunity Quality',()=>{
  const a=js.indexOf('function fibAutoNear(');
  const b=js.indexOf('function opportunityContext(',a);
  const helper=js.slice(a,b);
  const u=js.indexOf('async function updateFibMap(');
  const v=js.indexOf('function refreshForecastFocus(',u);
  const update=js.slice(u,v);

  assert.match(helper,/ctx\.mode!=='AUTO'/);
  assert.match(helper,/!freshTs\(ctx\.loadedAt\)/);
  assert.match(update,/fibAutoContext\.delete\(String\(fibUi\.symbol/);
  assert.match(update,/fibUi\.mode==='AUTO'\?fibNearestContext\(levels,current\):null/);
  assert.match(update,/if\(autoNear\)fibAutoContext\.set/);
  assert.doesNotMatch(update,/mode:'MANUAL'.*fibAutoContext\.set/s);
});

test('r115 refreshes Forecast Focus only after FIB calculation settles',()=>{
  const a=js.indexOf('async function updateFibMap(');
  const b=js.indexOf('function refreshForecastFocus(',a);
  const block=js.slice(a,b);
  assert.match(block,/finally\{out\.setAttribute\('aria-busy','false'\);refreshForecastFocus\(view\)\}/);
});

test('r115 nearest-FIB bridge remains presentation/context only',()=>{
  const a=js.indexOf('function fibNearestContext(');
  const b=js.indexOf('function marketRow(',a);
  const block=js.slice(a,b);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|method:\s*['"]POST|postJson)/i);
});

function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej});
  return {promise,resolve,reject};
}

function raceRows(low,high,close){
  const now=Date.now()-60_000;
  return [
    {openTime:now-8*60*60*1000,closeTime:now-4*60*60*1000,low,high:(low+high)/2,close:(low+high)/2},
    {openTime:now-4*60*60*1000,closeTime:now,low:(low+high)/2,high,close}
  ];
}

function loadUpdateHarness(fetchBySymbol){
  const helperA=js.indexOf('function fibNearestContext(');
  const helperB=js.indexOf('function fibAutoNear(',helperA);
  const updateA=js.indexOf('async function updateFibMap(');
  const updateB=js.indexOf('function refreshForecastFocus(',updateA);
  assert.ok(helperA>=0&&helperB>helperA&&updateA>=0&&updateB>updateA);
  const nearestBlock=js.slice(helperA,helperB);
  const updateBlock=js.slice(updateA,updateB);

  const source=[
    "const fibUi={symbol:'INJ',window:90,mode:'AUTO',manualHigh:null,manualLow:null,direction:'AUTO',autoHigh:null,autoLow:null,lastDirection:'UP'};",
    "const fibAutoContext=new Map();",
    "let fibRunSeq=0;",
    "const writes=[];",
    "const out={attrs:{},_html:'',setAttribute(k,v){this.attrs[k]=v},set innerHTML(v){this._html=String(v);writes.push(String(v))},get innerHTML(){return this._html}};",
    "const view={asset:'INJ',windowValue:'90',out};",
    "function $(selector){if(selector==='#fib-output')return out;if(selector==='#fib-asset')return {value:view.asset};if(selector==='#fib-window')return {value:view.windowValue};if(selector==='#fib-low'||selector==='#fib-high'||selector==='#fib-direction')return null;return null;}",
    "function H(){return {marketKlines:(_tf,_limit,symbol)=>fetchBySymbol(symbol)}}",
    "function fibParse(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null}",
    "function marketPrice(){return {value:null}}",
    "function detectOpposingChildSwing(){return null}",
    "function skDoubleAdvantage(){return null}",
    "function fibResultHtml(model){return 'RESULT '+model.symbol+' '+Number(model.current).toFixed(6)}",
    "function esc(v){return String(v)}",
    "let refreshes=0;",
    "function refreshForecastFocus(){refreshes++}",
    nearestBlock,
    updateBlock,
    "return {fibUi,fibAutoContext,view,out,writes,updateFibMap,setAsset(symbol){view.asset=symbol},setMode(mode){fibUi.mode=mode},context(symbol){return fibAutoContext.get(String(symbol).trim().toUpperCase())||null},refreshCount(){return refreshes}};"
  ].join('\n');

  return new Function(
    'buildFibLevels','adjacentFibLevels','detectSwing','fetchBySymbol',
    source
  )(buildFibLevels,adjacentFibLevels,detectSwing,fetchBySymbol);
}

test('r115 rejects out-of-order AUTO runs and never cross-writes symbols',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadUpdateHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);

  h.setAsset('INJ');
  const a=h.updateFibMap(h.view);
  h.setAsset('SUI');
  const b=h.updateFibMap(h.view);

  sui.resolve(raceRows(3.0,4.0,3.62));
  await b;
  const bContext=h.context('SUI');
  assert.ok(bContext,'latest SUI run must publish context');
  assert.ok(Number(bContext.near.price)<5,'SUI context must come from SUI-scale data');
  const renderedAfterB=h.out.innerHTML;
  const writesAfterB=h.writes.length;

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;

  assert.deepEqual(h.context('SUI'),bContext,'late INJ must not overwrite SUI context');
  assert.equal(h.context('INJ'),null,'superseded INJ must not publish context');
  assert.equal(h.out.innerHTML,renderedAfterB,'superseded run must not render');
  assert.equal(h.writes.length,writesAfterB,'superseded run must not write output');
  assert.equal(h.refreshCount(),1,'only latest run may refresh Forecast Focus');
});

test('r115 leaves latest AUTO context empty when latest fetch fails',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadUpdateHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);

  h.setAsset('INJ');
  const a=h.updateFibMap(h.view);
  h.setAsset('SUI');
  const b=h.updateFibMap(h.view);

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;
  assert.equal(h.context('INJ'),null,'superseded A must not publish');
  assert.equal(h.context('SUI'),null);

  sui.reject(new Error('SUI fetch failed'));
  await b;
  assert.equal(h.context('SUI'),null,'failed latest run must fail closed');
  assert.match(h.out.innerHTML,/FIB NICHT VERFÜGBAR/);
  assert.equal(h.refreshCount(),1,'only latest failed run refreshes Forecast Focus');
});

test('r115 snapshots async run identity and guards all post-await mutations',()=>{
  const a=js.indexOf('async function updateFibMap(');
  const b=js.indexOf('function refreshForecastFocus(',a);
  const block=js.slice(a,b);
  assert.match(block,/const symbol=String\(fibUi\.symbol\|\|''\)\.trim\(\)\.toUpperCase\(\),key=symbol,mode=fibUi\.mode,windowSize=fibUi\.window,run=\+\+fibRunSeq/);
  assert.match(block,/fetchRows\('4h',Math\.min\(300,Math\.max\(180,windowSize\+5\)\),symbol\)/);
  assert.match(block,/if\(run!==fibRunSeq\)return/);
  assert.match(block,/current=marketPrice\(symbol\)\.value/);
  assert.match(block,/if\(autoNear\)fibAutoContext\.set\(key/);
  assert.match(block,/fibResultHtml\(\{symbol,low,high,direction,current,levels,source,bars,doubleAdvantage\}\)/);
  assert.match(block,/if\(run===fibRunSeq\)\{out\.setAttribute\('aria-busy','false'\);refreshForecastFocus\(view\)\}/);
});
