// MERIDIAN v7.76 — Context Reliability Map
// Research-only. Measures Side × Regime × context reliability without changing entries, sizing, risk or exits.
import { extractRawFeatures } from './feature-attribution.js';
import { scoreChallengerV32 } from './challenger-v32.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const finite=v=>Number.isFinite(Number(v));
const outcome=r=>finite(r?.outcomeR)?Number(r.outcomeR):finite(r?.normalizedR)?Number(r.normalizedR):null;
const frame=(r,tf)=>r?.frames?.[tf]||r?.features?.frames?.[tf]||{};

function evidenceBand(score){
  const x=Number(score)||0;
  if(x>=4)return'HIGH';
  if(x>=2)return'MEDIUM';
  if(x>0)return'LOW';
  return'ZERO';
}
function volumeBand(raw){return ['1.15-1.5','>=1.5'].includes(raw.volume15)?'HIGH':raw.volume15==='<0.65'?'LOW':'NORMAL'}
function volatilityBand(row){
  const f=frame(row,'15m'),atr=Number(f?.atr),price=Number(f?.price);
  if(!(atr>0&&price>0))return'UNKNOWN';
  const p=atr/price*100;
  return p<0.5?'LOW':p<1?'MID':p<2?'HIGH':'EXTREME';
}
function momentumBand(row,side){
  const rsi=Number(frame(row,'15m')?.rsi);
  if(!finite(rsi))return'UNKNOWN';
  if(side==='LONG')return rsi>=52&&rsi<=70?'SUPPORTIVE':rsi>70?'STRETCHED':rsi<42?'OPPOSED':'NEUTRAL';
  return rsi<=48&&rsi>=30?'SUPPORTIVE':rsi<30?'STRETCHED':rsi>58?'OPPOSED':'NEUTRAL';
}
function summarize(rows=[]){
  const rs=rows.map(outcome).filter(finite),wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const gp=wins.reduce((s,x)=>s+x,0),gl=Math.abs(losses.reduce((s,x)=>s+x,0)),total=rs.reduce((s,x)=>s+x,0);
  return {samples:rs.length,totalR:round(total),avgR:rs.length?round(total/rs.length):null,pf:gl>0?round(gp/gl):(gp>0?99:0),winRate:rs.length?round(wins.length/rs.length*100,1):null,winners:wins.length,losers:losses.length,positiveR:round(gp),negativeR:round(gl)};
}
function rate(n,d){return d>0?round(n/d*100,1):0}

export function contextDescriptor(row={}){
  const raw=extractRawFeatures(row),side=String(raw.side||'UNKNOWN'),regime=String(raw.regime||'UNKNOWN');
  const score=scoreChallengerV32(row).evidenceScore;
  return {
    side,regime,sideRegime:`${side}×${regime}`,
    evidence:`EVIDENCE_${evidenceBand(score)}`,
    mtf:`MTF_${raw.mtfAlignment}`,
    volume:`VOLUME_${volumeBand(raw)}`,
    momentum:`MOMENTUM_${momentumBand(row,side)}`,
    volatility:`VOLATILITY_${volatilityBand(row)}`,
  };
}

export function buildContextReliabilityMap(rows=[],options={}){
  const minSamples=Math.max(5,Number(options.minSamples)||20);
  const clean=rows.filter(r=>outcome(r)!=null);
  const parents=new Map(),cells=new Map();
  for(const row of clean){
    const d=contextDescriptor(row),parent=d.sideRegime;
    if(!parents.has(parent))parents.set(parent,[]);parents.get(parent).push(row);
    for(const dim of ['evidence','mtf','volume','momentum','volatility']){
      const key=`${parent}|${d[dim]}`;
      if(!cells.has(key))cells.set(key,{key,parent,dimension:dim,bucket:d[dim],rows:[]});
      cells.get(key).rows.push(row);
    }
  }
  const out=[];
  for(const c of cells.values()){
    const parentRows=parents.get(c.parent)||[],s=summarize(c.rows),p=summarize(parentRows);
    const winnerCaptureRate=rate(s.winners,p.winners),lossExposureRate=rate(s.losers,p.losers);
    out.push({key:c.key,parent:c.parent,dimension:c.dimension,bucket:c.bucket,...s,adequate:s.samples>=minSamples,parentSamples:p.samples,parentAvgR:p.avgR,parentPf:p.pf,winnerCaptureRate,lossExposureRate,captureEfficiency:round(winnerCaptureRate-lossExposureRate,1)});
  }
  out.sort((a,b)=>a.parent.localeCompare(b.parent)||a.dimension.localeCompare(b.dimension)||b.samples-a.samples);
  return {schemaVersion:'7.76-CONTEXT-RELIABILITY-MAP-V1',researchOnly:true,executionImpact:false,minSamples,samples:clean.length,parents:Object.fromEntries([...parents].map(([k,v])=>[k,summarize(v)])),cells:out};
}

export function crossWindowContextReliability(windowMaps={},options={}){
  const windows=Object.keys(windowMaps).sort();
  const minWindows=Math.max(2,Number(options.minWindows)||3);
  const keys=[...new Set(windows.flatMap(w=>(windowMaps[w]?.cells||[]).map(c=>c.key)))];
  const cells=keys.map(key=>{
    const observations=windows.map(window=>{
      const c=(windowMaps[window]?.cells||[]).find(x=>x.key===key);
      return c&&c.adequate?{window,samples:c.samples,avgR:c.avgR,pf:c.pf,winRate:c.winRate,captureEfficiency:c.captureEfficiency,winnerCaptureRate:c.winnerCaptureRate,lossExposureRate:c.lossExposureRate}:null;
    }).filter(Boolean);
    const positive=observations.filter(x=>x.avgR>0&&x.pf>1).length;
    const negative=observations.filter(x=>x.avgR<0||x.pf<1).length;
    const avgR=observations.length?round(observations.reduce((s,x)=>s+x.avgR,0)/observations.length):null;
    const pf=observations.length?round(observations.reduce((s,x)=>s+x.pf,0)/observations.length):null;
    const captureEfficiency=observations.length?round(observations.reduce((s,x)=>s+x.captureEfficiency,0)/observations.length,1):null;
    const robust=observations.length>=minWindows&&positive>=minWindows&&negative===0&&avgR>0&&pf>1;
    const [parent='',bucket='']=key.split('|');
    return {key,parent,bucket,windows:observations.length,positiveWindows:positive,negativeWindows:negative,avgAvgR:avgR,avgPf:pf,avgCaptureEfficiency:captureEfficiency,robust,observations};
  }).sort((a,b)=>Number(b.robust)-Number(a.robust)||b.positiveWindows-a.positiveWindows||(b.avgAvgR??-99)-(a.avgAvgR??-99));
  return {schemaVersion:'7.76-CONTEXT-RELIABILITY-CROSSWINDOW-V1',researchOnly:true,executionImpact:false,windows,minWindows,cells,robustCells:cells.filter(x=>x.robust),promotionAllowed:false,nextStep:cells.some(x=>x.robust)?'BUILD_V33_RISK_ALLOCATION_SHADOW':'KEEP_V32_NO_CONTEXT_SIZING'};
}
