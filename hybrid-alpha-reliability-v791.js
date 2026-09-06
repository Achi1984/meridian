// MERIDIAN v7.91 — Prior-only reliability router for Hybrid Alpha V1.
// RESEARCH ONLY. No execution hooks. Reliability may only reduce V1 research risk.
import {hybridAlphaDecision} from './hybrid-alpha-v1.js';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;

function stats(rows=[]){
  const wins=rows.filter(x=>x.netR>0),losses=rows.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0));
  const netR=rows.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,maxDd=0;
  for(const x of rows){eq+=x.netR;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq)}
  return {trades:rows.length,netR:round(netR),expectancy:rows.length?round(netR/rows.length):null,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null,maxDrawdownR:round(maxDd)};
}
function group(rows,key){const b={};for(const r of rows){const k=String(r[key]||'UNKNOWN');(b[k]||(b[k]=[])).push(r)}return Object.fromEntries(Object.entries(b).map(([k,v])=>[k,stats(v)]))}

function reliabilityFactor(records,key,value,now,opts){
  const lookbackMs=opts.lookbackMs??60*86400000;
  const minSamples=opts.minSamples??8;
  const priorStrength=opts.priorStrength??20;
  const xs=records.filter(r=>r.matureAt<=now&&r.timestamp>=now-lookbackMs&&r[key]===value);
  if(xs.length<minSamples)return {factor:1,n:xs.length,expectancy:null,shrunk:null};
  const exp=xs.reduce((a,x)=>a+clamp(x.rawR,-4,4),0)/xs.length;
  const shrunk=exp*(xs.length/(xs.length+priorStrength));
  const factor=shrunk>=0?1:clamp(1/(1+Math.abs(shrunk)),.35,1);
  return {factor,n:xs.length,expectancy:round(exp),shrunk:round(shrunk)};
}

export function runReliabilityRouterBacktest(samples=[],opts={}){
  const costR=Math.max(0,n(opts.costR)??0);
  const horizonMs=Math.max(1,n(opts.horizonMs)??4*3600000);
  const ordered=[...samples].filter(x=>x?.timestamp).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const history=[],rows=[];let observed=0,invalid=0;
  for(const s of ordered){
    const outcome=n(s?.forwardR),ts=Date.parse(s.timestamp);
    if(outcome==null||!Number.isFinite(ts)){invalid++;continue}
    const d=hybridAlphaDecision(s?.features||s||{});
    if(d.side==='OBSERVE'){observed++;continue}
    const symbol=String(s.symbol||'UNKNOWN');
    const sideRel=reliabilityFactor(history,'side',d.side,ts,opts);
    const regimeRel=reliabilityFactor(history,'regime',d.regime,ts,opts);
    const symbolRel=reliabilityFactor(history,'symbol',symbol,ts,opts);
    const reliability=(sideRel.factor+regimeRel.factor+symbolRel.factor)/3;
    const finalRisk=clamp(d.riskMultiplier*reliability,.035,d.riskMultiplier);
    const signedOutcome=(d.side==='LONG'?1:-1)*outcome;
    const netR=(signedOutcome-costR)*finalRisk;
    rows.push({timestamp:s.timestamp,symbol,side:d.side,regime:d.regime,alpha:d.alpha,baseRisk:d.riskMultiplier,reliability:round(reliability),riskMultiplier:round(finalRisk),netR:round(netR),sideRel,regimeRel,symbolRel});
    history.push({timestamp:ts,matureAt:ts+horizonMs,side:d.side,regime:d.regime,symbol,rawR:signedOutcome});
  }
  return {schemaVersion:'7.91-HYBRID-RELIABILITY-V1',researchOnly:true,executionImpact:false,inputSamples:samples.length,invalidSamples:invalid,observedSamples:observed,executedResearchTrades:rows.length,costR,horizonMs,summary:stats(rows),bySide:group(rows,'side'),byRegime:group(rows,'regime'),bySymbol:group(rows,'symbol'),rows};
}
