// MERIDIAN v7.61 — Raw Feature Edge Map / Feature Attribution Lab
// Research-only pure analytics. No entry, sizing, risk, exit or Paper execution effects.
const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);

const DEFAULT_BINS=Object.freeze({
  adx:[18,25,35],
  rsi:[30,42,50,58,70],
  volumeRatio:[.65,1,1.15,1.5],
  emaDistanceAtr:[.25,.5,.75,1,1.5]
});

function labelNumeric(value,cuts){
  if(!finite(value))return'UNKNOWN';
  const x=n(value);
  if(x<cuts[0])return`<${cuts[0]}`;
  for(let i=1;i<cuts.length;i++)if(x<cuts[i])return`${cuts[i-1]}-${cuts[i]}`;
  return`>=${cuts[cuts.length-1]}`;
}
function signForSide(v,side){if(!finite(v))return null;return side==='SHORT'?-n(v):n(v)}
function frame(row,tf){return row?.frames?.[tf]||row?.features?.frames?.[tf]||{};}
function outcome(row){return finite(row?.outcomeR)?n(row.outcomeR):finite(row?.normalizedR)?n(row.normalizedR):null;}
function sideAlignedEma(f,side){
  if(!finite(f?.ema20)||!finite(f?.ema50))return'UNKNOWN';
  return side==='SHORT'?(n(f.ema20)<n(f.ema50)?'ALIGNED':'OPPOSED'):(n(f.ema20)>n(f.ema50)?'ALIGNED':'OPPOSED');
}
function priceVsEma20(f,side){
  if(!finite(f?.price)||!finite(f?.ema20))return'UNKNOWN';
  return side==='SHORT'?(n(f.price)<n(f.ema20)?'ALIGNED':'OPPOSED'):(n(f.price)>n(f.ema20)?'ALIGNED':'OPPOSED');
}
function macdAgreement(f,side){
  const h=f?.macdHist??f?.macd?.hist;
  if(!finite(h))return'UNKNOWN';
  return signForSide(h,side)>0?'ALIGNED':'OPPOSED';
}
function directionalFrameAligned(f,side){
  const ema=sideAlignedEma(f,side)==='ALIGNED';
  const px=priceVsEma20(f,side)==='ALIGNED';
  const macd=macdAgreement(f,side)==='ALIGNED';
  return ema&&px&&macd;
}

export function extractRawFeatures(row={},bins=DEFAULT_BINS){
  const side=String(row.side||'UNKNOWN').toUpperCase();
  const f15=frame(row,'15m'),f1=frame(row,'1h'),f4=frame(row,'4h');
  const aligned=['15m','1h','4h'].filter(tf=>directionalFrameAligned(frame(row,tf),side));
  const atr15=n(f15?.atr);
  const emaDist=finite(f15?.price)&&finite(f15?.ema20)&&finite(atr15)&&atr15>0?Math.abs(n(f15.price)-n(f15.ema20))/atr15:null;
  const macdAligned=['15m','1h','4h'].filter(tf=>macdAgreement(frame(row,tf),side)==='ALIGNED').length;
  return {
    side,
    regime:String(row.regime||row?.features?.regime||'UNKNOWN').toUpperCase(),
    baselineStatus:String(row.baselineStatus||row.status||row?.features?.baselineStatus||'UNKNOWN').toUpperCase(),
    mtfAlignment:`${aligned.length}/3`,
    macdAgreement:`${macdAligned}/3`,
    adx15:labelNumeric(f15?.adx,bins.adx),adx1h:labelNumeric(f1?.adx,bins.adx),adx4h:labelNumeric(f4?.adx,bins.adx),
    rsi15:labelNumeric(f15?.rsi,bins.rsi),rsi1h:labelNumeric(f1?.rsi,bins.rsi),rsi4h:labelNumeric(f4?.rsi,bins.rsi),
    volume15:labelNumeric(f15?.volumeRatio,bins.volumeRatio),volume1h:labelNumeric(f1?.volumeRatio,bins.volumeRatio),
    emaStructure15:sideAlignedEma(f15,side),emaStructure1h:sideAlignedEma(f1,side),emaStructure4h:sideAlignedEma(f4,side),
    priceVsEma20_15:priceVsEma20(f15,side),priceVsEma20_1h:priceVsEma20(f1,side),priceVsEma20_4h:priceVsEma20(f4,side),
    emaDistanceAtr15:labelNumeric(emaDist,bins.emaDistanceAtr),
    sideRegime:`${side}×${String(row.regime||row?.features?.regime||'UNKNOWN').toUpperCase()}`
  };
}

