// ACHI MERIDIAN Context Interaction / Hierarchical Evidence Lab — v7.75
// Research-only. Learns a small predefined interaction set as residual edge versus broader parent cohorts.
// No Paper/live execution integration.

export const CONTEXT_INTERACTION_VERSION='7.75-CONTEXT-INTERACTION-V1';

export const CONTEXT_INTERACTION_OPTIONS=Object.freeze({
  minChildSamples:48,
  minParentSamples:96,
  shrinkageSamples:72,
  minReliableSamples:72,
  minStableWindows:3,
  minReliability:0.45,
  tradeResidualR:0.10,
  cautionResidualR:0.025,
  skipResidualR:-0.10,
  maxAbsResidualR:1.25
});

export const INTERACTION_SPECS=Object.freeze([
  {id:'SIDE_REGIME_MTF',fields:['side','regime','mtfAlignment'],parentFields:['side','regime']},
  {id:'SIDE_REGIME_MOMENTUM',fields:['side','regime','momentum'],parentFields:['side','regime']},
  {id:'SIDE_REGIME_VOLATILITY',fields:['side','regime','volatility'],parentFields:['side','regime']},
  {id:'ASSET_SIDE_REGIME',fields:['asset','side','regime'],parentFields:['side','regime']},
  {id:'SIDE_MTF_MOMENTUM',fields:['side','mtfAlignment','momentum'],parentFields:['side','mtfAlignment']},
  {id:'SIDE_VOLUME_VOLATILITY',fields:['side','volume','volatility'],parentFields:['side','volume']}
]);

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const upper=v=>String(v??'UNKNOWN').toUpperCase();
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function normalizedObservations(input={}){
  return{
    side:upper(input.side)==='SHORT'?'SHORT':'LONG',
    regime:upper(input.regime),
    mtfAlignment:String(input.mtfAlignment??'UNKNOWN'),
    momentum:upper(input.momentum),
    volume:upper(input.volume),
    volatility:upper(input.volatility),
    asset:upper(input.asset),
    baselineStatus:upper(input.baselineStatus)
  };
}

