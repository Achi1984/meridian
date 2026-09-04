// ACHI MERIDIAN Adaptive Evidence Walk-Forward Lab — v7.74
// Research-only. Out-of-sample validation; training evidence always predates the evaluated slice.

import { buildEvidenceMap, rollingWindows } from './adaptive-evidence-cohorts.js';
import { evaluateAdaptiveObservations, summarizeMarketCapture } from './adaptive-evidence.js';

export const ADAPTIVE_WALKFORWARD_VERSION='7.74-ADAPTIVE-WALKFORWARD-V1';
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function outcomeStats(rows=[]){
  const rs=rows.map(x=>Number(x.realizedR||0)),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return{
    n:rs.length,
    avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,
    totalR:round(rs.reduce((a,b)=>a+b,0)),
    winRate:rs.length?round(wins.length/rs.length*100,2):null,
    pf:gl>0?round(gp/gl,3):(gp>0?99:0)
  };
}

function decisionStats(scored=[]){
  const names=['TRADE','CAUTION','NEUTRAL','SKIP','OBSERVE'],out={};
  for(const name of names){
    const rows=scored.filter(x=>x.evaluation.decision===name);
    out[name]=outcomeStats(rows);
  }
  return out;
}

export function scoreOutOfSample({trainRows=[],testRows=[],trainWindowCount=4,evidenceOptions}={}){
  if(!testRows.length)return{evidenceMap:{},scored:[],marketCapture:summarizeMarketCapture([]),decisions:decisionStats([])};
  const sortedTrain=[...trainRows].sort((a,b)=>a.ts-b.ts);
  const trainStart=sortedTrain[0]?.ts,testStart=Math.min(...testRows.map(x=>x.ts));
  const trainEnd=sortedTrain.at(-1)?.ts;
  if(trainEnd!=null&&trainEnd>=testStart)throw new Error('Walk-forward leakage: training data overlaps evaluation period');
  const windows=sortedTrain.length&&trainStart<trainEnd?rollingWindows({start:trainStart,end:trainEnd,count:Math.max(2,trainWindowCount)}):[];
  const evidenceMap=buildEvidenceMap(sortedTrain,windows);
  const scored=testRows.map(row=>{
    const evaluation=evaluateAdaptiveObservations(row.observations,evidenceMap,evidenceOptions);
    const traded=['TRADE','CAUTION'].includes(evaluation.decision);
    return{...row,evaluation,traded,counterfactualR:Number(row.realizedR||0),realizedR:traded?Number(row.realizedR||0):0};
  });
  return{
    evidenceMap,
    train:outcomeStats(sortedTrain),
    test:outcomeStats(testRows),
    decisions:decisionStats(scored),
    marketCapture:summarizeMarketCapture(scored),
    scored
  };
}

export function expandingWalkForward(rows=[],opts={}){
  const sorted=[...rows].filter(x=>Number.isFinite(Number(x.ts))).sort((a,b)=>a.ts-b.ts);
  const slices=Math.max(3,Number(opts.slices||5));
  if(sorted.length<2)return{version:ADAPTIVE_WALKFORWARD_VERSION,researchOnly:true,slices:[],aggregate:{}};
  const start=sorted[0].ts,end=sorted.at(-1).ts,span=(end-start)/slices,results=[];
  for(let i=1;i<slices;i++){
    const testStart=start+i*span+(i===0?0:1),testEnd=i===slices-1?end:start+(i+1)*span;
    const trainRows=sorted.filter(r=>r.ts<testStart);
    const testRows=sorted.filter(r=>r.ts>=testStart&&r.ts<=testEnd);
    if(!trainRows.length||!testRows.length)continue;
    const r=scoreOutOfSample({trainRows,testRows,trainWindowCount:opts.trainWindowCount||4,evidenceOptions:opts.evidenceOptions});
    results.push({id:`OOS${i}`,trainStart:trainRows[0].ts,trainEnd:trainRows.at(-1).ts,testStart,testEnd,train:r.train,test:r.test,decisions:r.decisions,marketCapture:r.marketCapture,scored:r.scored});
  }
  const scored=results.flatMap(x=>x.scored);
  const tradeRows=scored.filter(x=>x.traded);
  const allCounterfactual=scored.map(x=>({...x,realizedR:x.counterfactualR}));
  return{
    version:ADAPTIVE_WALKFORWARD_VERSION,
    researchOnly:true,
    method:'EXPANDING_TRAIN_STRICTLY_BEFORE_TEST',
    slices:results,
    aggregate:{
      opportunities:outcomeStats(allCounterfactual),
      selected:outcomeStats(tradeRows),
      decisions:decisionStats(scored),
      marketCapture:summarizeMarketCapture(scored)
    }
  };
}
