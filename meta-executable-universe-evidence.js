// ACHI MERIDIAN Meta Allocator — Executable Universe Attribution v7.80 R3
// Research-only. Predeclared opportunity pools and matrix subclasses; no routing or sizing.

export const META_EXEC_UNIVERSE_VERSION='7.80-R3-EXECUTABLE-UNIVERSE-V1';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function opinion(row,bot){return (row?.opinions||[]).find(x=>x.bot===bot)||{};}
function supportive(o){return ['TRADE','CAUTION'].includes(o?.action);}
function stats(rows=[]){
  const rs=rows.map(x=>Number(x?.outcome?.realizedR)).filter(Number.isFinite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}
function foldStats(rows=[],folds=5){
  if(!rows.length)return[];
  const a=[...rows].sort((x,y)=>(x.ts||0)-(y.ts||0)),start=a[0].ts,end=a.at(-1).ts,span=Math.max(1,(end-start+1)/folds),out=[];
  for(let i=0;i<folds;i++){
    const lo=start+i*span,hi=i===folds-1?end+1:start+(i+1)*span;
    const r=a.filter(x=>(x.ts||0)>=lo&&(x.ts||0)<hi);
    out.push({id:`F${i+1}`,start:Math.floor(lo),end:Math.floor(hi-1),...stats(r)});
  }
  return out;
}
function universeKey(row){
  const b=opinion(row,'BASELINE'),r=opinion(row,'REGIME');
  if(b.action==='TRADE')return'BASELINE_READY';
  if(supportive(r))return'REGIME_ONLY';
  if((row.actions?.supportive||0)>0)return'ANY_SUPPORT';
  return'NO_SUPPORT';
}
function subclasses(row){
  const out=[],b=opinion(row,'BASELINE'),s=opinion(row,'SHADOW'),c=opinion(row,'CHALLENGER'),r=opinion(row,'REGIME');
  if(b.action==='TRADE'){
    out.push(supportive(s)?'BASELINE_READY|SHADOW_SUPPORT':'BASELINE_READY|NO_SHADOW_SUPPORT');
    out.push(c.action==='TRADE'?'BASELINE_READY|CHALLENGER_TRADE':c.action==='CAUTION'?'BASELINE_READY|CHALLENGER_CAUTION':'BASELINE_READY|CHALLENGER_OTHER');
    out.push(row.disagreement?.sideConflict?'BASELINE_READY|REGIME_SIDE_CONFLICT':'BASELINE_READY|NO_REGIME_SIDE_CONFLICT');
    out.push(`BASELINE_READY|SUPPORT_${row.actions?.supportive??0}`);
  }
  if(supportive(r)&&b.action!=='TRADE')out.push(`REGIME_ONLY|${r.side||'NO_SIDE'}|${r.action}`);
  if((row.actions?.supportive||0)>0)out.push(row.disagreement?.hardDisagreement?'ANY_SUPPORT|HARD_DISAGREEMENT':'ANY_SUPPORT|NO_HARD_DISAGREEMENT');
  return out;
}
function summarizeGroup(key,rows,folds){
  const fs=foldStats(rows,folds),active=fs.filter(x=>x.n>0),positive=active.filter(x=>x.avgR>0&&x.pf>=1);
  return{key,...stats(rows),activeFolds:active.length,positiveFolds:positive.length,folds:fs};
}
export function executableUniverseEvidence(rows=[],opts={}){
  const folds=Math.max(3,Number(opts.folds)||5),matured=rows.filter(x=>Number.isFinite(Number(x?.outcome?.realizedR)));
  const universes={};
  for(const row of matured){const k=universeKey(row);(universes[k]??=[]).push(row)}
  const classes={};
  for(const row of matured)for(const k of subclasses(row))(classes[k]??=[]).push(row);
  return{
    version:META_EXEC_UNIVERSE_VERSION,researchOnly:true,executionImpact:false,all:stats(matured),
    universes:Object.entries(universes).map(([k,v])=>summarizeGroup(k,v,folds)).sort((a,b)=>b.n-a.n),
    subclasses:Object.entries(classes).map(([k,v])=>summarizeGroup(k,v,folds)).sort((a,b)=>b.n-a.n),
    candidateClasses:Object.entries(classes).map(([k,v])=>summarizeGroup(k,v,folds)).filter(x=>x.n>=20&&x.activeFolds>=3&&x.positiveFolds>=Math.ceil(x.activeFolds*.6)&&x.avgR>0&&x.pf>1),
    promotion:{allowed:false,reason:'PREDECLARED_ATTRIBUTION_ONLY_NO_ALLOCATOR_POLICY'}
  };
}
export const __test={opinion,supportive,stats,foldStats,universeKey,subclasses};
