import fs from 'node:fs';
import path from 'node:path';
import {runCrossVenueFundingSpreadV1} from './cross-venue-funding-spread-v1.js';

const ASSETS=Object.freeze(['DOGE','XRP','LINK','AVAX']);
const START=Date.UTC(2023,0,1);
const END=Date.UTC(2026,8,1);
const OUT=path.resolve('research/results');
const BINANCE_ARCHIVE_INPUT=process.env.BINANCE_ARCHIVE_INPUT||'/tmp/meridian-cross-venue-binance-transfer.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url,options={}){
  let last;
  for(let attempt=0;attempt<6;attempt++){
    const r=await fetch(url,{...options,headers:{accept:'application/json','content-type':'application/json','user-agent':'MERIDIAN-research-only-holdout',...(options.headers||{})}});
    if(r.ok)return await r.json();
    last=new Error('HTTP '+r.status+' '+url);
    if(r.status!==429)throw last;
    await sleep(10000*(attempt+1));
  }
  throw last;
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
    await sleep(2400);
  }
  return out;
}
async function hyperliquidMarks(coin,start=START,end=END){
  const rows=await hyperliquidInfo({type:'candleSnapshot',req:{coin,interval:'8h',startTime:start,endTime:end}});
  if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid candles '+coin);
  return rows;
}

const archive=JSON.parse(fs.readFileSync(BINANCE_ARCHIVE_INPUT,'utf8'));
if(archive?.source!=='Binance Vision official public archive'||archive?.holdout!==true||!archive?.assets)throw new Error('invalid Binance Vision transfer archive input');

const dataset={},sources={};
for(const asset of ASSETS){
  process.stdout.write('load '+asset+' ... ');
  const ba=archive.assets[asset];
  if(!ba)throw new Error('missing Binance transfer archive asset '+asset);
  const [hf,hm]=await Promise.all([hyperliquidFunding(asset),hyperliquidMarks(asset)]);
  const bf=ba.binanceFunding||[],bm=ba.binanceMarks||[];
  dataset[asset]={binanceFunding:bf,hyperliquidFunding:hf,binanceMarks:bm,hyperliquidMarks:hm};
  sources[asset]={binanceFunding:bf.length,hyperliquidFunding:hf.length,binanceMarks:bm.length,hyperliquidMarks:hm.length};
  console.log(JSON.stringify(sources[asset]));
  await sleep(3000);
}

const result=runCrossVenueFundingSpreadV1(dataset,{
  assets:[...ASSETS],
  gate:{minAssetMonthCycles:32,minCyclesPerAsset:8}
});
const summary={
  generatedAt:new Date().toISOString(),
  parentRuleset:result.ruleset,
  holdout:'CROSS-VENUE-FUNDING-SPREAD-V1-TRANSFER-HOLDOUT',
  start:new Date(START).toISOString(),
  end:new Date(END).toISOString(),
  assets:[...ASSETS],
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
  decision:result.gate.pass?'HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'HOLDOUT_FAIL_RESEARCH_REDESIGN',
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1-transfer-holdout-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1-transfer-holdout-full.json'),JSON.stringify({summary,result},null,2)+'\n');
const md=`# Cross-Venue Funding Spread V1 — Transfer Holdout

Generated: ${summary.generatedAt}

Assets: ${summary.assets.join(', ')}

| Cycles | Net return | PnL | PF | Max DD | Stress return | Positive windows | Gate |
|---:|---:|---:|---:|---:|---:|---:|---|
| ${summary.cycles} | ${Number(summary.totalReturnPct||0).toFixed(2)}% | $${Number(summary.totalNetPnl||0).toFixed(2)} | ${Number(summary.profitFactor||0).toFixed(3)} | ${Number(summary.maxDrawdownPct||0).toFixed(2)}% | ${Number(summary.stressReturnPct||0).toFixed(2)}% | ${summary.positiveWindows}/5 | ${summary.gatePass?'PASS':'FAIL'} |

**Decision:** ${summary.decision}

Research only. A PASS permits prospective Paper-shadow evaluation only; never live auto-promotion.
`;
fs.writeFileSync(path.join(OUT,'cross-venue-funding-spread-v1-transfer-holdout.md'),md);
console.log(JSON.stringify(summary,null,2));
