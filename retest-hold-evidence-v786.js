// MERIDIAN v7.86 R2 — Retest / Hold historical evidence
// Research-only. Fixed V2 signal logic + fixed exits. No Paper/live execution impact.

import { retestHoldDecision, RETEST_HOLD_VERSION } from './retest-hold-breakout-v2.js';

export const RETEST_HOLD_EVIDENCE_VERSION='7.86-RETEST-HOLD-EVIDENCE-R2';
const DAY=86400000;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function lastIndexAt(rows,t){let lo=0,hi=rows.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(Number(rows[m].closeTime)<=t){ans=m;lo=m+1}else hi=m-1}return ans}
function sliceAt(rows,t,max=220){const i=lastIndexAt(rows,t);return i<0?[]:rows.slice(Math.max(0,i-max+1),i+1)}

export function outcomeR(signal,future15m=[],opts={}){
  if(!signal||!['LONG','SHORT'].includes(signal.side)||!(signal.entry>0)||!(signal.sl>0)||!(signal.tp1>0))return null;
  const feeBps=Number(opts.feeBps??5),slippageBps=Number(opts.slippageBps??3);
  const R=Math.abs(signal.entry-signal.sl);if(!(R>0))return null;
  const side=signal.side,entry=signal.entry;let exit=Number(future15m.at(-1)?.close),reason='TIMEOUT';
  for(const c of future15m){
    const adverse=side==='LONG'?Number(c.low)<=signal.sl:Number(c.high)>=signal.sl;
    const hit=side==='LONG'?Number(c.high)>=signal.tp1:Number(c.low)<=signal.tp1;
    if(adverse){exit=signal.sl;reason='SL';break}
    if(hit){exit=signal.tp1;reason='TP1';break}
  }
  if(!(exit>0))return null;
  const dir=side==='LONG'?1:-1,grossR=((exit-entry)*dir)/R;
  const costsUsd=entry*(feeBps+slippageBps*2)/10000+exit*feeBps/10000;
  return{r:round(grossR-costsUsd/R,4),grossR:round(grossR,4),costR:round(costsUsd/R,4),reason,exit:round(exit,8)};
}

export function prepareRetestHoldSignals({market,start,end,stepMinutes=15,horizonHours=48}={}){
  const out=[],step=stepMinutes*60000,horizon=horizonHours*3600000;
  for(const [symbol,data] of Object.entries(market||{})){
    const m15=data?.['15m']||[],h1=data?.['1h']||[];if(!m15.length)continue;
    for(let t=start;t<=end;t+=step){
      const c15=sliceAt(m15,t,220);if(c15.length<80)continue;
      const last=c15.at(-1);if(Math.abs(Number(last.closeTime)-t)>step)continue;
      const c1=sliceAt(h1,t,120),sig=retestHoldDecision({symbol,candles15m:c15,candles1h:c1});
      if(!['TRADE','OBSERVE'].includes(sig.decision))continue;
      const future=m15.filter(c=>Number(c.closeTime)>t&&Number(c.closeTime)<=t+horizon),outcome=outcomeR(sig,future);if(!outcome)continue;
      out.push({ts:t,symbol,decision:sig.decision,side:sig.side,score:sig.score,riskPct:sig.riskPct,components:sig.components,features:sig.features,outcomeR:outcome.r,exitReason:outcome.reason});
    }
  }
  return out.sort((a,b)=>a.ts-b.ts||a.symbol.localeCompare(b.symbol));
}

export function stats(rows=[]){
  const xs=rows.filter(x=>Number.isFinite(Number(x.outcomeR))),rs=xs.map(x=>Number(x.outcomeR));
  const pos=rs.filter(x=>x>0).reduce((a,b)=>a+b,0),neg=Math.abs(rs.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return{n:xs.length,avgR:xs.length?round(rs.reduce((a,b)=>a+b,0)/xs.length,4):null,totalR:round(rs.reduce((a,b)=>a+b,0),4),pf:neg>0?round(pos/neg,3):(pos>0?99:null),winRate:xs.length?round(rs.filter(x=>x>0).length/xs.length*100,2):null};
}
function chronologicalFolds(rows,k=5){if(!rows.length)return[];const sorted=[...rows].sort((a,b)=>a.ts-b.ts),n=Math.ceil(sorted.length/k),out=[];for(let i=0;i<k;i++){const part=sorted.slice(i*n,Math.min(sorted.length,(i+1)*n));if(part.length)out.push({fold:i+1,...stats(part),start:part[0].ts,end:part.at(-1).ts})}return out}
function splitBy(rows,key){const m=new Map();for(const r of rows){const v=String(r[key]??'UNKNOWN');if(!m.has(v))m.set(v,[]);m.get(v).push(r)}return Object.fromEntries([...m.entries()].map(([k,v])=>[k,stats(v)]))}

export function retestHoldEvidenceReport(rows=[],opts={}){
  const windows=opts.windowsDays||[30,60,90],dataEnd=Number(opts.dataEnd??Date.now());
  const result={version:RETEST_HOLD_EVIDENCE_VERSION,signalVersion:RETEST_HOLD_VERSION,researchOnly:true,executionImpact:false,dataEnd,windows:{},promotion:{allowed:false,reason:'RESEARCH_ONLY_NO_AUTO_PROMOTION'}};
  for(const days of windows){const start=dataEnd-days*DAY,subset=rows.filter(r=>r.ts>=start&&r.ts<=dataEnd),trade=subset.filter(r=>r.decision==='TRADE'),observe=subset.filter(r=>r.decision==='OBSERVE');result.windows[`${days}d`]={all:stats(subset),trade:stats(trade),observe:stats(observe),bySide:splitBy(trade,'side'),byAsset:splitBy(trade,'symbol'),folds:chronologicalFolds(trade,5)}}
  return result;
}

export function markdownRetestHoldReport(report){
  const lines=['# MERIDIAN v7.86 R2 — Retest / Hold Breakout Evidence','',`Signal: \`${report.signalVersion}\``,'','Research-only. No Paper/live execution impact.',''];
  for(const [w,x] of Object.entries(report.windows||{})){lines.push(`## ${w}`,`TRADE: n=${x.trade.n}, avgR=${x.trade.avgR}, PF=${x.trade.pf}, win=${x.trade.winRate}%, totalR=${x.trade.totalR}`,'',`OBSERVE: n=${x.observe.n}, avgR=${x.observe.avgR}, PF=${x.observe.pf}`,'','Chronological folds:');for(const f of x.folds||[])lines.push(`- F${f.fold}: n=${f.n}, avgR=${f.avgR}, PF=${f.pf}, win=${f.winRate}%`);lines.push('')}
  lines.push('## Interpretation','','No threshold tuning or promotion is performed by this report. Compare directly with v7.85 V1 negative control; repeated positive expectancy across windows/folds is required before any shadow ledger.');return lines.join('\n');
}

export const __test={lastIndexAt,sliceAt,chronologicalFolds};
