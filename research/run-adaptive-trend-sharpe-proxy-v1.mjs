import fs from 'node:fs';
import path from 'node:path';
import {
  ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET,
  ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS,
  runAdaptiveTrendSharpeProxyV1
} from './adaptive-trend-sharpe-proxy-v1.js';

const INPUT=process.env.ADAPTIVE_TREND_INPUT||'/tmp/meridian-adaptive-trend-v1.json';
const OUT=path.resolve('research/results');

const archive=JSON.parse(fs.readFileSync(INPUT,'utf8'));
if(archive?.source!=='Binance Vision official public USD-M archives'||archive?.timeframe!=='6h'||!archive?.assets){
  throw new Error('invalid AdaptiveTrend Binance Vision input');
}

const dataset={};
for(const asset of ['BTC',...ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS]){
  const x=archive.assets[asset];
  if(!x)throw new Error('missing frozen asset '+asset);
  dataset[asset]={bars:x.bars||[],funding:x.funding||[]};
}

const result=runAdaptiveTrendSharpeProxyV1(dataset);
const selectedLongCounts=Object.fromEntries(ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS.map(a=>[a,0]));
const selectedShortCounts=Object.fromEntries(ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS.map(a=>[a,0]));
for(const s of result.selection||[]){
  for(const a of s.long||[])selectedLongCounts[a]=(selectedLongCounts[a]||0)+1;
  for(const a of s.short||[])selectedShortCounts[a]=(selectedShortCounts[a]||0)+1;
}

const sourceCoverage=Object.fromEntries(['BTC',...ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS].map(a=>[
  a,
  archive.assets[a]?.coverage||{
    bars:(archive.assets[a]?.bars||[]).length,
    funding:(archive.assets[a]?.funding||[]).length
  }
]));

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET,
  exactReplication:false,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false,
  assets:[...ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS],
  evaluationStart:new Date(result.config.evalStart).toISOString(),
  evaluationEnd:new Date(result.config.evalEnd).toISOString(),
  source:archive.source,
  sourceCoverage,
  periods:result.summary.periods,
  totalReturnPct:result.summary.totalReturnPct,
  profitFactor:result.summary.profitFactor,
  maxDrawdownPct:result.summary.maxDrawdownPct,
  sharpe:result.summary.sharpe,
  stressReturnPct:result.stressSummary.totalReturnPct,
  stressProfitFactor:result.stressSummary.profitFactor,
  stressMaxDrawdownPct:result.stressSummary.maxDrawdownPct,
  positiveWindows:result.stability.positiveWindows,
  positiveAssets:result.gate.positiveAssets,
  positivePnlConcentrationPct:result.positivePnlConcentrationPct,
  byAsset:result.byAsset,
  diagnostics:result.diagnostics,
  benchmarks:result.benchmarks,
  selectedLongCounts,
  selectedShortCounts,
  gatePass:result.gate.pass,
  gateReasons:result.gate.reasons,
  decision:result.decision
};

fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'adaptive-trend-sharpe-proxy-v1-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'adaptive-trend-sharpe-proxy-v1-full.json'),JSON.stringify({summary,result},null,2)+'\n');

const assetRows=summary.byAsset.map(x=>`| ${x.asset} | ${Number(x.contributionPct||0).toFixed(3)}% | ${x.unavailableIntervals||0} | ${selectedLongCounts[x.asset]||0} | ${selectedShortCounts[x.asset]||0} |`).join('\n');
const md=`# AdaptiveTrend Sharpe Proxy V1 — Discovery

Generated: ${summary.generatedAt}

Ruleset: \`${summary.ruleset}\`

This is a publication-inspired proxy, not an exact replication.

| Periods | Net return | PF | Max DD | Sharpe | Stress return | Positive windows | Positive assets | Gate |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| ${summary.periods} | ${Number(summary.totalReturnPct||0).toFixed(2)}% | ${Number(summary.profitFactor||0).toFixed(3)} | ${Number(summary.maxDrawdownPct||0).toFixed(2)}% | ${Number(summary.sharpe||0).toFixed(3)} | ${Number(summary.stressReturnPct||0).toFixed(2)}% | ${summary.positiveWindows}/5 | ${summary.positiveAssets}/12 | ${summary.gatePass?'PASS':'FAIL'} |

**Decision:** ${summary.decision}

## Diagnostics

- Long contribution: ${Number(summary.diagnostics.longContributionPct||0).toFixed(2)}%
- Short contribution: ${Number(summary.diagnostics.shortContributionPct||0).toFixed(2)}%
- Long funding contribution: ${Number(summary.diagnostics.longFundingPct||0).toFixed(2)}%
- Short funding contribution: ${Number(summary.diagnostics.shortFundingPct||0).toFixed(2)}%
- Total turnover: ${Number(summary.diagnostics.totalTurnover||0).toFixed(2)}
- Base modeled costs: ${Number(summary.diagnostics.totalModeledCostPct||0).toFixed(2)}%
- Stress modeled costs: ${Number(summary.diagnostics.totalStressCostPct||0).toFixed(2)}%
- BTC buy-and-hold benchmark: ${Number(summary.benchmarks.btcBuyHoldReturnPct||0).toFixed(2)}%
- Frozen-universe equal-weight benchmark: ${Number(summary.benchmarks.equalWeightBuyHoldReturnPct||0).toFixed(2)}%

## Asset contribution

| Asset | Contribution | Unavailable intervals | Long-selected months | Short-selected months |
|---|---:|---:|---:|---:|
${assetRows}

Research only. No Paper or live promotion follows from discovery alone.
`;
fs.writeFileSync(path.join(OUT,'adaptive-trend-sharpe-proxy-v1.md'),md);
console.log(JSON.stringify(summary,null,2));
