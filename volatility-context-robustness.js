// ACHI MERIDIAN Volatility Context Robustness Lab — v7.78
// Research-only. Stress-tests the predeclared v7.77 candidate context without changing thresholds.

export const VOLATILITY_ROBUSTNESS_VERSION='7.78-VOLATILITY-CONTEXT-ROBUSTNESS-V1';
export const PREDECLARED_CONTEXT='LONG|TRANSITION|NORMAL';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function stats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}

function contextKey(row){const o=row.observations||row;return [o.side,o.regime,o.volatility].map(x=>String(x??'UNKNOWN').toUpperCase()).join('|')}

export function fixedContextRows(rows=[],context=PREDECLARED_CONTEXT){return rows.filter(r=>contextKey(r)===context)}

export function temporalBuckets(rows=[],count=6){
  const sorted=[...rows].sort((a,b)=>a.ts-b.ts);
  if(!sorted.length)return[];
  const start=sorted[0].ts,end=sorted.at(-1).ts,span=Math.max(1,(end-start)/count),out=[];
  for(let i=0;i<count;i++){
    const a=start+i*span,b=i===count-1?end:start+(i+1)*span;
    const bucket=sorted.filter(r=>r.ts>=a&&r.ts<=(i===count-1?b:b-1));
    out.push({id:`T${i+1}`,start:a,end:b,...stats(bucket)});
  }
  return out;
}

export function leaveOneAssetOut(rows=[]){
  const assets=[...new Set(rows.map(r=>r.asset||r.observations?.asset).filter(Boolean))].sort();
  return assets.map(asset=>({excludedAsset:asset,...stats(rows.filter(r=>(r.asset||r.observations?.asset)!==asset))}));
}

export function robustnessSummary(rows=[],opts={}){
  const context=opts.context||PREDECLARED_CONTEXT,selected=fixedContextRows(rows,context),temporal=temporalBuckets(selected,opts.temporalBuckets||6),loo=leaveOneAssetOut(selected);
  const activeTemporal=temporal.filter(x=>x.n>0),positiveTemporal=activeTemporal.filter(x=>x.avgR>0&&x.pf>=1);
  const adequateLoo=loo.filter(x=>x.n>=Math.max(8,Math.floor(selected.length*.5))),positiveLoo=adequateLoo.filter(x=>x.avgR>0&&x.pf>=1);
  const overall=stats(selected);
  return{
    version:VOLATILITY_ROBUSTNESS_VERSION,researchOnly:true,executionImpact:false,context,overall,temporal,leaveOneAssetOut:loo,
    diagnostics:{activeTemporalBuckets:activeTemporal.length,positiveTemporalBuckets:positiveTemporal.length,adequateLooCases:adequateLoo.length,positiveLooCases:positiveLoo.length},
    robustnessGate:{
      passed:overall.n>=24&&overall.avgR>0&&overall.pf>=1.2&&positiveTemporal.length>=Math.max(3,Math.ceil(activeTemporal.length*.6))&&positiveLoo.length===adequateLoo.length,
      note:'Stress-test only. Passing does not remove post-selection bias from discovery on the same historical sample.'
    },
    promotion:{allowed:false,reason:'SAME_SAMPLE_ROBUSTNESS_ONLY_NEEDS_FUTURE_HOLDOUT'}
  };
}

export const __test={stats,contextKey};
