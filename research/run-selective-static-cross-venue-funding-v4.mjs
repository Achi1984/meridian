import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET,
  SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS,
  runSelectiveStaticCrossVenueFundingV4
} from './selective-static-cross-venue-funding-v4.js';

const RAW_START=Date.UTC(2025,7,1);
const RAW_END=Date.UTC(2026,8,1);
const BINANCE_INPUT=process.env.BINANCE_SELECTIVE_V4_ARCHIVE_INPUT||'/tmp/meridian-selective-static-v4-binance.json';
const OUT=path.resolve('research/results');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url,options={}){
  let last;
  for(let attempt=0;attempt<7;attempt++){
    const r=await fetch(url,{...options,headers:{accept:'application/json','content-type':'application/json','user-agent':'ACHI-MERIDIAN-SELECTIVE-STATIC-V4/1',...(options.headers||{})}});
    if(r.ok)return await r.json();
    last=new Error('HTTP '+r.status+' '+url);
    if(r.status!==429)throw last;
    await sleep(10000*(attempt+1));
  }
  throw last;
}
async function hl(body){return json('https://api.hyperliquid.xyz/info',{method:'POST',body:JSON.stringify(body)})}
async function funding(coin){
  const out=[];let cursor=RAW_START,guard=0;
  while(cursor<RAW_END&&guard++<100){
    const rows=await hl({type:'fundingHistory',coin,startTime:cursor,endTime:RAW_END-1});
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
async function marks(coin){
  const rows=await hl({type:'candleSnapshot',req:{coin,interval:'8h',startTime:RAW_START,endTime:RAW_END}});
  if(!Array.isArray(rows))throw new Error('Invalid Hyperliquid candles '+coin);
  return rows;
}
function sha256(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}

const archive=JSON.parse(fs.readFileSync(BINANCE_INPUT,'utf8'));
if(archive?.source!=='Binance Vision official public archive'||!archive?.assets)throw new Error('invalid Binance V4 archive input');

const dataset={},sources={};
for(const asset of SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS){
  process.stdout.write('load '+asset+' ... ');
  const ba=archive.assets[asset];
  if(!ba)throw new Error('missing Binance archive asset '+asset);
  const hf=await funding(asset),hm=await marks(asset);
  const bf=ba.binanceFunding||[],bm=ba.binanceMarks||[];
  dataset[asset]={binanceFunding:bf,hyperliquidFunding:hf,binanceMarks:bm,hyperliquidMarks:hm};
  sources[asset]={binanceFunding:bf.length,hyperliquidFunding:hf.length,binanceMarks:bm.length,hyperliquidMarks:hm.length};
  console.log(JSON.stringify(sources[asset]));
  await sleep(2500);
}

const result=runSelectiveStaticCrossVenueFundingV4(dataset);
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET,
  stage:'INDEPENDENT_VALIDATION',
  rawStart:new Date(RAW_START).toISOString(),
  rawEnd:new Date(RAW_END).toISOString(),
  tradeMonths:result.months,
  assets:[...SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS],
  sources,
  decisionSlots:result.decisionSlots,
  activeCycles:result.activeCycles,
  noTradeCycles:result.noTradeCycles,
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
  meanActiveTrailingSpread:result.meanActiveTrailingSpread,
  medianActiveTrailingSpread:result.medianActiveTrailingSpread,
  byAsset:result.byAsset,
  windows:result.windows,
  gatePass:result.gate.pass,
  gateReasons:result.gate.reasons,
  decision:result.decision,
  researchOnly:true,executionImpact:false,autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'selective-static-cross-venue-funding-v4-summary.json');
const fp=path.join(OUT,'selective-static-cross-venue-funding-v4-full.json');
const mp=path.join(OUT,'selective-static-cross-venue-funding-v4.md');
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const rows=summary.byAsset.map(x=>`| ${x.asset} | ${x.activeCycles} | $${Number(x.netPnl).toFixed(2)} | $${Number(x.stressNetPnl).toFixed(2)} | $${Number(x.fundingPnl).toFixed(2)} | $${Number(x.basisPnl).toFixed(2)} |`).join('\n');
const md=`# Selective Static Cross-Venue Funding V4 — Independent Validation

Generated: ${summary.generatedAt}

| Metric | Result |
|---|---:|
| Decision slots | ${summary.decisionSlots} |
| Active cycles | ${summary.activeCycles} |
| No-trade cycles | ${summary.noTradeCycles} |
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

| Asset | Active | Net PnL | Stress PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|
${rows}

**Gate:** ${summary.gatePass?'PASS':'FAIL'}

**Decision:** ${summary.decision}

Gate reasons: ${summary.gateReasons.join(', ')||'none'}

Research only. PASS authorizes only a separately configured prospective Paper shadow, never live execution.
`;
fs.writeFileSync(mp,md);

summary.artifactHashes={summaryPrehashSha256:sha256(sp),fullSha256:sha256(fp),markdownSha256:sha256(mp)};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
