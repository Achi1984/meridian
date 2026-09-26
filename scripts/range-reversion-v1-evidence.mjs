import fs from 'node:fs/promises';
import {RANGE_REVERSION_V1 as C,runRangeReversionV1} from '../range-reversion-v1.js';

const BASE='https://api.binance.com',H4=4*3600000,DAY=86400000;
const PRIMARY_START=Date.parse(C.primaryStart),PRIMARY_END=Date.parse(C.primaryEnd),SECONDARY_START=Date.parse(C.secondaryStart),SECONDARY_END=Date.parse(C.secondaryEnd);
const FETCH_START=PRIMARY_START-C.warmupDays*DAY,FETCH_END=SECONDARY_END;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function getJson(url,attempt=0){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-Range-Reversion-V1/1.0','accept':'application/json'}});
  if(r.ok)return r.json();
  if((r.status===418||r.status===429||r.status>=500)&&attempt<5){await sleep(500*2**attempt);return getJson(url,attempt+1);}
  throw new Error(`${r.status} ${url}`);
}
async function candles(symbol){
  let cursor=FETCH_START,out=[],calls=0;
  while(cursor<FETCH_END){
    const url=`${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${cursor}&endTime=${FETCH_END-1}&limit=1000`;
    const rows=await getJson(url);calls++;
    if(!Array.isArray(rows)||!rows.length)break;
    for(const k of rows){const t=Number(k[0]);if(t>=FETCH_START&&t<FETCH_END)out.push({t,o:Number(k[1]),h:Number(k[2]),l:Number(k[3]),c:Number(k[4])});}
    const last=Number(rows.at(-1)?.[0]);if(!Number.isFinite(last)||last<cursor)break;
    cursor=last+H4;if(rows.length<1000)break;await sleep(80);
  }
  out.sort((a,b)=>a.t-b.t);
  return{calls,rows:out.filter((x,i,a)=>!i||x.t!==a[i-1].t)};
}
function stats(rows=[]){
  const xs=[...rows].sort((a,b)=>a.closedAt-b.closedAt),wins=xs.filter(x=>x.netR>0),losses=xs.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0)),net=xs.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,dd=0;for(const x of xs){eq+=x.netR;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return{closedTrades:xs.length,netR:round(net),expectancy:xs.length?round(net/xs.length):null,profitFactor:gl?round(gp/gl,2):(gp>0?99:0),winRate:xs.length?round(wins.length/xs.length*100,1):null,maxDrawdownR:round(dd),avgWinR:wins.length?round(gp/wins.length):null,avgLossR:losses.length?round(gl/losses.length):null};
}
function group(rows,key){const m={};for(const r of rows)(m[key(r)]||(m[key(r)]=[])).push(r);return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]));}
function folds(rows,start,end,n=4){const width=(end-start)/n;return Array.from({length:n},(_,i)=>{const a=start+i*width,b=i===n-1?end:start+(i+1)*width;return{fold:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),summary:stats(rows.filter(x=>x.closedAt>=a&&x.closedAt<b))};});}
function concentration(bySymbol){const pos=Object.fromEntries(Object.entries(bySymbol).filter(([,x])=>x.netR>0).map(([k,x])=>[k,x.netR])),total=Object.values(pos).reduce((a,b)=>a+b,0);return Object.fromEntries(Object.entries(pos).map(([k,v])=>[k,round(v/total*100,1)]));}

