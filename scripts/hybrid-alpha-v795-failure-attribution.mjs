import fs from 'node:fs/promises';

const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const stats=rows=>{
  const wins=rows.filter(x=>x.netR>0),losses=rows.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0));
  const netR=rows.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,maxDd=0;
  for(const x of rows){eq+=x.netR;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq)}
  return {trades:rows.length,netR:round(netR),expectancy:rows.length?round(netR/rows.length):null,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null,maxDrawdownR:round(maxDd)};
};
const signedMacro=r=>(r.side==='LONG'?1:-1)*(Number(r.macroTrend)||0);
const macroBucket=r=>{const x=signedMacro(r);return x>=.20?'ALIGNED':x<=-.20?'OPPOSED':'NEUTRAL'};
const coherenceBucket=r=>{
  const dir=r.side==='LONG'?1:-1;
  const xs=[r.trend15m,r.trend1h,r.trend4h].map(Number).filter(Number.isFinite);
  const agree=xs.filter(x=>dir*x>=.05).length;
  return agree>=3?'3_OF_3':agree===2?'2_OF_3':'LE_1_OF_3';
};
const volBucket=r=>Number(r.volatilityRatio)<.8?'LOW':Number(r.volatilityRatio)>1.25?'HIGH':'NORMAL';
const liqBucket=r=>Number(r.liquidityQuality)<.5?'LOW':'OK';
const reversalBucket=r=>Number(r.reversalRisk)>=.5?'HIGH':'NORMAL';
const alphaBucket=r=>{const x=Math.abs(Number(r.alpha)||0);return x<=.35?'WEAK':x<=.55?'MEDIUM':'STRONG'};
const dimensions={SIDE:r=>r.side,REGIME:r=>r.regime,MACRO_ALIGNMENT:macroBucket,TREND_COHERENCE:coherenceBucket,VOLATILITY:volBucket,LIQUIDITY:liqBucket,REVERSAL_RISK:reversalBucket,ALPHA_STRENGTH:alphaBucket};
const group=(rows,fn)=>{
  const b={};for(const r of rows){const k=String(fn(r)||'UNKNOWN');(b[k]||(b[k]=[])).push(r)}
  return Object.fromEntries(Object.entries(b).map(([k,v])=>[k,stats(v)]));
};
const cross=(rows,aName,aFn,bName,bFn)=>{
  const b={};for(const r of rows){const k=`${aName}:${aFn(r)}|${bName}:${bFn(r)}`;(b[k]||(b[k]=[])).push(r)}
  return Object.fromEntries(Object.entries(b).map(([k,v])=>[k,stats(v)]));
};

const raw=JSON.parse(await fs.readFile('artifacts/hybrid-alpha-v790-evidence.json','utf8'));
const node=raw?.horizons?.h24?.['90d']?.v793;
if(!node?.result?.rows?.length)throw new Error('v7.93 24h/90d rows missing');
const full=node.result.rows;
const folds=(node.walkForward||[]).map(x=>({fold:x.fold,start:x.start,end:x.end,rows:x.result?.rows||[]}));
const attribution={schemaVersion:'7.95-HYBRID-FAILURE-ATTRIBUTION-V1',researchOnly:true,executionImpact:false,sourceEvidenceSchema:raw.schemaVersion,cutoff:raw.cutoff,universe:raw.symbols,primaryHorizon:'24h',window:'90d',predeclared:true,dimensions:{},crosses:{},folds:[],candidateFailureStates:[],notes:['Bucket boundaries are frozen in research/hybrid-alpha-v795-failure-attribution-design.md before this output.','Attribution changes no trading decision.','Candidate state requires failing-fold n>=12 and negative expectancy plus negative/degraded evidence outside that fold.']};
for(const [name,fn] of Object.entries(dimensions))attribution.dimensions[name]=group(full,fn);
for(const [a,b] of [['SIDE','REGIME'],['SIDE','MACRO_ALIGNMENT'],['SIDE','TREND_COHERENCE'],['REGIME','MACRO_ALIGNMENT'],['REGIME','TREND_COHERENCE'],['MACRO_ALIGNMENT','TREND_COHERENCE']])attribution.crosses[`${a}_X_${b}`]=cross(full,a,dimensions[a],b,dimensions[b]);
for(const f of folds){const item={fold:f.fold,start:f.start,end:f.end,summary:stats(f.rows),dimensions:{},crosses:{}};for(const [name,fn] of Object.entries(dimensions))item.dimensions[name]=group(f.rows,fn);for(const [a,b] of [['SIDE','REGIME'],['SIDE','MACRO_ALIGNMENT'],['SIDE','TREND_COHERENCE'],['REGIME','MACRO_ALIGNMENT'],['REGIME','TREND_COHERENCE'],['MACRO_ALIGNMENT','TREND_COHERENCE']])item.crosses[`${a}_X_${b}`]=cross(f.rows,a,dimensions[a],b,dimensions[b]);attribution.folds.push(item)}
const failing=attribution.folds.find(x=>x.fold===2)||attribution.folds.slice().sort((a,b)=>(a.summary.expectancy??0)-(b.summary.expectancy??0))[0];
for(const [dim,buckets] of Object.entries(failing.dimensions))for(const [bucket,s] of Object.entries(buckets)){
  if(s.trades<12||!(s.expectancy<0))continue;
  const fullS=attribution.dimensions[dim]?.[bucket];
  const other=attribution.folds.filter(x=>x.fold!==failing.fold).map(x=>x.dimensions[dim]?.[bucket]).filter(Boolean);
  const repeats=other.filter(x=>x.trades>=8&&x.expectancy<0).length;
  const degraded=fullS&&fullS.expectancy<0;
  if(repeats||degraded)attribution.candidateFailureStates.push({type:'DIMENSION',dimension:dim,bucket,failingFold:s,full90d:fullS,negativeOtherFolds:repeats});
}
for(const [crossName,buckets] of Object.entries(failing.crosses))for(const [bucket,s] of Object.entries(buckets)){
  if(s.trades<12||!(s.expectancy<0))continue;
  const fullS=attribution.crosses[crossName]?.[bucket];
  const other=attribution.folds.filter(x=>x.fold!==failing.fold).map(x=>x.crosses[crossName]?.[bucket]).filter(Boolean);
  const repeats=other.filter(x=>x.trades>=8&&x.expectancy<0).length;
  const degraded=fullS&&fullS.expectancy<0;
  if(repeats||degraded)attribution.candidateFailureStates.push({type:'CROSS',dimension:crossName,bucket,failingFold:s,full90d:fullS,negativeOtherFolds:repeats});
}
attribution.candidateFailureStates.sort((a,b)=>(a.failingFold.expectancy??0)-(b.failingFold.expectancy??0));
await fs.writeFile('artifacts/hybrid-alpha-v795-failure-attribution.json',JSON.stringify(attribution,null,2));
console.log(JSON.stringify({failingFold:failing.summary,candidates:attribution.candidateFailureStates.slice(0,15)},null,2));
