// ACHI MERIDIAN Volatility Context Drilldown — v7.77
// Research-only attribution of SIDE_REGIME_VOLATILITY OOS selections.

import { expandingFamilyWalkForward } from './interaction-family-ablation.js';

export const VOLATILITY_DRILLDOWN_VERSION='7.77-VOLATILITY-CONTEXT-DRILLDOWN-V1';
const SPEC='SIDE_REGIME_VOLATILITY';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function stats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}

function keySummary(rows=[],foldIds=[]){
  const byFold=foldIds.map(id=>{
    const r=rows.filter(x=>x.foldId===id);
    return{fold:id,...stats(r)};
  });
  const active=byFold.filter(x=>x.n>0),positive=active.filter(x=>x.avgR>0&&x.pf>=1);
  const s=stats(rows),assetCounts={};
  for(const x of rows){const a=x.asset||x.observations?.asset||'UNKNOWN';assetCounts[a]=(assetCounts[a]||0)+1}
  const maxAssetN=Math.max(0,...Object.values(assetCounts));
  return{...s,activeFolds:active.length,positiveFolds:positive.length,folds:byFold,assetCount:Object.keys(assetCounts).length,maxAssetSharePct:s.n?round(maxAssetN/s.n*100,2):0,assets:assetCounts};
}

export function drilldownVolatilityContext(rows=[],opts={}){
  const wf=expandingFamilyWalkForward(rows,SPEC,opts),foldIds=wf.slices.map(x=>x.id),selected=[];
  for(const slice of wf.slices){
    for(const row of slice.scored||[])if(row.traded)selected.push({...row,foldId:slice.id,contextKey:row.evaluation?.key||'UNKNOWN'});
  }
  const groups={};
  for(const row of selected){(groups[row.contextKey]??=[]).push(row)}
  const contexts=Object.entries(groups).map(([key,items])=>({key,...keySummary(items,foldIds)})).sort((a,b)=>(b.avgR??-Infinity)-(a.avgR??-Infinity)||b.n-a.n);
  return{
    version:VOLATILITY_DRILLDOWN_VERSION,researchOnly:true,executionImpact:false,specId:SPEC,
    aggregate:wf.aggregate,folds:wf.slices.map(x=>({id:x.id,trainStart:x.trainStart,trainEnd:x.trainEnd,testStart:x.testStart,testEnd:x.testEnd,selected:x.selected})),
    contexts,
    robustContexts:contexts.filter(x=>x.n>=8&&x.activeFolds>=2&&x.positiveFolds>=2&&x.avgR>0&&x.pf>=1&&x.maxAssetSharePct<=50),
    promotion:{allowed:false,reason:'ATTRIBUTION_ONLY_REQUIRES_REPEATABLE_OOS_CONTEXT'}
  };
}

export const __test={stats,keySummary};