const runs={};
for(const symbol of C.symbols){
  console.log('fetch',symbol);const raw=await candles(symbol),bars=raw.rows;
  const expected=Math.floor((SECONDARY_END-PRIMARY_START)/H4),actual=bars.filter(x=>x.t>=PRIMARY_START&&x.t<SECONDARY_END).length;
  const primaryBars=bars.filter(x=>x.t>=PRIMARY_START-C.warmupDays*DAY&&x.t<PRIMARY_END);
  const secondaryBars=bars.filter(x=>x.t>=SECONDARY_START-C.warmupDays*DAY&&x.t<SECONDARY_END);
  runs[symbol]={calls:raw.calls,bars,coverage:{expected,actual,complete:actual===expected,first:bars[0]?new Date(bars[0].t).toISOString():null,last:bars.at(-1)?new Date(bars.at(-1).t).toISOString():null},
    primary:runRangeReversionV1(primaryBars,{symbol,entryStart:PRIMARY_START,entryEnd:PRIMARY_END}),
    secondary:runRangeReversionV1(secondaryBars,{symbol,entryStart:SECONDARY_START,entryEnd:SECONDARY_END})};
}
const primaryRows=Object.values(runs).flatMap(x=>x.primary.closed),secondaryRows=Object.values(runs).flatMap(x=>x.secondary.closed);
const primarySummary=stats(primaryRows),secondarySummary=stats(secondaryRows),primaryBySide=group(primaryRows,x=>x.side),primaryBySymbol=group(primaryRows,x=>x.symbol),secondaryBySide=group(secondaryRows,x=>x.side),secondaryBySymbol=group(secondaryRows,x=>x.symbol);
const walkForward=folds(primaryRows,PRIMARY_START,PRIMARY_END,4),shares=concentration(primaryBySymbol),shareValues=Object.values(shares).filter(Number.isFinite);
const positiveAssets=Object.values(primaryBySymbol).filter(x=>x.closedTrades>=15&&x.profitFactor>1&&x.expectancy>0).length;
const gates={
  primarySample:primarySummary.closedTrades>=150,
  primaryEdge:primarySummary.profitFactor>=1.20&&primarySummary.expectancy>=.08,
  primaryDrawdown:primarySummary.maxDrawdownR<=15,
  chronologicalFolds:walkForward.every(x=>x.summary.closedTrades>=25)&&walkForward.filter(x=>x.summary.profitFactor>1&&x.summary.expectancy>0).length>=3&&walkForward.every(x=>x.summary.profitFactor>=.90),
  bothSides:['LONG','SHORT'].every(k=>(primaryBySide[k]?.closedTrades||0)>=40&&(primaryBySide[k]?.profitFactor||0)>=1.05&&(primaryBySide[k]?.expectancy||0)>0),
  assetBreadth:positiveAssets>=5,
  concentration:shareValues.length>0&&Math.max(...shareValues)<=35,
  secondaryEdge:secondarySummary.profitFactor>=1.15&&secondarySummary.expectancy>=.05,
  secondaryDrawdown:secondarySummary.maxDrawdownR<=20,
  dataAdequacy:Object.values(runs).every(x=>x.coverage.complete)
};
const out={schemaVersion:'RANGE-REVERSION-V1-HISTORICAL-EVIDENCE',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,predeclaredDesign:'research/range-reversion-v1-design.md',config:C,source:'BINANCE_PUBLIC_SPOT_4H',
  periods:{primary:{start:C.primaryStart,end:C.primaryEnd},secondary:{start:C.secondaryStart,end:C.secondaryEnd}},
  primary:{summary:primarySummary,walkForward,bySide:primaryBySide,bySymbol:primaryBySymbol,positiveNetRConcentrationPct:shares,opportunity:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{signals:x.primary.signals.length,expiredGapTarget:x.primary.diagnostics.expiredGapTarget,openAtEnd:x.primary.open.length}]))},
  secondary:{summary:secondarySummary,bySide:secondaryBySide,bySymbol:secondaryBySymbol,opportunity:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{signals:x.secondary.signals.length,expiredGapTarget:x.secondary.diagnostics.expiredGapTarget,openAtEnd:x.secondary.open.length}]))},
  coverage:Object.fromEntries(Object.entries(runs).map(([k,x])=>[k,{...x.coverage,calls:x.calls}])),
  gate:{gates,positiveAssets,historicallyPromising:Object.values(gates).every(Boolean),paperShadowPermitted:Object.values(gates).every(Boolean)}};
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/range-reversion-v1-evidence.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({primary:out.primary.summary,folds:walkForward,bySide:primaryBySide,bySymbol:primaryBySymbol,concentration:shares,secondary:out.secondary.summary,secondaryBySide,gate:out.gate,coverage:out.coverage},null,2));
