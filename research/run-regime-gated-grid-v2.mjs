import fs from 'node:fs';
import path from 'node:path';
import {
  DYNAMIC_GRID_PROXY_V1_RULESET,
  DYNAMIC_GRID_PROXY_V1_ASSETS,
  DYNAMIC_GRID_PROXY_V1_PATHS,
  DYNAMIC_GRID_PROXY_V1_STEPS,
  DYNAMIC_GRID_PROXY_V1_HALF_LEVELS,
  DYNAMIC_GRID_PROXY_V1_CONFIG,
  runDynamicGridMonth,
  summarizeGridCycles,
  evaluateDynamicGridPath,
  evaluateDynamicGridCandidate
} from './dynamic-grid-proxy-v1.js';
import {validateMinuteBars} from './grid-path-simulator-v1.js';
import {
  REGIME_GATED_GRID_V2_RULESET,
  REGIME_GATED_GRID_V2_CONFIG,
  evaluateRangeRegime,
  validateDailyContinuity,
  monthStartMs
} from './regime-gated-grid-v2.js';

const DATA=process.env.REGIME_GRID_DATA_DIR||'/tmp/meridian-regime-grid';
const OUT=path.resolve('research/results');
const START='2024-01',END='2025-12';

function monthRange(a,b){
  let [y,m]=a.split('-').map(Number),[ey,em]=b.split('-').map(Number),out=[];
  while(y<ey||(y===ey&&m<=em)){
    out.push(y+'-'+String(m).padStart(2,'0'));m++;if(m===13){y++;m=1}
  }
  return out;
}
function tsMs(v){
  let x=Number(v);
  while(x>1e14)x=Math.floor(x/1000);
  return x;
}
function parseCsv(file){
  if(!fs.existsSync(file))throw new Error('missing archive '+file);
  const out=[];
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    if(!line)continue;
    const x=line.split(',');
    if(x.length<7)continue;
    const openTime=tsMs(x[0]),open=Number(x[1]),high=Number(x[2]),low=Number(x[3]),close=Number(x[4]),closeTime=tsMs(x[6]);
    if([openTime,open,high,low,close,closeTime].every(Number.isFinite))out.push({openTime,open,high,low,close,closeTime});
  }
  return out;
}
function loadDaily(asset){
  const dir=path.join(DATA,asset,'1d');
  const files=fs.readdirSync(dir).filter(x=>x.endsWith('.csv')).sort();
  return files.flatMap(f=>parseCsv(path.join(dir,f)));
}
function loadMinute(asset,month){return parseCsv(path.join(DATA,asset,'1m',month+'.csv'))}
function candidateKey(stepPct,halfLevels){return 'RG2_GEO_'+String(stepPct).replace('.','p')+'_H'+halfLevels}
function makeStore(stepPct,halfLevels){
  return{
    key:candidateKey(stepPct,halfLevels),stepPct,halfLevels,
    PAPER_OLHC:{dynamic:[],static:[],stress:[]},
    ALT_OHLC:{dynamic:[],static:[],stress:[]}
  };
}
function push(store,pathMode,asset,bars){
  const common={bars,stepPct:store.stepPct,halfLevels:store.halfLevels,pathMode,levelMode:'GEOMETRIC'};
  const d=runDynamicGridMonth({...common,dynamicReset:true});
  const s=runDynamicGridMonth({...common,dynamicReset:false});
  const stress=runDynamicGridMonth({...common,dynamicReset:true,slippageBps:DYNAMIC_GRID_PROXY_V1_CONFIG.slippageBps+DYNAMIC_GRID_PROXY_V1_CONFIG.stressExtraSlippageBps});
  store[pathMode].dynamic.push({...d,asset});
  store[pathMode].static.push({...s,asset});
  store[pathMode].stress.push({...stress,asset});
}
function cleanSummary(x){
  return{
    cycles:x.cycles,pairedCycles:x.pairedCycles,months:x.months,totalReturnPct:x.totalReturnPct,
    profitFactor:x.profitFactor,maxDrawdownPct:x.maxDrawdownPct,positiveWindows:x.positiveWindows,
    byAsset:x.byAsset,fills:x.fills,resets:x.resets,costs:x.costs,insufficientWallet:x.insufficientWallet,rejected:x.rejected
  };
}
function cleanPathEval(x){return{pass:x.pass,reasons:x.reasons,dynamic:cleanSummary(x.dynamic),static:cleanSummary(x.static)}}
function compactCandidate(store){
  const gate=REGIME_GATED_GRID_V2_CONFIG.discoveryGate;
  const paper=evaluateDynamicGridPath({dynamicCycles:store.PAPER_OLHC.dynamic,staticCycles:store.PAPER_OLHC.static,gate});
  const alt=evaluateDynamicGridPath({dynamicCycles:store.ALT_OHLC.dynamic,staticCycles:store.ALT_OHLC.static,gate});
  const paperStress={dynamic:summarizeGridCycles(store.PAPER_OLHC.stress)};
  const altStress={dynamic:summarizeGridCycles(store.ALT_OHLC.stress)};
  const g=evaluateDynamicGridCandidate({paper,alt,paperStress,altStress,gate});
  return{
    key:store.key,stepPct:store.stepPct,halfLevels:store.halfLevels,levelMode:'GEOMETRIC',
    gatePass:g.pass,gateReasons:g.reasons,worstPathReturnPct:g.worstPathReturnPct,
    worstPathMaxDrawdownPct:g.worstPathMaxDrawdownPct,pathSpreadPctPoints:g.pathSpreadPctPoints,
    PAPER_OLHC:cleanPathEval(paper),ALT_OHLC:cleanPathEval(alt),
    stress:{PAPER_OLHC:paperStress.dynamic.totalReturnPct,ALT_OHLC:altStress.dynamic.totalReturnPct}
  };
}
function compound(rs){let e=1;for(const r of rs)e*=1+r;return(e-1)*100}

