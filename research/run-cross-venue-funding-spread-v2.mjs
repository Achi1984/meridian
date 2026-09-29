import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CROSS_VENUE_FUNDING_SPREAD_V2_RULESET,
  CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS,
  runCrossVenueFundingSpreadV2
} from './cross-venue-funding-spread-v2.js';

const START=Date.UTC(2024,8,1);
const END=Date.UTC(2026,8,1);
const OUT=path.resolve('research/results');
const BINANCE_INPUT=process.env.BINANCE_V2_ARCHIVE_INPUT||'/tmp/meridian-cross-venue-binance-v2.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function json(url,options={}){
  let last;
  for(let attempt=0;attempt<6;attempt++){
    const r=await fetch(url,{...options,headers:{
      accept:'application/json','content-type':'application/json',
      'user-agent':'MERIDIAN-cross-venue-v2-research-only',...(options.headers||{})
    }});
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
  while(cursor<end&&guard++<200){
    const rows=await hyperliquidInfo({type:'fundingHistory',coin,startTime:cursor,endTime:end-1});
    if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid funding '+coin);
    if(!rows.length)break;
    out.push(...rows);
    const times=rows.map(x=>Number(x.time)).filter(Number.isFinite);
    const last=times.length?Math.max(...times):NaN;
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

const archive=JSON.parse(fs.readFileSync(BINANCE_INPUT,'utf8'));
if(archive?.source!=='Binance Vision official public archive'||!archive?.assets)throw new Error('invalid Binance V2 archive input');

const dataset={},sources={};
for(const asset of CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS){
  process.stdout.write('load '+asset+' ... ');
  const ba=archive.assets[asset];
  if(!ba)throw new Error('missing Binance archive asset '+asset);
  const hf=await hyperliquidFunding(asset);
  const hm=await hyperliquidMarks(asset);
  const bf=ba.binanceFunding||[],bm=ba.binanceMarks||[];
  dataset[asset]={binanceFunding:bf,hyperliquidFunding:hf,binanceMarks:bm,hyperliquidMarks:hm};
  sources[asset]={
    binanceFunding:bf.length,hyperliquidFunding:hf.length,
    binanceMarks:bm.length,hyperliquidMarks:hm.length
  };
  console.log(JSON.stringify(sources[asset]));
  await sleep(2500);
}

const result=runCrossVenueFundingSpreadV2(dataset);
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:CROSS_VENUE_FUNDING_SPREAD_V2_RULESET,
  stage:'INDEPENDENT_VALIDATION',
  start:new Date(START).toISOString(),
  end:new Date(END).toISOString(),
  assets:[...CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS],
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
  researchOnly:true,executionImpact:false,autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'cross-venue-funding-spread-v2-summary.json');
const fp=path.join(OUT,'cross-venue-funding-spread-v2-full.json');
const mp=path.join(OUT,'cross-venue-funding-spread-v2.md');
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const rows=summary.byAsset.map(x=>`| ${x.asset} | ${x.cycles} | $${x.netPnl.toFixed(2)} | $${x.stressNetPnl.toFixed(2)} | $${x.fundingPnl.toFixed(2)} | $${x.basisPnl.toFixed(2)} |`).join('\n');
const md=`# Cross-Venue Funding Spread V2 — Independent Validation

Generated: ${summary.generatedAt}

| Metric | Result |
|---|---:|
| Valid asset-month cycles | ${summary.cycles} |
| Rejected cycles | ${summary.rejectedCycles} |
| Net return | ${Number(summary.totalReturnPct).toFixed(2)}% |
| Net PnL | $${Number(summary.totalNetPnl).toFixed(2)} |
| Profit Factor | ${Number(summary.profitFactor).toFixed(3)} |
| Max drawdown | ${Number(summary.maxDrawdownPct).toFixed(2)}% |
| Stress return | ${Number(summary.stressReturnPct).toFixed(2)}% |
| Positive windows | ${summary.positiveWindows}/5 |
| Positive-PnL concentration | ${Number(summary.concentrationPct).toFixed(2)}% |

## Asset attribution

| Asset | Cycles | Net PnL | Stress PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|
${rows}

**Gate:** ${summary.gatePass?'PASS':'FAIL'}

**Decision:** ${summary.decision}

Gate reasons: ${summary.gateReasons.join(', ')||'none'}

Research only. No automatic live promotion.
`;
fs.writeFileSync(mp,md);
summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
