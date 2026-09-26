import fs from 'node:fs/promises';
import {BREAKOUT_TREND_V1 as C,runBreakoutTrendV1} from '../breakout-trend-v1.js';

const BASE='https://api.exchange.coinbase.com',HOUR=3600000,H4=4*HOUR,DAY=86400000;
const PRIMARY_START=Date.parse(C.primaryStart),PRIMARY_END=Date.parse(C.primaryEnd),SECONDARY_START=Date.parse(C.secondaryStart),SECONDARY_END=Date.parse(C.secondaryEnd);
const FETCH_START=Math.floor((PRIMARY_START-C.warmupDays*DAY)/H4)*H4,FETCH_END=SECONDARY_END-HOUR;
const round=(v,d=3)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const product=s=>`${s.replace(/USDT$/,'')}-USD`;

async function getJson(url,attempt=0){
  const r=await fetch(url,{headers:{'user-agent':'MERIDIAN-Breakout-Trend-V1/1.0','accept':'application/json'}});
  if(r.ok)return r.json();
  if((r.status===429||r.status>=500)&&attempt<5){await sleep(500*2**attempt);return getJson(url,attempt+1);}
  throw new Error(`${r.status} ${url}`);
}

async function candles(symbol){
  let cursor=FETCH_START,out=[],calls=0;
  while(cursor<=FETCH_END){
    const end=Math.min(FETCH_END,cursor+299*HOUR);
    const url=`${BASE}/products/${product(symbol)}/candles?granularity=3600&start=${encodeURIComponent(new Date(cursor).toISOString())}&end=${encodeURIComponent(new Date(end+HOUR).toISOString())}`;
    const rows=await getJson(url);calls++;
    for(const x of rows||[]){
      const t=Number(x[0])*1000;
      if(t>=FETCH_START&&t<=FETCH_END)out.push({t,l:Number(x[1]),h:Number(x[2]),o:Number(x[3]),c:Number(x[4])});
    }
    cursor=end+HOUR;await sleep(120);
  }
  out.sort((a,b)=>a.t-b.t);
  return {calls,rows:out.filter((x,i,a)=>!i||x.t!==a[i-1].t)};
}

function resample(rows){
  const m=new Map();
  for(const r of rows){
    const t=Math.floor(r.t/H4)*H4,b=m.get(t);
    if(!b)m.set(t,{t,o:r.o,h:r.h,l:r.l,c:r.c,count:1,hours:[r.t]});
    else{b.h=Math.max(b.h,r.h);b.l=Math.min(b.l,r.l);b.c=r.c;b.count++;b.hours.push(r.t);}
  }
  return [...m.values()].filter(x=>x.count===4&&new Set(x.hours).size===4).map(({hours,count,...x})=>x).sort((a,b)=>a.t-b.t);
}

function stats(rows=[]){
  const xs=[...rows].sort((a,b)=>a.closedAt-b.closedAt),wins=xs.filter(x=>x.netR>0),losses=xs.filter(x=>x.netR<0);
  const gp=wins.reduce((a,x)=>a+x.netR,0),gl=Math.abs(losses.reduce((a,x)=>a+x.netR,0)),net=xs.reduce((a,x)=>a+x.netR,0);
  let eq=0,peak=0,dd=0;
  for(const x of xs){eq+=x.netR;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return {closedTrades:xs.length,netR:round(net),expectancy:xs.length?round(net/xs.length):null,profitFactor:gl?round(gp/gl,2):(gp>0?99:0),
    winRate:xs.length?round(wins.length/xs.length*100,1):null,maxDrawdownR:round(dd),avgWinR:wins.length?round(gp/wins.length):null,avgLossR:losses.length?round(gl/losses.length):null};
}
function group(rows,key){
  const m={};for(const r of rows)(m[key(r)]||(m[key(r)]=[])).push(r);
  return Object.fromEntries(Object.entries(m).map(([k,v])=>[k,stats(v)]));
}
function timeFolds(rows,start,end,n=4){
  const width=(end-start)/n;
  return Array.from({length:n},(_,i)=>{
    const a=start+i*width,b=i===n-1?end:start+(i+1)*width;
    return {fold:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),summary:stats(rows.filter(x=>x.closedAt>=a&&x.closedAt<b))};
  });
}
function concentration(bySymbol){
  const positive=Object.fromEntries(Object.entries(bySymbol).filter(([,x])=>x.netR>0).map(([k,x])=>[k,x.netR]));
  const total=Object.values(positive).reduce((a,b)=>a+b,0);
  return Object.fromEntries(Object.entries(positive).map(([k,v])=>[k,round(v/total*100,1)]));
}

