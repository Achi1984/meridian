import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildFibLevels,adjacentFibLevels,detectSwing} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

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
function loadHarness(fetchBySymbol){
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
    "const fibOutRun=new WeakMap();",
    "function makeOut(){return {attrs:{},_html:'',writes:[],setAttribute(k,v){this.attrs[k]=v},set innerHTML(v){this._html=String(v);this.writes.push(String(v))},get innerHTML(){return this._html}}}",
    "const marketView={id:'view-market',asset:'INJ',windowValue:'90',out:makeOut()};",
    "const detailView={id:'view-asset-detail',asset:'SUI',windowValue:'90',out:makeOut()};",
    "function $(selector,view){const v=view||marketView;if(selector==='#fib-output')return v.out;if(selector==='#fib-asset')return {value:v.asset};if(selector==='#fib-window')return {value:v.windowValue};if(selector==='#fib-low'||selector==='#fib-high'||selector==='#fib-direction')return null;return null;}",
    "function H(){return {marketKlines:(_tf,_limit,symbol)=>fetchBySymbol(symbol)}}",
    "function fibParse(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null}",
    "function marketPrice(){return {value:null}}",
    "function detectOpposingChildSwing(){return null}",
    "function skDoubleAdvantage(){return null}",
    "function fibResultHtml(model){return 'RESULT '+model.symbol+' '+Number(model.current).toFixed(6)}",
    "function esc(v){return String(v)}",
    "const refreshes=new Map();",
    "function refreshForecastFocus(view){refreshes.set(view,(refreshes.get(view)||0)+1)}",
    nearestBlock,
    updateBlock,
    "return {fibUi,fibAutoContext,marketView,detailView,updateFibMap,setAsset(view,symbol){view.asset=symbol},setWindow(view,value){view.windowValue=String(value)},setMode(mode,low=null,high=null,direction='UP'){fibUi.mode=mode;fibUi.manualLow=low;fibUi.manualHigh=high;fibUi.direction=direction},replaceOut(view){const old=view.out;view.out=makeOut();return {old,out:view.out}},context(symbol){return fibAutoContext.get(String(symbol).trim().toUpperCase())||null},refreshCount(view){return refreshes.get(view)||0}};"
  ].join('\n');
  return new Function('buildFibLevels','adjacentFibLevels','detectSwing','fetchBySymbol',source)(
    buildFibLevels,adjacentFibLevels,detectSwing,fetchBySymbol
  );
}

test('r116+ release remains execution-neutral and preserves cross-view FIB lifecycle hardening',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  const rev=Number(release.terminalBuild.split('r').at(-1));
  assert.ok(rev>=116,'release must not regress below r116');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/FIB-CROSS-VIEW-LIFECYCLE/);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r116 superseded run in another view clears only its own busy lifecycle',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);
  h.setAsset(h.marketView,'INJ');
  const a=h.updateFibMap(h.marketView);
  h.setAsset(h.detailView,'SUI');
  const b=h.updateFibMap(h.detailView);
  assert.equal(h.marketView.out.attrs['aria-busy'],'true');
  assert.equal(h.detailView.out.attrs['aria-busy'],'true');

  sui.resolve(raceRows(3.0,4.0,3.62));
  await b;
  assert.equal(h.detailView.out.attrs['aria-busy'],'false');
  assert.match(h.detailView.out.innerHTML,/RESULT SUI/);
  assert.ok(h.context('SUI'));
  assert.equal(h.refreshCount(h.detailView),1);

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;
  assert.equal(h.marketView.out.attrs['aria-busy'],'false','superseded hidden output must settle');
  assert.equal(h.context('INJ'),null,'superseded global run must not publish shared context');
  assert.equal(h.refreshCount(h.marketView),0,'superseded view must not refresh Forecast Focus');
  assert.equal(h.marketView.out.writes.length,1,'superseded view may retain only its initial loading render');
});