const months=monthRange(START,END),daily={};
for(const asset of DYNAMIC_GRID_PROXY_V1_ASSETS){
  daily[asset]=validateDailyContinuity(loadDaily(asset));
}

const regime={eligible:[],ineligible:[]};
for(const month of months)for(const asset of DYNAMIC_GRID_PROXY_V1_ASSETS){
  const r=evaluateRangeRegime(daily[asset],monthStartMs(month));
  const row={asset,month,eligible:r.eligible,reasons:r.reasons,efficiencyRatio:r.efficiencyRatio??null,rangePosition:r.rangePosition??null,volRatio:r.volRatio??null,asOf:r.asOf??null};
  (r.eligible?regime.eligible:regime.ineligible).push(row);
}

const eligibleSet=new Set(regime.eligible.map(x=>x.asset+'|'+x.month));
const eligibleByAsset=Object.fromEntries(DYNAMIC_GRID_PROXY_V1_ASSETS.map(a=>[a,regime.eligible.filter(x=>x.asset===a).length]));
const pairedEligibleMonths=months.filter(m=>DYNAMIC_GRID_PROXY_V1_ASSETS.every(a=>eligibleSet.has(a+'|'+m)));

const stores=[];
for(const stepPct of DYNAMIC_GRID_PROXY_V1_STEPS)for(const halfLevels of DYNAMIC_GRID_PROXY_V1_HALF_LEVELS)stores.push(makeStore(stepPct,halfLevels));

