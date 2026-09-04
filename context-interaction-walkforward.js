// ACHI MERIDIAN Context Interaction Walk-Forward — v7.75
// Research-only. Trains hierarchical interaction evidence strictly before each evaluated slice.

import { rollingWindows } from './adaptive-evidence-cohorts.js';
import { summarizeMarketCapture } from './adaptive-evidence.js';
import { buildInteractionEvidence, evaluateInteractionEvidence } from './context-interaction-evidence.js';

export const CONTEXT_INTERACTION_WF_VERSION='7.75-CONTEXT-INTERACTION-WF-V1';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function outcomeStats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{n:rs.length,avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,totalR:round(rs.reduce((a,b)=>a+b,0)),winRate:rs.length?round(wins.length/rs.length*100,2):null,pf:gl?round(gp/gl,3):(gp?99:0)};
}

function decisionStats(scored=[]){
  const out={};
  for(const name of ['TRADE','CAUTION','NEUTRAL','SKIP','OBSERVE'])out[name]=outcomeStats(scored.filter(x=>x.evaluation.decision===name));
  return out;
}

export function scoreInteractionOutOfSample({trainRows=[],testRows=[],trainWindowCount=4,interactionOptions}={}){
  if(!testRows.length)return{interactionMap:{},scored:[],marketCapture:summarizeMarketCapture([]),decisions:decisionStats([])};
  const train=[...trainRows].sort((a,b)=>a.ts-b.ts),test=[...testRows].sort((a,b)=>a.ts-b.ts);
  const trainStart=train[0]?.ts,trainEnd=train.at(-1)?.ts,testStart=test[0]?.ts;
  if(trainEnd!=null&&testStart!=null&&trainEnd>=testStart)throw new Error('Interaction walk-forward leakage: training data overlaps evaluation period');
  const windows=train.length>1&&trainStart<trainEnd?rollingWindows({start:trainStart,end:trainEnd,count:Math.max(3,trainWindowCount)}):[];
  const interactionMap=buildInteractionEvidence(train,windows,interactionOptions);
  const scored=test.map(row=>{
    const evaluation=evaluateInteractionEvidence(row.observations,interactionMap,interactionOptions);
    const traded=['TRADE','CAUTION'].includes(evaluation.decision);
    return{...row,evaluation,traded,counterfactualR:Number(row.realizedR||0),realizedR:traded?Number(row.realizedR||0):0};
  });
  return{interactionMap,train:outcomeStats(train),test:outcomeStats(test),decisions:decisionStats(scored),marketCapture:summarizeMarketCapture(scored),scored};
}

export function expandingInteractionWalkForward(rows=[],opts={}){
  const sorted=[...rows].filter(x=>Number.isFinite(Number(x.ts))).sort((a,b)=>a.ts-b.ts);
  const slices=Math.max(3,Number(opts.slices||5));
  if(sorted.length<2)return{version:CONTEXT_INTERACTION_WF_VERSION,researchOnly:true,slices:[],aggregate:{}};
  const start=sorted[0].ts,end=sorted.at(-1).ts,span=(end-start)/slices,results=[];
  for(let i=1;i<slices;i++){
    const testStart=start+i*span+1,testEnd=i===slices-1?end:start+(i+1)*span;
    const trainRows=sorted.filter(r=>r.ts<testStart),testRows=sorted.filter(r=>r.ts>=testStart&&r.ts<=testEnd);
    if(!trainRows.length||!testRows.length)continue;
    const r=scoreInteractionOutOfSample({trainRows,testRows,trainWindowCount:opts.trainWindowCount||4,interactionOptions:opts.interactionOptions});
    results.push({id:`OOS${i}`,trainStart:trainRows[0].ts,trainEnd:trainRows.at(-1).ts,testStart,testEnd,train:r.train,test:r.test,decisions:r.decisions,marketCapture:r.marketCapture,scored:r.scored});
  }
  const scored=results.flatMap(x=>x.scored),selected=scored.filter(x=>x.traded),opportunities=scored.map(x=>({...x,realizedR:x.counterfactualR}));
  return{version:CONTEXT_INTERACTION_WF_VERSION,researchOnly:true,method:'EXPANDING_HIERARCHICAL_RESIDUAL_TRAIN_STRICTLY_BEFORE_TEST',slices:results,aggregate:{opportunities:outcomeStats(opportunities),selected:outcomeStats(selected),decisions:decisionStats(scored),marketCapture:summarizeMarketCapture(scored)}};
}

export const __test={outcomeStats,decisionStats};