test('r116 older run on the same output cannot clear busy for its newer replacement',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);
  h.setAsset(h.marketView,'INJ');
  const a=h.updateFibMap(h.marketView);
  h.setAsset(h.marketView,'SUI');
  const b=h.updateFibMap(h.marketView);

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;
  assert.equal(h.marketView.out.attrs['aria-busy'],'true','older same-output run must not end newer lifecycle');

  sui.resolve(raceRows(3.0,4.0,3.62));
  await b;
  assert.equal(h.marketView.out.attrs['aria-busy'],'false');
  assert.match(h.marketView.out.innerHTML,/RESULT SUI/);
  assert.equal(h.refreshCount(h.marketView),1);
});


test('r116 cross-output mode and window supersession cannot publish stale AUTO context',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);
  h.setAsset(h.marketView,'INJ');
  h.setWindow(h.marketView,90);
  h.setMode('AUTO');
  const a=h.updateFibMap(h.marketView);

  h.setAsset(h.detailView,'SUI');
  h.setWindow(h.detailView,45);
  h.setMode('MANUAL',3.0,4.0,'UP');
  const b=h.updateFibMap(h.detailView);
  assert.equal(h.marketView.out.attrs['aria-busy'],'true');
  assert.equal(h.detailView.out.attrs['aria-busy'],'true');

  sui.resolve(raceRows(3.0,4.0,3.62));
  await b;
  assert.equal(h.detailView.out.attrs['aria-busy'],'false');
  assert.match(h.detailView.out.innerHTML,/RESULT SUI/);
  assert.equal(h.fibUi.window,45);
  assert.equal(h.context('SUI'),null,'MANUAL run must not publish AUTO context');
  assert.equal(h.refreshCount(h.detailView),1);

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;
  assert.equal(h.marketView.out.attrs['aria-busy'],'false');
  assert.equal(h.context('INJ'),null,'superseded AUTO run must not publish stale context');
  assert.equal(h.refreshCount(h.marketView),0);
});

test('r116 detached output settles only its own lifecycle while replacement output wins',async()=>{
  const inj=deferred(),sui=deferred();
  const h=loadHarness(symbol=>({INJ:inj.promise,SUI:sui.promise})[symbol]);
  h.setMode('AUTO');
  h.setAsset(h.marketView,'INJ');
  const a=h.updateFibMap(h.marketView);
  const swapped=h.replaceOut(h.marketView);

  h.setAsset(h.marketView,'SUI');
  const b=h.updateFibMap(h.marketView);
  assert.equal(swapped.old.attrs['aria-busy'],'true');
  assert.equal(swapped.out.attrs['aria-busy'],'true');

  sui.resolve(raceRows(3.0,4.0,3.62));
  await b;
  assert.equal(swapped.out.attrs['aria-busy'],'false');
  assert.match(swapped.out.innerHTML,/RESULT SUI/);
  assert.ok(h.context('SUI'));
  assert.equal(h.refreshCount(h.marketView),1);

  inj.resolve(raceRows(7.0,8.5,7.98));
  await a;
  assert.equal(swapped.old.attrs['aria-busy'],'false','detached owner must settle its own busy flag');
  assert.equal(swapped.old.writes.length,1,'detached superseded output must keep only loading render');
  assert.equal(swapped.out.attrs['aria-busy'],'false','replacement output must stay settled');
  assert.match(swapped.out.innerHTML,/RESULT SUI/);
  assert.equal(h.context('INJ'),null,'detached superseded run must not publish context');
  assert.equal(h.refreshCount(h.marketView),1,'detached superseded run must not refresh active view');
});

test('r116 keeps global publication authority and adds output-local cleanup authority',()=>{
  const a=js.indexOf('async function updateFibMap(');
  const b=js.indexOf('function refreshForecastFocus(',a);
  const block=js.slice(a,b);
  assert.match(js,/const fibOutRun=new WeakMap\(\)/);
  assert.match(block,/fibOutRun\.set\(out,run\)/);
  assert.match(block,/if\(run!==fibRunSeq\)return/);
  assert.match(block,/if\(fibOutRun\.get\(out\)===run\)\{out\.setAttribute\('aria-busy','false'\);fibOutRun\.delete\(out\)\}/);
  assert.match(block,/if\(run===fibRunSeq\)refreshForecastFocus\(view\)/);
});