function summarize(rows){
  const rs=rows.map(outcome).filter(Number.isFinite);
  const wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0),gp=wins.reduce((a,b)=>a+b,0),gl=Math.abs(losses.reduce((a,b)=>a+b,0));
  return {samples:rs.length,totalR:round(rs.reduce((a,b)=>a+b,0)),avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,winRate:rs.length?round(wins.length/rs.length*100,1):null,pf:gl>0?round(gp/gl):(gp>0?99:0)};
}

export function featureEdgeMap(rows=[],options={}){
  const bins={...DEFAULT_BINS,...(options.bins||{})};
  const minSamples=Math.max(1,Number(options.minSamples)||30);
  const clean=rows.filter(r=>outcome(r)!=null).map(r=>({...r,__raw:extractRawFeatures(r,bins)}));
  const keys=options.features||Object.keys(clean[0]?.__raw||{});
  const features={};
  for(const key of keys){
    const groups=new Map();
    for(const r of clean){const k=String(r.__raw[key]??'UNKNOWN');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
    const buckets=[...groups.entries()].map(([bucket,x])=>({bucket,...summarize(x),adequate:x.length>=minSamples})).sort((a,b)=>b.samples-a.samples);
    const adequate=buckets.filter(x=>x.adequate&&x.avgR!=null);
    features[key]={buckets,adequateBuckets:adequate.length,positiveBuckets:adequate.filter(x=>x.avgR>0).length,negativeBuckets:adequate.filter(x=>x.avgR<0).length};
  }
  return {schemaVersion:'7.61-FEATURE-ATTRIBUTION-V1',researchOnly:true,executionImpact:false,samples:clean.length,minSamples,overall:summarize(clean),features};
}

export function crossWindowFeatureStability(windowMaps={}){
  const windows=Object.keys(windowMaps);
  const keys=[...new Set(windows.flatMap(w=>Object.keys(windowMaps[w]?.features||{})))];
  const out={};
  for(const key of keys){
    const bucketNames=[...new Set(windows.flatMap(w=>(windowMaps[w]?.features?.[key]?.buckets||[]).map(x=>x.bucket)))];
    out[key]=bucketNames.map(bucket=>{
      const observations=windows.map(window=>{const x=(windowMaps[window]?.features?.[key]?.buckets||[]).find(b=>b.bucket===bucket);return x&&x.adequate?{window,avgR:x.avgR,samples:x.samples,pf:x.pf}:null;}).filter(Boolean);
      const signs=observations.map(x=>Math.sign(x.avgR));
      const consistent=signs.length>=2&&signs.every(s=>s===signs[0]&&s!==0);
      return {bucket,windows:observations.length,consistentDirection:consistent,direction:consistent?(signs[0]>0?'POSITIVE':'NEGATIVE'):'MIXED',observations};
    }).sort((a,b)=>b.windows-a.windows||Number(b.consistentDirection)-Number(a.consistentDirection));
  }
  return {schemaVersion:'7.61-FEATURE-STABILITY-V1',researchOnly:true,windows,features:out};
}

export const FEATURE_ATTRIBUTION_CONFIG=Object.freeze({bins:DEFAULT_BINS,minSamples:30});