function keyFor(obs,fields){return fields.map(f=>obs[f]).join('|')}
function mean(rows=[]){return rows.length?rows.reduce((a,x)=>a+num(x.realizedR),0)/rows.length:null}
function median(rows=[]){if(!rows.length)return null;const a=rows.map(x=>num(x.realizedR)).sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function stats(rows=[]){
  const avgR=mean(rows),rs=rows.map(x=>num(x.realizedR)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rows.length,avgR:round(avgR),medianR:round(median(rows)),winRate:rows.length?round(wins.length/rows.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0),totalR:round(rs.reduce((a,b)=>a+b,0))};
}

function windowResiduals(childRows,parentRows,windows=[]){
  const out=[];
  for(const w of windows){
    const child=childRows.filter(r=>r.ts>=w.start&&r.ts<=w.end),parent=parentRows.filter(r=>r.ts>=w.start&&r.ts<=w.end);
    if(!child.length||!parent.length)continue;
    out.push({id:w.id??`${w.start}-${w.end}`,start:w.start,end:w.end,childN:child.length,parentN:parent.length,childAvgR:round(mean(child)),parentAvgR:round(mean(parent)),residualR:round(mean(child)-mean(parent))});
  }
  return out;
}

function residualReliability({childN,parentN,windows},options){
  const sample=Math.min(1,childN/Math.max(1,options.minReliableSamples));
  const parent=Math.min(1,parentN/Math.max(1,options.minParentSamples));
  const vals=(windows||[]).map(x=>num(x.residualR,NaN)).filter(Number.isFinite);
  const positive=vals.filter(x=>x>0).length,negative=vals.filter(x=>x<0).length;
  const agreement=vals.length?Math.max(positive,negative)/vals.length:0;
  const stability=vals.length>=options.minStableWindows?agreement:0.5;
  return{sample,parent,agreement,windowCount:vals.length,reliability:clamp(sample*parent*stability,0,1)};
}

export function buildInteractionEvidence(rows=[],windows=[],options=CONTEXT_INTERACTION_OPTIONS){
  const normalized=rows.map(r=>({...r,observations:normalizedObservations(r.observations||r)}));
  const result={version:CONTEXT_INTERACTION_VERSION,researchOnly:true,specs:{}};
  for(const spec of INTERACTION_SPECS){
    const childGroups=new Map(),parentGroups=new Map();
    for(const row of normalized){
      const childKey=keyFor(row.observations,spec.fields),parentKey=keyFor(row.observations,spec.parentFields);
      if(!childGroups.has(childKey))childGroups.set(childKey,[]);
      if(!parentGroups.has(parentKey))parentGroups.set(parentKey,[]);
      childGroups.get(childKey).push(row);parentGroups.get(parentKey).push(row);
    }
    const groups={};
    for(const [childKey,childRows] of childGroups){
      const obs=childRows[0].observations,parentKey=keyFor(obs,spec.parentFields),parentRows=parentGroups.get(parentKey)||[];
      const childStats=stats(childRows),parentStats=stats(parentRows),rawResidual=(childStats.avgR??0)-(parentStats.avgR??0);
      const windowRows=windowResiduals(childRows,parentRows,windows);
      const rel=residualReliability({childN:childRows.length,parentN:parentRows.length,windows:windowRows},options);
      const eligible=childRows.length>=options.minChildSamples&&parentRows.length>=options.minParentSamples;
      const shrink=childRows.length/(childRows.length+Math.max(1,options.shrinkageSamples));
      const residualR=eligible?clamp(rawResidual*shrink*rel.reliability,-options.maxAbsResidualR,options.maxAbsResidualR):0;
      groups[childKey]={
        spec:spec.id,childKey,parentKey,
        child:childStats,parent:parentStats,
        rawResidualR:round(rawResidual),residualR:round(residualR),
        reliability:round(rel.reliability),windowAgreement:round(rel.agreement),windowCount:rel.windowCount,
        eligible,windows:windowRows
      };
    }
    result.specs[spec.id]={fields:spec.fields,parentFields:spec.parentFields,groups};
  }
  return result;
}

export function evaluateInteractionEvidence(observations={},map={},options=CONTEXT_INTERACTION_OPTIONS){
  const obs=normalizedObservations(observations),components=[];
  for(const spec of INTERACTION_SPECS){
    const key=keyFor(obs,spec.fields),g=map?.specs?.[spec.id]?.groups?.[key];
    if(!g||!g.eligible||g.reliability<options.minReliability)continue;
    components.push({spec:spec.id,key,parentKey:g.parentKey,residualR:num(g.residualR),rawResidualR:num(g.rawResidualR),reliability:num(g.reliability),childN:g.child?.n??0,parentN:g.parent?.n??0,windowAgreement:g.windowAgreement});
  }
  const weight=components.reduce((a,x)=>a+x.reliability,0);
  const residualR=weight?components.reduce((a,x)=>a+x.residualR*x.reliability,0)/weight:0;
  const reliability=components.length?components.reduce((a,x)=>a+x.reliability,0)/components.length:0;
  let decision='OBSERVE';
  if(weight){
    if(residualR>=options.tradeResidualR)decision='TRADE';
    else if(residualR>=options.cautionResidualR)decision='CAUTION';
    else if(residualR<=options.skipResidualR)decision='SKIP';
    else decision='NEUTRAL';
  }
  return{version:CONTEXT_INTERACTION_VERSION,researchOnly:true,observations:obs,residualR:round(residualR),reliability:round(reliability),confidence:Math.round(clamp(50+residualR*35,0,100)),decision,components};
}

export const __test={normalizedObservations,keyFor,stats,windowResiduals,residualReliability};
