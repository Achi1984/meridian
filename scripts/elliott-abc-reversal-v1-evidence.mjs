import fs from 'node:fs/promises';
import {ELLIOTT_ABC_REVERSAL_V1 as C,runElliottAbcReversalV1} from '../elliott-abc-reversal-v1.js';

const BASE='https://www.okx.com',H4=4*3600000,DAY=86400000;
const PRIMARY_START=Date.parse(C.primaryStart),PRIMARY_END=Date.parse(C.primaryEnd),SECONDARY_START=Date.parse(C.secondaryStart),SECONDARY_END=Date.parse(C.secondaryEnd);
const FETCH_START=Math.floor((PRIMARY_START-C.warmupDays*DAY)/H4)*H4;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const instId=s=>`${s.replace(/USDT$/,'')}-USDT`;

async function getJson(url,attempt=0){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-ELLIOTT-ABC-V1/1.0','accept':'application/json'}});
  if(r.ok){const j=await r.json();if(String(j?.code||'0')==='0')return j;throw new Error(`OKX code ${j?.code}: ${j?.msg||'unknown'}`);}
  if((r.status===429||r.status>=500)&&attempt<6){await sleep(500*2**attempt);return getJson(url,attempt+1);}
  throw new Error(`${r.status} ${url}`);
}
async function candles(symbol){
  let cursor=SECONDARY_END,out=[],calls=0;
  while(cursor>FETCH_START){
    const url=`${BASE}/api/v5/market/history-candles?instId=${instId(symbol)}&bar=4H&after=${cursor}&limit=100`;
    const j=await getJson(url),rows=Array.isArray(j?.data)?j.data:[];calls++;
    if(!rows.length)break;
    let oldest=Infinity;
    for(const k of rows){
      const t=Number(k[0]);if(Number.isFinite(t))oldest=Math.min(oldest,t);
      if(String(k[8]??'1')==='1'&&t>=FETCH_START&&t<SECONDARY_END){
        const o=Number(k[1]),h=Number(k[2]),l=Number(k[3]),c=Number(k[4]);
        if([o,h,l,c].every(Number.isFinite)&&o>0&&c>0)out.push({t,o,h,l,c});
      }
    }
    if(!Number.isFinite(oldest)||oldest>=cursor)throw new Error(`${symbol} non-advancing OKX cursor`);
    cursor=oldest;await sleep(100);
  }
  out.sort((a,b)=>a.t-b.t);
  return {calls,rows:out.filter((x,i,a)=>!i||x.t!==a[i-1].t)};
}
function stats(rows=[]){
  const xs=[...rows].sort((a,b)=>a.closedAt-b.closedAt),wins=xs.filter(x=>x.netR>0),losses=xs.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0)),net=xs.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,dd=0;for(const x of xs){eq+=x.netR;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return {closedBaskets:xs.length,netR:round(net),expectancy:xs.length?round(net/xs.length):null,profitFactor:gl?round(gp/gl,2):(gp>0?99:0),
    winRate:xs.length?round(wins.length/xs.length*100,1):null,maxDrawdownR:round(dd)};
}
function group(rows,key){
  const m={};for(const r of rows)(m[key(r)]||(m[key(r)]=[])).push(r);
  return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]));
}
function folds(rows,start,end,n=4){
  const width=(end-start)/n;
  return Array.from({length:n},(_,i)=>{const a=start+i*width,b=i===n-1?end:start+(i+1)*width;
    return {fold:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),summary:stats(rows.filter(x=>x.closedAt>=a&&x.closedAt<b))};});
}
function concentration(bySymbol){
  const pos=Object.fromEntries(Object.entries(bySymbol).filter(([,x])=>x.netR>0).map(([k,x])=>[k,x.netR])),total=Object.values(pos).reduce((a,b)=>a+b,0);
  return Object.fromEntries(Object.entries(pos).map(([k,v])=>[k,round(v/total*100,1)]));
}
function coverage(bars,start,end){
  const expected=Math.floor((end-start)/H4),actual=bars.filter(x=>x.t>=start&&x.t<end).length;
  return {expected4h:expected,actual4h:actual,complete:actual===expected};
}

