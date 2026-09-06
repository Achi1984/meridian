// MERIDIAN v7.90 — Hybrid Alpha V1 leakage-safe research harness.
// RESEARCH ONLY. Consumes precomputed decision-time features and realized forward outcomes.
import {hybridAlphaDecision} from './hybrid-alpha-v1.js';

const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;

function stats(rows=[]){
  const wins=rows.filter(x=>x.netR>0),losses=rows.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0));
  const pnl=rows.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,maxDd=0;
  for(const x of rows){eq+=x.netR;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq)}
  return {trades:rows.length,netR:round(pnl),expectancy:rows.length?round(pnl/rows.length):null,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null,maxDrawdownR:round(maxDd)};
}
function group(rows,keyFn){
  const buckets={};
  for(const r of rows){const k=String(keyFn(r)||'UNKNOWN');(buckets[k]||(buckets[k]=[])).push(r)}
  return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,stats(v)]));
}

export function runHybridAlphaBacktest(samples=[],opts={}){
  const costR=Math.max(0,n(opts.costR)??0);
  const decisionFn=typeof opts.decisionFn==='function'?opts.decisionFn:hybridAlphaDecision;
  const rows=[];let observed=0,invalid=0;
  for(const s of samples){
    const outcome=n(s?.forwardR);
    if(outcome==null){invalid++;continue}
    const d=decisionFn(s?.features||s||{});
    if(d.side==='OBSERVE'){observed++;continue}
    const signedOutcome=(d.side==='LONG'?1:-1)*outcome;
    const grossR=signedOutcome*d.riskMultiplier;
    // Cost is specified per 1.0 research-risk unit and therefore scales with position/risk.
    const netR=(signedOutcome-costR)*d.riskMultiplier;
    const row={timestamp:s.timestamp||null,symbol:String(s.symbol||'UNKNOWN'),regime:d.regime,side:d.side,alpha:d.alpha,confidence:d.confidence,riskMultiplier:d.riskMultiplier,grossR:round(grossR),costR:round(costR*d.riskMultiplier),netR:round(netR)};
    // Preserve optional decision metadata for audit/drill-down without coupling the generic harness to one overlay.
    for(const key of ['macroTrend','macroAlignment','macroRiskFactor','reliability']){
      const value=n(d?.[key]);if(value!=null)row[key]=round(value);
    }
    rows.push(row);
  }
  return {schemaVersion:'7.90-HYBRID-BACKTEST-V4',researchOnly:true,executionImpact:false,inputSamples:samples.length,invalidSamples:invalid,observedSamples:observed,executedResearchTrades:rows.length,costR,summary:stats(rows),bySide:group(rows,x=>x.side),byRegime:group(rows,x=>x.regime),bySymbol:group(rows,x=>x.symbol),rows};
}

export function walkForwardSlices(samples=[],opts={}){
  const ordered=[...samples].filter(x=>x?.timestamp).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const folds=Math.max(2,Math.floor(n(opts.folds)??3));
  if(ordered.length<folds)return [];
  const size=Math.ceil(ordered.length/folds);
  const out=[];
  for(let i=0;i<folds;i++){
    const chunk=ordered.slice(i*size,(i+1)*size);if(!chunk.length)continue;
    out.push({fold:i+1,start:chunk[0].timestamp,end:chunk.at(-1).timestamp,result:runHybridAlphaBacktest(chunk,opts)});
  }
  return out;
}
