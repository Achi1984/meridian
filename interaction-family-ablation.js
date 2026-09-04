// ACHI MERIDIAN Interaction Family Attribution / Ablation Lab — v7.76
// Research-only. Evaluates each predefined v7.75 interaction family independently out of sample.

import { rollingWindows } from './adaptive-evidence-cohorts.js';
import { summarizeMarketCapture } from './adaptive-evidence.js';
import { buildInteractionEvidence, INTERACTION_SPECS, CONTEXT_INTERACTION_OPTIONS } from './context-interaction-evidence.js';

export const INTERACTION_ABLATION_VERSION='7.76-INTERACTION-ABLATION-V1';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const keyFor=(obs,fields)=>fields.map(f=>String(obs?.[f]??'UNKNOWN').toUpperCase()).join('|');

function outcomeStats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}

export function evaluateInteractionFamily(observations={},map={},specId,options=CONTEXT_INTERACTION_OPTIONS){
  const spec=INTERACTION_SPECS.find(x=>x.id===specId);
  if(!spec)throw new Error(`Unknown interaction family ${specId}`);
  const key=keyFor(observations,spec.fields),g=map?.specs?.[specId]?.groups?.[key];
  if(!g||!g.eligible||Number(g.reliability)<options.minReliability)return{version:INTERACTION_ABLATION_VERSION,researchOnly:true,specId,key,residualR:0,reliability:0,decision:'OBSERVE',component:null};
  const residualR=Number(g.residualR||0),reliability=Number(g.reliability||0);
  let decision='NEUTRAL';
  if(residualR>=options.tradeResidualR)decision='TRADE';
  else if(residualR>=options.cautionResidualR)decision='CAUTION';
  else if(residualR<=options.skipResidualR)decision='SKIP';
  return{version:INTERACTION_ABLATION_VERSION,researchOnly:true,specId,key,residualR:round(residualR),reliability:round(reliability),confidence:Math.round(clamp(50+residualR*35,0,100)),decision,component:{parentKey:g.parentKey,childN:g.child?.n||0,parentN:g.parent?.n||0,rawResidualR:g.rawResidualR,windowAgreement:g.windowAgreement}};
}

function scoreFamilyFold({trainRows,testRows,specId,trainWindowCount=4,interactionOptions}={}){
  const train=[...trainRows].sort((a,b)=>a.ts-b.ts),test=[...testRows].sort((a,b)=>a.ts-b.ts),trainEnd=train.at(-1)?.ts,testStart=test[0]?.ts;
  if(trainEnd!=null&&testStart!=null&&trainEnd>=testStart)throw new Error('Family ablation leakage: training overlaps test');
  const windows=train.length>1?rollingWindows({start:train[0].ts,end:trainEnd,count:Math.max(3,trainWindowCount)}):[];
  const map=buildInteractionEvidence(train,windows,interactionOptions);
  const scored=test.map(row=>{
    const evaluation=evaluateInteractionFamily(row.observations,map,specId,interactionOptions);
    const traded=['TRADE','CAUTION'].includes(evaluation.decision);
    return{...row,evaluation,traded,counterfactualR:Number(row.realizedR||0),realizedR:traded?Number(row.realizedR||0):0};
  });
  return{map,scored};
}

export function expandingFamilyWalkForward(rows=[],specId,opts={}){
  const sorted=[...rows].filter(x=>Number.isFinite(Number(x.ts))).sort((a,b)=>a.ts-b.ts),slices=Math.max(3,Number(opts.slices||5));
  if(sorted.length<2)return{version:INTERACTION_ABLATION_VERSION,researchOnly:true,specId,slices:[],aggregate:{selected:outcomeStats([]),opportunities:outcomeStats([]),marketCapture:summarizeMarketCapture([])}};
  const start=sorted[0].ts,end=sorted.at(-1).ts,span=(end-start)/slices,results=[];
  for(let i=1;i<slices;i++){
    const testStart=start+i*span+1,testEnd=i===slices-1?end:start+(i+1)*span,trainRows=sorted.filter(r=>r.ts<testStart),testRows=sorted.filter(r=>r.ts>=testStart&&r.ts<=testEnd);
    if(!trainRows.length||!testRows.length)continue;
    const fold=scoreFamilyFold({trainRows,testRows,specId,trainWindowCount:opts.trainWindowCount||4,interactionOptions:opts.interactionOptions});
    const selected=fold.scored.filter(x=>x.traded),opportunities=fold.scored.map(x=>({...x,realizedR:x.counterfactualR}));
    results.push({id:`OOS${i}`,trainStart:trainRows[0].ts,trainEnd:trainRows.at(-1).ts,testStart,testEnd,selected:outcomeStats(selected),opportunities:outcomeStats(opportunities),marketCapture:summarizeMarketCapture(fold.scored),scored:fold.scored});
  }
  const scored=results.flatMap(x=>x.scored),selected=scored.filter(x=>x.traded),opportunities=scored.map(x=>({...x,realizedR:x.counterfactualR}));
  return{version:INTERACTION_ABLATION_VERSION,researchOnly:true,specId,method:'ONE_INTERACTION_FAMILY_EXPANDING_TRAIN_STRICTLY_BEFORE_TEST',slices:results,aggregate:{selected:outcomeStats(selected),opportunities:outcomeStats(opportunities),marketCapture:summarizeMarketCapture(scored)}};
}

export function runInteractionFamilyAblation(rows=[],opts={}){
  const families={};
  for(const spec of INTERACTION_SPECS)families[spec.id]=expandingFamilyWalkForward(rows,spec.id,opts);
  const ranking=Object.values(families).map(x=>({specId:x.specId,selected:x.aggregate.selected,marketCapture:x.aggregate.marketCapture})).sort((a,b)=>{
    const ap=a.selected.avgR??-Infinity,bp=b.selected.avgR??-Infinity;
    return bp-ap||(b.selected.pf??0)-(a.selected.pf??0);
  });
  return{version:INTERACTION_ABLATION_VERSION,researchOnly:true,method:'PREDEFINED_FAMILY_OOS_ABLATION',families,ranking};
}

export const __test={outcomeStats,scoreFamilyFold,keyFor};