const executionData={valid:[],rejected:[]},buyHold={BTC:[],ETH:[]};
let seq=0,totalEligible=regime.eligible.length;
for(const month of months){
  for(const asset of DYNAMIC_GRID_PROXY_V1_ASSETS){
    if(!eligibleSet.has(asset+'|'+month))continue;
    seq++;
    process.stdout.write('eligible '+seq+'/'+totalEligible+' '+asset+' '+month+' ... ');
    let bars;
    try{
      bars=loadMinute(asset,month);
      validateMinuteBars(bars,{maxGapMs:DYNAMIC_GRID_PROXY_V1_CONFIG.maxGapMs});
    }catch(e){
      executionData.rejected.push({asset,month,reason:String(e?.message||e)});
      console.log('REJECT '+String(e?.message||e));
      continue;
    }
    executionData.valid.push({asset,month,bars:bars.length,first:bars[0].openTime,last:bars.at(-1).openTime});
    buyHold[asset].push(bars.at(-1).close/bars[0].open-1);
    for(const store of stores)for(const pathMode of DYNAMIC_GRID_PROXY_V1_PATHS)push(store,pathMode,asset,bars);
    console.log('OK bars='+bars.length);
  }
}

const candidates=stores.map(compactCandidate);
const passing=candidates.filter(x=>x.gatePass).sort((a,b)=>b.worstPathReturnPct-a.worstPathReturnPct||a.worstPathMaxDrawdownPct-b.worstPathMaxDrawdownPct);
const leader=passing[0]||null;
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:REGIME_GATED_GRID_V2_RULESET,
  parentRuleset:DYNAMIC_GRID_PROXY_V1_RULESET,
  discovery:{start:START,end:END,assets:[...DYNAMIC_GRID_PROXY_V1_ASSETS],levelMode:'GEOMETRIC'},
  regime:{
    eligibleByAsset,
    pairedEligibleMonths,
    pairedEligibleAssetMonths:pairedEligibleMonths.length*DYNAMIC_GRID_PROXY_V1_ASSETS.length,
    eligible:regime.eligible,
    ineligible:regime.ineligible
  },
  executionData,
  candidateCount:candidates.length,
  buyHoldDiagnosticPct:{BTC:compound(buyHold.BTC),ETH:compound(buyHold.ETH)},
  passingCandidates:passing.map(x=>x.key),
  leader:leader?{key:leader.key,stepPct:leader.stepPct,halfLevels:leader.halfLevels,worstPathReturnPct:leader.worstPathReturnPct,worstPathMaxDrawdownPct:leader.worstPathMaxDrawdownPct,pathSpreadPctPoints:leader.pathSpreadPctPoints}:null,
  decision:leader?'DISCOVERY_PASS_HOLDOUT_REQUIRED':'DISCOVERY_FAIL_RESEARCH_REDESIGN',
  researchOnly:true,executionImpact:false,autoPromotion:false
};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'regime-gated-grid-v2-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'regime-gated-grid-v2-full.json'),JSON.stringify({summary,candidates},null,2)+'\n');
const rows=candidates.map(x=>`| ${x.key} | ${(x.stepPct*100).toFixed(1)}% | ${x.halfLevels} | ${x.PAPER_OLHC.dynamic.totalReturnPct.toFixed(2)}% | ${x.ALT_OHLC.dynamic.totalReturnPct.toFixed(2)}% | ${Math.min(x.stress.PAPER_OLHC,x.stress.ALT_OHLC).toFixed(2)}% | ${x.worstPathMaxDrawdownPct.toFixed(2)}% | ${x.gatePass?'PASS':'FAIL'} |`).join('\n');
const md=`# Regime-Gated Grid V2 — Discovery

Generated: ${summary.generatedAt}

Window: ${START} through ${END}. Eligible paired months: ${summary.regime.pairedEligibleMonths.length} / ${months.length}.

| Candidate | Step | Half | PAPER return | ALT return | Worst stress | Worst DD | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
${rows}

**Decision:** ${summary.decision}

**Leader:** ${summary.leader?.key||'NONE'}

Eligible by asset: BTC ${summary.regime.eligibleByAsset.BTC}, ETH ${summary.regime.eligibleByAsset.ETH}.

Research only. No Paper or live promotion from discovery.
`;
fs.writeFileSync(path.join(OUT,'regime-gated-grid-v2.md'),md);
console.log(JSON.stringify(summary,null,2));
