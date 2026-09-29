import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET,
  ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS,
  runAdaptiveCrossVenueFundingSpreadV3
} from './adaptive-cross-venue-funding-spread-v3.js';

const RAW_START=Date.parse(process.env.ADAPTIVE_V3_START||'2024-09-01T00:00:00Z');
const RAW_END=Date.parse(process.env.ADAPTIVE_V3_END||'2025-09-01T00:00:00Z');
const BINANCE_INPUT=process.env.BINANCE_ADAPTIVE_V3_ARCHIVE_INPUT||'/tmp/meridian-adaptive-cross-venue-v3-binance.json';
const OUT=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url,options={}){
  let last;
  for(let attempt=0;attempt<7;attempt++){
    const r=await fetch(url,{
      ...options,
      headers:{
        accept:'application/json',
        'content-type':'application/json',
        'user-agent':'ACHI-MERIDIAN-ADAPTIVE-CROSS-VENUE-V3/1',
        ...(options.headers||{})
      }
    });
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

async function hyperliquidFunding(coin,start=RAW_START,end=RAW_END){
  const out=[];let cursor=start,guard=0;
  while(cursor<end&&guard++<100){
    const rows=await hyperliquidInfo({type:'fundingHistory',coin,startTime:cursor,endTime:end-1});
    if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid funding '+coin);
    if(!rows.length)break;
    out.push(...rows);
    const times=rows.map(x=>Number(x?.time)).filter(Number.isFinite);
    if(!times.length)break;
    const last=Math.max(...times);
    if(last<cursor)break;
    cursor=last+1;
    if(rows.length<500)break;
    await sleep(2500);
  }
  return out;
}

async function hyperliquidMarks(coin,start=RAW_START,end=RAW_END){
  const rows=await hyperliquidInfo({type:'candleSnapshot',req:{coin,interval:'8h',startTime:start,endTime:end}});
  if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid candles '+coin);
  return rows;
}

function sha256(p){
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function compactByAsset(x){
  return {
    asset:x.asset,
    activeCycles:x.activeCycles,
    binanceLongCycles:x.binanceLongCycles,
    hyperliquidLongCycles:x.hyperliquidLongCycles,
    netPnl:x.netPnl,
    stressNetPnl:x.stressNetPnl,
    fundingPnl:x.fundingPnl,
    basisPnl:x.basisPnl,
    costs:x.costs
  };
}

const archive=JSON.parse(fs.readFileSync(BINANCE_INPUT,'utf8'));
if(archive?.source!=='Binance Vision official public archive'||!archive?.assets)throw new Error('invalid Binance V3 archive input');

const dataset={},sources={};
for(const asset of ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS){
  process.stdout.write('load '+asset+' ... ');
  const ba=archive.assets[asset];
  if(!ba)throw new Error('missing Binance archive asset '+asset);
  const hf=await hyperliquidFunding(asset);
  const hm=await hyperliquidMarks(asset);
  const bf=ba.binanceFunding||[],bm=ba.binanceMarks||[];
  dataset[asset]={binanceFunding:bf,hyperliquidFunding:hf,binanceMarks:bm,hyperliquidMarks:hm};
  sources[asset]={
    binanceFunding:bf.length,
    hyperliquidFunding:hf.length,
    binanceMarks:bm.length,
    hyperliquidMarks:hm.length
  };
  console.log(JSON.stringify(sources[asset]));
  await sleep(2500);
}

const result=runAdaptiveCrossVenueFundingSpreadV3(dataset,{stage:'DISCOVERY'});
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET,
  stage:'DISCOVERY',
  rawStart:new Date(RAW_START).toISOString(),
  rawEnd:new Date(RAW_END).toISOString(),
  tradeMonths:result.months,
  assets:[...ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS],
  sources,
  decisionSlots:result.decisionSlots,
  activeCycles:result.activeCycles,
  noTradeCycles:result.noTradeCycles,
  binanceLongCycles:result.binanceLongCycles,
  hyperliquidLongCycles:result.hyperliquidLongCycles,
  dataIntegrityFailure:result.dataIntegrityFailure,
  dataIntegrityErrors:result.dataIntegrityErrors,
  totalReturnPct:result.summary.totalReturnPct,
  totalNetPnl:result.summary.totalNetPnl,
  profitFactor:result.summary.profitFactor,
  maxDrawdownPct:result.summary.maxDrawdownPct,
  positiveWindows:result.positiveWindows,
  totalFundingPnl:result.summary.totalFundingPnl,
  totalBasisPnl:result.summary.totalBasisPnl,
  totalCosts:result.summary.totalCosts,
  fundingCostRatio:result.fundingCostRatio,
  stressReturnPct:result.stressSummary.totalReturnPct,
  positiveAssets:result.positiveAssets,
  positiveConcentrationPct:result.positiveConcentrationPct,
  signalSignAgreementPct:result.signalSignAgreementPct,
  meanAbsTrailingSpread:result.meanAbsTrailingSpread,
  medianAbsTrailingSpread:result.medianAbsTrailingSpread,
  meanActiveTrailingSpread:result.meanActiveTrailingSpread,
  medianActiveTrailingSpread:result.medianActiveTrailingSpread,
  byAsset:result.byAsset.map(compactByAsset),
  windows:result.windows,
  gatePass:result.gate.pass,
  gateReasons:result.gate.reasons,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'adaptive-cross-venue-funding-spread-v3-summary.json');
const fp=path.join(OUT,'adaptive-cross-venue-funding-spread-v3-full.json');
const mp=path.join(OUT,'adaptive-cross-venue-funding-spread-v3.md');

fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const assetRows=summary.byAsset.map(x=>`| ${x.asset} | ${x.activeCycles} | ${x.binanceLongCycles} | ${x.hyperliquidLongCycles} | $${Number(x.netPnl).toFixed(2)} | $${Number(x.fundingPnl).toFixed(2)} | $${Number(x.basisPnl).toFixed(2)} |`).join('\n');
const md=`# Adaptive Cross-Venue Funding Spread V3 — Discovery

Generated: ${summary.generatedAt}

| Metric | Result |
|---|---:|
| Decision slots | ${summary.decisionSlots} |
| Active cycles | ${summary.activeCycles} |
| No-trade cycles | ${summary.noTradeCycles} |
| Binance-long cycles | ${summary.binanceLongCycles} |
| Hyperliquid-long cycles | ${summary.hyperliquidLongCycles} |
| Net return | ${Number(summary.totalReturnPct).toFixed(3)}% |
| Net PnL | $${Number(summary.totalNetPnl).toFixed(2)} |
| Profit Factor | ${Number(summary.profitFactor).toFixed(3)} |
| Max drawdown | ${Number(summary.maxDrawdownPct).toFixed(3)}% |
| Positive windows | ${summary.positiveWindows}/5 |
| Funding PnL | $${Number(summary.totalFundingPnl).toFixed(2)} |
| Basis PnL | $${Number(summary.totalBasisPnl).toFixed(2)} |
| Base costs | $${Number(summary.totalCosts).toFixed(2)} |
| Funding / cost ratio | ${Number(summary.fundingCostRatio).toFixed(3)} |
| Stress return | ${Number(summary.stressReturnPct).toFixed(3)}% |
| Positive assets | ${summary.positiveAssets}/8 |
| Positive concentration | ${Number(summary.positiveConcentrationPct).toFixed(2)}% |
| Signal sign agreement | ${Number(summary.signalSignAgreementPct).toFixed(2)}% |

## Asset attribution

| Asset | Active | Binance-long | Hyperliquid-long | Net PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|---:|
${assetRows}

**Gate:** ${summary.gatePass?'PASS':'FAIL'}

**Decision:** ${summary.decision}

Gate reasons: ${summary.gateReasons.join(', ')||'none'}

Research only. Discovery can authorize only the frozen temporal holdout, never Paper or live execution.
`;
fs.writeFileSync(mp,md);

summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
