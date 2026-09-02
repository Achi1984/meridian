// MERIDIAN v7.64 — walk-forward validation for feature interactions.
// Research-only. Selects interaction buckets on past data and evaluates them on unseen future data.
import { interactionEdgeMap, DEFAULT_INTERACTIONS } from './feature-interactions.js';
const DAY=86400000;
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const ts=r=>Date.parse(r?.sampledAt||r?.timestamp||r?.ts||'');
const outcome=r=>Number.isFinite(Number(r?.outcomeR))?Number(r.outcomeR):Number.isFinite(Number(r?.normalizedR))?Number(r.normalizedR):null;

function summarize(rs=[]){const v=rs.map(outcome).filter(Number.isFinite),wins=v.filter(x=>x>0),losses=v.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));return{samples:v.length,totalR:round(v.reduce((a,b)=>a+b,0)),avgR:v.length?round(v.reduce((a,b)=>a+b,0)/v.length):null,winRate:v.length?round(wins.length/v.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)}}
function bucketRows(rows,spec,bucket){const parts=bucket.split(' × ');return rows.filter(r=>{const raw=r.__raw;return spec.every((k,i)=>String(raw[k]??'UNKNOWN')===parts[i])})}

export function walkForwardInteractions(rows=[],options={}){
  const clean=rows.filter(r=>Number.isFinite(ts(r))&&outcome(r)!=null).sort((a,b)=>ts(a)-ts(b));
  if(!clean.length)return{schemaVersion:'7.64-WALK-FORWARD-V1',researchOnly:true,executionImpact:false,folds:[],summary:{}};
  const minTrainSamples=Math.max(20,Number(options.minTrainSamples)||50),minTestSamples=Math.max(10,Number(options.minTestSamples)||15);
  const minTrainAvgR=Number.isFinite(Number(options.minTrainAvgR))?Number(options.minTrainAvgR):0.03;
  const trainDays=Math.max(30,Number(options.trainDays)||45),testDays=Math.max(7,Number(options.testDays)||15),stepDays=Math.max(7,Number(options.stepDays)||15);
  const interactions=options.interactions||DEFAULT_INTERACTIONS;
  const start=ts(clean[0]),end=ts(clean[clean.length-1]);const folds=[];
  for(let testStart=start+trainDays*DAY;testStart+testDays*DAY<=end+DAY;testStart+=stepDays*DAY){
    const trainStart=testStart-trainDays*DAY,testEnd=testStart-1,testEndTs=testStart-1,testStop=testStart+testDays*DAY-1;
    const train=clean.filter(r=>ts(r)>=trainStart&&ts(r)<=testEndTs),test=clean.filter(r=>ts(r)>=testStart&&ts(r)<=testStop);
    const trainMap=interactionEdgeMap(train,{minSamples:minTrainSamples,interactions});
    // Re-extract raw once through the same interaction mapper's feature semantics.
    const selected=[];
    for(const [name,x] of Object.entries(trainMap.interactions||{}))for(const b of x.buckets||[])if(b.adequate&&b.avgR>=minTrainAvgR&&b.pf>1){selected.push({interaction:name,fields:x.fields,bucket:b.bucket,train:{samples:b.samples,avgR:b.avgR,pf:b.pf,winRate:b.winRate}})}
    const testMap=interactionEdgeMap(test,{minSamples:minTestSamples,interactions});
    for(const s of selected){const b=(testMap.interactions?.[s.interaction]?.buckets||[]).find(x=>x.bucket===s.bucket);s.test=b?{samples:b.samples,avgR:b.avgR,pf:b.pf,winRate:b.winRate,adequate:b.adequate}:{samples:0,avgR:null,pf:null,winRate:null,adequate:false};s.holdoutPositive=Boolean(b?.adequate&&b.avgR>0&&b.pf>1)}
    const adequate=selected.filter(s=>s.test.adequate),positive=adequate.filter(s=>s.holdoutPositive);
    folds.push({trainStart:new Date(trainStart).toISOString(),trainEnd:new Date(testEndTs).toISOString(),testStart:new Date(testStart).toISOString(),testEnd:new Date(testStop).toISOString(),trainSamples:train.length,testSamples:test.length,selected:selected.length,adequateHoldout:adequate.length,positiveHoldout:positive.length,positiveRetentionPct:adequate.length?round(positive.length/adequate.length*100,1):null,selections:selected});
  }
  const all=folds.flatMap(f=>f.selections.map(s=>({...s,foldTestStart:f.testStart}))),adequate=all.filter(x=>x.test.adequate),positive=adequate.filter(x=>x.holdoutPositive);
  const byKey={};for(const x of adequate){const key=`${x.interaction}: ${x.bucket}`,z=byKey[key]||(byKey[key]={interaction:x.interaction,bucket:x.bucket,folds:0,positiveFolds:0,testSamples:0,testTotalR:0});z.folds++;z.positiveFolds+=x.holdoutPositive?1:0;z.testSamples+=x.test.samples;z.testTotalR+=Number(x.test.avgR||0)*x.test.samples}
  const repeated=Object.values(byKey).map(x=>({...x,positiveFoldPct:round(x.positiveFolds/x.folds*100,1),weightedTestAvgR:x.testSamples?round(x.testTotalR/x.testSamples):null})).sort((a,b)=>b.positiveFolds-a.positiveFolds||b.testSamples-a.testSamples);
  return{schemaVersion:'7.64-WALK-FORWARD-V1',researchOnly:true,executionImpact:false,config:{trainDays,testDays,stepDays,minTrainSamples,minTestSamples,minTrainAvgR},range:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),samples:clean.length},folds,summary:{folds:folds.length,selections:all.length,adequateHoldout:adequate.length,positiveHoldout:positive.length,positiveRetentionPct:adequate.length?round(positive.length/adequate.length*100,1):null,repeated}};
}
