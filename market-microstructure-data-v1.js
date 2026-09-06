import crypto from 'node:crypto';

export const MICROSTRUCTURE_V1=Object.freeze({
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  fundingDays:90,
  flowDays:30,
  flowCadenceMs:3600000,
  fundingMinCoverage:.90,
  flowMinCoverage:.95
});

export const sha256=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function median(values=[]){const xs=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;const m=Math.floor(xs.length/2);return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2}

export function auditSeries(rows,{requestedStart,cutoff,cadenceMs,minCoverage,maxGapMultiplier=2}){
  const valid=rows.filter(x=>Number.isFinite(x.eventTime)&&x.validNumeric),invalidRows=rows.length-valid.length,sorted=[...valid].sort((a,b)=>a.eventTime-b.eventTime),unique=[],seen=new Set();let duplicates=0;
  for(const x of sorted){if(seen.has(x.eventTime)){duplicates++;continue}seen.add(x.eventTime);unique.push(x)}
  const gaps=[];for(let i=1;i<unique.length;i++)gaps.push(unique[i].eventTime-unique[i-1].eventTime);
  const observedCadence=median(gaps),cadence=cadenceMs||observedCadence,expected=cadence?Math.max(0,Math.floor((cutoff-requestedStart)/cadence)+1):0,coverage=expected?unique.length/expected:0,maxGap=gaps.length?Math.max(...gaps):null,latest=unique.at(-1)?.eventTime??null;
  const gate={coverage:coverage>=minCoverage,noDuplicates:duplicates===0,noInvalid:invalidRows===0,monotonic:unique.every((x,i)=>!i||x.eventTime>unique[i-1].eventTime),maxGap:maxGap==null||maxGap<=maxGapMultiplier*cadence,fresh:latest!=null&&cutoff-latest<=maxGapMultiplier*cadence};
  return {requestedStart,cutoff,returnedStart:unique[0]?.eventTime??null,returnedEnd:latest,rows:rows.length,uniqueRows:unique.length,duplicates,invalidRows,expectedRows:expected,coverageRatio:Number(coverage.toFixed(4)),observedMedianCadenceMs:observedCadence,maxGapMs:maxGap,freshnessMs:latest==null?null:cutoff-latest,normalizedSha256:sha256(unique),gate,passed:Object.values(gate).every(Boolean),series:unique};
}

export function foundationDecision(features={}){
  const ready=Object.fromEntries(Object.entries(features).map(([k,v])=>[k,MICROSTRUCTURE_V1.symbols.every(s=>v?.[s]?.passed===true)]));
  return {featureReady:ready,allFeaturesReady:['funding','openInterest','takerFlow'].every(k=>ready[k]===true),fundingOnlyReady:ready.funding===true&&(!ready.openInterest||!ready.takerFlow),alphaEvidence:false,experimentPermitted:false,promotionPermitted:false};
}
