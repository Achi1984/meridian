import fs from 'node:fs';
import path from 'node:path';
import {
  CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
  CROSS_VENUE_FUNDING_SPREAD_V1_ASSETS,
  runCrossVenueFundingSpreadV1
} from './cross-venue-funding-spread-v1.js';

const START=Date.UTC(2023,0,1);
const END=Date.UTC(2026,8,1);
const OUT=path.resolve('research/results');
const DAY=86400000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url,options={}){
  const r=await fetch(url,{...options,headers:{accept:'application/json','content-type':'application/json','user-agent':'MERIDIAN-research-only',...(options.headers||{})}});
  if(!r.ok)throw new Error('HTTP '+r.status+' '+url);
  return await r.json();
}
async function hyperliquidInfo(body){
  return json('https://api.hyperliquid.xyz/info',{method:'POST',body:JSON.stringify(body)});
}
async function hyperliquidFunding(coin,start=START,end=END){
  const out=[];let cursor=start,guard=0;
  while(cursor<=end&&guard++<300){
    const rows=await hyperliquidInfo({type:'fundingHistory',coin,startTime:cursor,endTime:end});
    if(!Array.isArray(rows)||!rows.length)break;
    out.push(...rows);
    const last=Math.max(...rows.map(x=>Number(x.time)).filter(Number.isFinite));
    if(!Number.isFinite(last)||last<cursor)break;
    cursor=last+1;
    if(rows.length<500)break;
    await sleep(80);
  }
  return out;
}
async function hyperliquidMarks(coin,start=START,end=END){
  const rows=await hyperliquidInfo({type:'candleSnapshot',req:{coin,interval:'8h',startTime:start,endTime:end}});
  if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid candles '+coin);
  return rows;
}
async function binanceFunding(symbol,start=START,end=END){
  const out=[];let cursor=start,guard=0;
  while(cursor<=end&&guard++<100){
    const u=new URL('https://fapi.binance.com/fapi/v1/fundingRate');
    u.searchParams.set('symbol',symbol);
    u.searchParams.set('startTime',String(cursor));
    u.searchParams.set('endTime',String(end));
    u.searchParams.set('limit','1000');
    const rows=await json(u.toString());
    if(!Array.isArray(rows)||!rows.length)break;
    out.push(...rows);
    const last=Math.max(...rows.map(x=>Number(x.fundingTime)).filter(Number.isFinite));
    if(!Number.isFinite(last)||last<cursor)break;
    cursor=last+1;
    if(rows.length<1000)break;
    await sleep(80);
  }
  return out;
}
async function binanceMarks(symbol,start=START,end=END){
  const out=[];let cursor=start,guard=0;
  while(cursor<end&&guard++<20){
    const chunkEnd=Math.min(end,cursor+180*DAY);
    const u=new URL('https://fapi.binance.com/fapi/v1/markPriceKlines');
    u.searchParams.set('symbol',symbol);
    u.searchParams.set('interval','8h');
    u.searchParams.set('startTime',String(cursor));
    u.searchParams.set('endTime',String(chunkEnd));
    u.searchParams.set('limit','1500');
    const rows=await json(u.toString());
    if(!Array.isArray(rows))throw new Error('Invalid Binance marks '+symbol);
    out.push(...rows);
    cursor=chunkEnd+1;
    await sleep(80);
  }
  return out;
}

const dataset={},sources={};
for(const asset of CROSS_VENUE_FUNDING_SPREAD_V1_ASSETS){
  process.stdout.write('load '+asset+' ... ');
  const symbol=asset+'USDT';
  const [bf,hf,bm,hm]=await Promise.all([
    binanceFunding(symbol),
    hyperliquidFunding(asset),
    binanceMarks(symbol),
    hyperliquidMarks(asset)
  ]);
  dataset[asset]={binanceFunding:bf,hyperliquidFunding:hf,binanceMarks:bm,hyperliquidMarks:hm};
  sources[asset]={binanceFunding:bf.length,hyperliquidFunding:hf.length,binanceMarks:bm.length,hyperliquidMarks:hm.length};
  console.log(JSON.stringify(sources[asset]));
  await sleep(150);
}
const result=runCrossVenueFundingSpreadV1(dataset);
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
  start:new Date(START).toISOString(),
  end:new Date(END).toISOString(),
  sources,
  direction:result.direction,
  cycles:result.cycles.length,
  rejectedCycles:result.rejected.length,
  totalReturnPct:result.summary.totalReturnPct,
  totalNetPnl:result.summary.totalNetPnl,
  profitFactor:result.summary.profitFactor,
  maxDrawdownPct:result.summary.maxDrawdownPct,
  totalFundingPnl:result.summary.totalFundingPnl,
  totalBasisPnl:result.summary.totalBasisPnl,
  totalCosts:result.summary.totalCosts,
  stressReturnPct:result.stressSummary.totalReturnPct,
  positiveWindows:result.stability.positiveWindows,
  byAsset:result.byAsset,
  concentrationPct:result.positivePnlConcentrationPct,
  gatePass:result.gate.pass,
  gateReasons:result.gate.reasons,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1-full.json'),JSON.stringify({summary,result},null,2)+'\n');
const md=`# Cross-Venue Funding Spread V1 — Discovery

Generated: ${summary.generatedAt}

Ruleset: \`${summary.ruleset}\`

| Cycles | Net return | PnL | PF | Max DD | Stress return | Positive windows | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| ${summary.cycles} | ${Number(summary.totalReturnPct||0).toFixed(2)}% | $${Number(summary.totalNetPnl||0).toFixed(2)} | ${Number(summary.profitFactor||0).toFixed(3)} | ${Number(summary.maxDrawdownPct||0).toFixed(2)}% | ${Number(summary.stressReturnPct||0).toFixed(2)}% | ${summary.positiveWindows}/5 | ${summary.gatePass?'PASS':'FAIL'} |

**Decision:** ${summary.decision}

Funding PnL: $${Number(summary.totalFundingPnl||0).toFixed(2)}  
Basis PnL: $${Number(summary.totalBasisPnl||0).toFixed(2)}  
Modeled costs: $${Number(summary.totalCosts||0).toFixed(2)}

Research only. No auto-promotion and no execution impact.
`;
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1.md'),md);
console.log(JSON.stringify(summary,null,2));
