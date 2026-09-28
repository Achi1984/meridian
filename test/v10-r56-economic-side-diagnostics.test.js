import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function runtime(refs=[]){
  const a=v9.indexOf('function pick('),b=v9.indexOf('function ema(',a);
  assert.ok(a>=0&&b>a);
  const source=v9.slice(a,b),state={unmatchedLive:[],matchAmbiguous:0,matchDiagnostics:null};
  const num=v=>{if(v==null||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  return{state,...new Function('FALLBACK','state','num',source+';return {normalizeLive,mergeReference,economicSide};')(refs,state,num)};
}

test('r56 economicSide derives directional liquidation geometry only when clear',()=>{
  const rt=runtime([]);
  assert.equal(rt.economicSide({be:100,liq:70}),'LONG');
  assert.equal(rt.economicSide({be:100,liq:130}),'SHORT');
  assert.equal(rt.economicSide({be:100,liq:100.1}),null);
  assert.equal(rt.economicSide({be:null,liq:70}),null);
});

test('r56 detects declared/economic inversion without changing match acceptance',()=>{
  const refs=[
    {id:'L',symbol:'BTC',side:'LONG',leverage:5,lower:50,upper:150,be:100,liq:70},
    {id:'S',symbol:'ETH',side:'SHORT',leverage:4,lower:50,upper:150,be:100,liq:130}
  ];
  const rt=runtime(refs);
  const live=[
    rt.normalizeLive({id:'x',symbol:'BTC',side:'SHORT',leverage:5,lower:50,upper:150,breakEvenPrice:100,liquidationPrice:70}),
    rt.normalizeLive({id:'y',symbol:'ETH',side:'LONG',leverage:4,lower:50,upper:150,breakEvenPrice:100,liquidationPrice:130})
  ];
  const out=rt.mergeReference(live),d=rt.state.matchDiagnostics;
  assert.equal(out.filter(x=>x._liveMatched).length,0);
  assert.deepEqual(d.economicSideCounts,{LONG:1,SHORT:1});
  assert.equal(d.economicKnown,2);
  assert.equal(d.economicAgree,0);
  assert.equal(d.economicOpposite,2);
  assert.equal(d.assetLeveragePass,2);
  assert.equal(d.assetStructurePass,2);
  assert.equal(d.economicReferenceSidePass,2);
  assert.equal(d.economicReferenceLeveragePass,2);
  assert.equal(d.economicReferenceStructurePass,2);
});

test('r56 UI marks economic-side checks as diagnostic only',()=>{
  const block=v10.slice(v10.indexOf('function matchStageDiagnosticsCard'),v10.indexOf('function unmatchedDiagnostics'));
  for(const token of ['SIDE SANITY','TREND↔ECON AGREE','OPPOSITE','IGNORE DECLARED SIDE','ECONOMIC SIDE → REFERENCE','Diagnose only'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/botOrderId|investmentAmount|pnlUsd/);
});

test('r56 preserves matcher and trading safety rules',()=>{
  assert.match(v9,/const MATCH_MAX_SCORE=4,MATCH_MIN_GAP=\.05/);
  const merge=v9.slice(v9.indexOf('function mergeReference'),v9.indexOf('function ema('));
  assert.match(merge,/botMatchEvidence\(refs\[ri\],live\[li\]\)/);
  assert.doesNotMatch(merge,/economicSide\(x\).*_liveMatched|side:economicSide/);
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)/);
  assert.equal(release.terminalExecutionImpact,false);
});

test('r56 release identity remains canonical on successors',()=>{
  const build=String(release.terminalBuild||''),rev=build.split('-').at(-1);
  assert.ok(/^10\.0-r\d+$/.test(build));
  assert.ok(Number(build.split('r').at(-1))>=56);
  assert.ok(root.includes(build+'-production'));
  assert.ok(root.includes('./v10/?build='+rev));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
});