const collected={};
for(const symbol of C.symbols){
  console.log('fetch',symbol);
  const raw=await candles(symbol),bars=resample(raw.rows);
  const expectedEval=Math.floor((SECONDARY_END-PRIMARY_START)/H4);
  const actualEval=bars.filter(x=>x.t>=PRIMARY_START&&x.t<SECONDARY_END).length;
  const first=bars[0]?.t??null,last=bars.at(-1)?.t??null;
  const primary=runBreakoutTrendV1(bars.filter(x=>x.t<PRIMARY_END),{symbol,entryStart:PRIMARY_START,entryEnd:PRIMARY_END});
  const secondary=runBreakoutTrendV1(bars.filter(x=>x.t>=SECONDARY_START-C.warmupDays*DAY&&x.t<SECONDARY_END),{symbol,entryStart:SECONDARY_START,entryEnd:SECONDARY_END});
  collected[symbol]={rawCalls:raw.calls,hourly:raw.rows.length,bars,coverage:{expectedEval,actualEval,complete:actualEval===expectedEval,first:first==null?null:new Date(first).toISOString(),last:last==null?null:new Date(last).toISOString()},
    primary,secondary};
}

const primaryRows=Object.values(collected).flatMap(x=>x.primary.closed),secondaryRows=Object.values(collected).flatMap(x=>x.secondary.closed);
const primarySummary=stats(primaryRows),secondarySummary=stats(secondaryRows),primaryBySide=group(primaryRows,x=>x.side),primaryBySymbol=group(primaryRows,x=>x.symbol);
const secondaryBySide=group(secondaryRows,x=>x.side),secondaryBySymbol=group(secondaryRows,x=>x.symbol),folds=timeFolds(primaryRows,PRIMARY_START,PRIMARY_END,4);
const shares=concentration(primaryBySymbol),shareValues=Object.values(shares).filter(Number.isFinite);
const positiveAssets=Object.values(primaryBySymbol).filter(x=>x.closedTrades>=12&&x.profitFactor>1&&x.expectancy>0).length;
const gates={
  primarySample:primarySummary.closedTrades>=120,
  primaryEdge:primarySummary.profitFactor>=1.15&&primarySummary.expectancy>=.05,
  primaryDrawdown:primarySummary.maxDrawdownR<=20,
  chronologicalFolds:folds.every(x=>x.summary.closedTrades>=20)&&folds.filter(x=>x.summary.profitFactor>1&&x.summary.expectancy>0).length>=3&&folds.every(x=>x.summary.profitFactor>=.80),
  bothSides:['LONG','SHORT'].every(k=>(primaryBySide[k]?.closedTrades||0)>=30&&(primaryBySide[k]?.profitFactor||0)>1&&(primaryBySide[k]?.expectancy||0)>0),
  assetBreadth:positiveAssets>=5,
  concentration:shareValues.length>0&&Math.max(...shareValues)<=40,
  secondaryEdge:secondarySummary.profitFactor>=1.05&&secondarySummary.expectancy>0,
  secondaryDrawdown:secondarySummary.maxDrawdownR<=25,
  dataAdequacy:Object.values(collected).every(x=>x.coverage.complete)
};
const out={
  schemaVersion:'BREAKOUT-TREND-V1-HISTORICAL-EVIDENCE',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,
  predeclaredDesign:'research/breakout-trend-v1-design.md',config:C,
  source:'COINBASE_EXCHANGE_PUBLIC_1H_RESAMPLED_4H',
  periods:{primary:{start:C.primaryStart,end:C.primaryEnd},secondary:{start:C.secondaryStart,end:C.secondaryEnd}},
  primary:{summary:primarySummary,walkForward:folds,bySide:primaryBySide,bySymbol:primaryBySymbol,positiveNetRConcentrationPct:shares,
    opportunity:Object.fromEntries(Object.entries(collected).map(([k,x])=>[k,{signals:x.primary.signals.length,openAtEnd:x.primary.open.length,pendingAtEnd:x.primary.pending.length}]))},
  secondary:{summary:secondarySummary,bySide:secondaryBySide,bySymbol:secondaryBySymbol,
    opportunity:Object.fromEntries(Object.entries(collected).map(([k,x])=>[k,{signals:x.secondary.signals.length,openAtEnd:x.secondary.open.length,pendingAtEnd:x.secondary.pending.length}]))},
  coverage:Object.fromEntries(Object.entries(collected).map(([k,x])=>[k,{...x.coverage,hourly:x.hourly,rawCalls:x.rawCalls}])),
  gate:{gates,positiveAssets,historicallyPromising:Object.values(gates).every(Boolean),paperShadowPermitted:Object.values(gates).every(Boolean)}
};
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/breakout-trend-v1-evidence.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({primary:out.primary.summary,folds,bySide:primaryBySide,bySymbol:primaryBySymbol,concentration:shares,secondary:out.secondary.summary,gate:out.gate,coverage:out.coverage},null,2));