const runs={};
for(const symbol of C.symbols){
  console.log('fetch',symbol);
  const raw=await candles(symbol),bars=raw.rows;
  const primaryBars=bars.filter(x=>x.t>=PRIMARY_START-C.warmupDays*DAY&&x.t<PRIMARY_END);
  const secondaryBars=bars.filter(x=>x.t>=SECONDARY_START-C.warmupDays*DAY&&x.t<SECONDARY_END);
  runs[symbol]={
    rawCalls:raw.calls,bars,
    primaryCoverage:coverage(bars,PRIMARY_START,PRIMARY_END),
    secondaryCoverage:coverage(bars,SECONDARY_START,SECONDARY_END),
    first:bars[0]?.t??null,last:bars.at(-1)?.t??null,
    primary:runElliottAbcReversalV1(primaryBars,{symbol,entryStart:PRIMARY_START,entryEnd:PRIMARY_END}),
    secondary:runElliottAbcReversalV1(secondaryBars,{symbol,entryStart:SECONDARY_START,entryEnd:SECONDARY_END})
  };
}

const primaryRows=Object.values(runs).flatMap(x=>x.primary.closed),secondaryRows=Object.values(runs).flatMap(x=>x.secondary.closed);
const primarySummary=stats(primaryRows),secondarySummary=stats(secondaryRows);
const primaryBySide=group(primaryRows,x=>x.side),primaryBySymbol=group(primaryRows,x=>x.symbol);
const secondaryBySide=group(secondaryRows,x=>x.side),secondaryBySymbol=group(secondaryRows,x=>x.symbol);
const walkForward=folds(primaryRows,PRIMARY_START,PRIMARY_END,4),shares=concentration(primaryBySymbol),shareValues=Object.values(shares).filter(Number.isFinite);
const positiveAssets=Object.values(primaryBySymbol).filter(x=>x.closedBaskets>=12&&x.profitFactor>1&&x.expectancy>0).length;

const gates={
  primarySample:primarySummary.closedBaskets>=120,
  primaryEdge:primarySummary.profitFactor>=1.15&&primarySummary.expectancy>=.08,
  primaryDrawdown:primarySummary.maxDrawdownR<=15,
  chronologicalFolds:walkForward.every(x=>x.summary.closedBaskets>=20)&&walkForward.filter(x=>x.summary.profitFactor>1&&x.summary.expectancy>0).length>=3&&walkForward.every(x=>x.summary.profitFactor>=.85),
  bothSides:['LONG','SHORT'].every(k=>(primaryBySide[k]?.closedBaskets||0)>=30&&(primaryBySide[k]?.profitFactor||0)>1&&(primaryBySide[k]?.expectancy||0)>0),
  assetBreadth:positiveAssets>=5,
  concentration:shareValues.length>0&&Math.max(...shareValues)<=40,
  secondaryEdge:secondarySummary.profitFactor>=1.10&&secondarySummary.expectancy>=.03,
  secondaryDrawdown:secondarySummary.maxDrawdownR<=20,
  dataAdequacy:Object.values(runs).every(x=>x.primaryCoverage.complete&&x.secondaryCoverage.complete)
};

const out={
  schemaVersion:'ELLIOTT-ABC-REVERSAL-V1-HISTORICAL-EVIDENCE',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,
  predeclaredDesign:'research/elliott-abc-reversal-v1-design.md',config:C,source:'OKX_PUBLIC_SPOT_CONFIRMED_4H',
  periods:{primary:{start:C.primaryStart,end:C.primaryEnd},secondary:{start:C.secondaryStart,end:C.secondaryEnd}},
  primary:{summary:primarySummary,walkForward,bySide:primaryBySide,bySymbol:primaryBySymbol,positiveNetRConcentrationPct:shares,
    opportunity:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{setups:x.primary.setups.length,closed:x.primary.closed.length,open:x.primary.open.length,pending:x.primary.pending.length,rejected:x.primary.rejected}]))},
  secondary:{summary:secondarySummary,bySide:secondaryBySide,bySymbol:secondaryBySymbol,
    opportunity:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{setups:x.secondary.setups.length,closed:x.secondary.closed.length,open:x.secondary.open.length,pending:x.secondary.pending.length,rejected:x.secondary.rejected}]))},
  coverage:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{rawCalls:x.rawCalls,first:x.first==null?null:new Date(x.first).toISOString(),last:x.last==null?null:new Date(x.last).toISOString(),primary:x.primaryCoverage,secondary:x.secondaryCoverage}])),
  gate:{gates,positiveAssets,historicallyPromising:Object.values(gates).every(Boolean),paperShadowPermitted:Object.values(gates).every(Boolean)}
};
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/elliott-abc-reversal-v1-evidence.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({primary:out.primary.summary,folds:walkForward,bySide:primaryBySide,bySymbol:primaryBySymbol,concentration:shares,secondary:out.secondary.summary,secondaryBySide,secondaryBySymbol,gate:out.gate,coverage:out.coverage},null,2));
