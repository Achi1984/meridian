import fs from 'node:fs/promises';

const INPUT='artifacts/hybrid-alpha-v796-evidence.json';
const OUTPUT='artifacts/hybrid-alpha-v797-evidence.json';
const FACTOR=0.60;
const THRESHOLD=0.50;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;

function stats(rows=[]){
  const wins=rows.filter(x=>x.netR>0),losses=rows.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0));
  const pnl=rows.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,maxDd=0;
  for(const x of rows){eq+=x.netR;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq)}
  return {trades:rows.length,netR:round(pnl),expectancy:rows.length?round(pnl/rows.length):null,profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null,maxDrawdownR:round(maxDd)};
}
function group(rows,key){
  const m={};for(const r of rows){const k=String(r[key]??'UNKNOWN');(m[k]||(m[k]=[])).push(r)}
  return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]));
}
function attenuate(row){
  const q=Number(row?.liquidityQuality);
  const applies=Number.isFinite(q)&&q<THRESHOLD;
  const f=applies?FACTOR:1;
  return {...row,riskMultiplier:round(Number(row.riskMultiplier)*f),grossR:round(Number(row.grossR)*f),costR:round(Number(row.costR)*f),netR:round(Number(row.netR)*f),lowLiquidityRiskFactor:f,liquidityBand:applies?'LOW':'OK'};
}
function transformResult(result){
  const rows=(result?.rows||[]).map(attenuate);
  return {...result,schemaVersion:'7.97-HYBRID-LOW-LIQUIDITY-EVIDENCE-V1',summary:stats(rows),bySide:group(rows,'side'),byRegime:group(rows,'regime'),bySymbol:group(rows,'symbol'),rows};
}
function transformFold(f){return {...f,result:transformResult(f.result)}}

const base=JSON.parse(await fs.readFile(INPUT,'utf8'));
const out={schemaVersion:'7.97-HYBRID-LOW-LIQUIDITY-EVIDENCE-V1',generatedAt:new Date().toISOString(),cutoff:base.cutoff,researchOnly:true,executionImpact:false,source:base.source,symbols:base.symbols,windows:base.windows,predeclared:{lowLiquidityThreshold:THRESHOLD,factor:FACTOR,tradeBlocking:false},horizons:{},notes:['Derived exactly from frozen v7.96 rows: v7.97 adds only research-risk attenuation when decision-time liquidityQuality <0.50.','Side selection and trade count are unchanged.','Existing 0.60 factor reused; no factor or threshold tuning.']};
for(const [h,windows] of Object.entries(base.horizons||{})){
  out.horizons[h]={};
  for(const [w,block] of Object.entries(windows||{})){
    const v793=block?.v793;
    const v796=block?.v796;
    if(!v796?.result)continue;
    out.horizons[h][w]={v793,v796:{summary:v796.result.summary,bySide:v796.result.bySide,byRegime:v796.result.byRegime,bySymbol:v796.result.bySymbol,walkForward:(v796.walkForward||[]).map(f=>({fold:f.fold,start:f.start,end:f.end,summary:f.result?.summary}))},v797:{result:transformResult(v796.result),walkForward:(v796.walkForward||[]).map(transformFold)}};
  }
}
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile(OUTPUT,JSON.stringify(out,null,2));
const compact={};for(const [h,ws] of Object.entries(out.horizons)){compact[h]={};for(const [w,b] of Object.entries(ws))compact[h][w]={v793:b.v793.summary,v796:b.v796.summary,v797:b.v797.result.summary,folds:b.v797.walkForward.map(f=>f.result.summary)}}
console.log(JSON.stringify(compact,null,2));
