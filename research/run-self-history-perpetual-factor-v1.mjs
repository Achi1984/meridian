import fs from 'node:fs';
import path from 'node:path';
import {
  SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,
  SELF_HISTORY_PERPETUAL_ASSETS,
  runSelfHistoryPerpetualFactorV1
} from './self-history-perpetual-factor-v1.js';

const DATA=process.env.SELF_HISTORY_PERPETUAL_DATA_DIR||'/tmp/meridian-self-history-perpetual';
const OUT=path.resolve('research/results');
const START=Date.UTC(2023,0,1);
const END=Date.UTC(2025,11,31,23,59,59,999);

const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'MANIFEST.json'),'utf8'));
if(manifest?.foundation!=='PERPETUAL-FACTOR-DATA-V1')throw new Error('invalid factor-foundation manifest');

const dataset={},coverage={};
for(const asset of SELF_HISTORY_PERPETUAL_ASSETS){
  const p=path.join(DATA,asset+'USDT.json');
  if(!fs.existsSync(p))throw new Error('missing materialized asset '+asset);
  const x=JSON.parse(fs.readFileSync(p,'utf8'));
  if(x?.asset!==asset||x?.foundation!=='PERPETUAL-FACTOR-DATA-V1')throw new Error('invalid asset payload '+asset);
  dataset[asset]={bars:x.bars,premium:x.premium,funding:x.funding};
  coverage[asset]={firstCoreMonth:x.firstCoreMonth,lastCoreMonth:x.lastCoreMonth,...x.coverage};
}

const result=runSelfHistoryPerpetualFactorV1(dataset,{
  start:START,endInclusive:END,phase:'DISCOVERY'
});

const primary=result.primary||{};
const own=primary.summary||{};
const bench=result.crossSectionalBenchmark?.summary||{};
const stress=result.costStress?.summary||{};

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,
  exactReplication:false,
  foundation:'PERPETUAL-FACTOR-DATA-V1',
  source:manifest.source,
  window:{start:new Date(START).toISOString(),endInclusive:new Date(END).toISOString()},
  assets:[...SELF_HISTORY_PERPETUAL_ASSETS],
  coverage,
  dataErrors:result.dataErrors||[],
  ownHistory:{
    periods:own.periods??0,
    activeWeeks:own.activeWeeks??0,
    totalReturnPct:own.totalReturnPct??null,
    priceOnlyReturnPct:own.priceOnlyReturnPct??null,
    profitFactor:own.profitFactor??null,
    sharpe:own.sharpe??null,
    maxDrawdownPct:own.maxDrawdownPct??null,
    positiveWindows:own.positiveWindows??0,
    fundingContributionPct:own.fundingContributionPct??null,
    priceContributionPct:own.priceContributionPct??null,
    costContributionPct:own.costContributionPct??null,
    turnover:own.turnover??null,
    factorReturns:primary.factorReturns||{},
    positiveFactorBooks:primary.positiveFactorBooks??0,
    positiveFactorConcentrationPct:primary.positiveFactorConcentrationPct??null
  },
  crossSectionalBenchmark:{
    periods:bench.periods??0,
    totalReturnPct:bench.totalReturnPct??null,
    priceOnlyReturnPct:bench.priceOnlyReturnPct??null,
    profitFactor:bench.profitFactor??null,
    sharpe:bench.sharpe??null,
    maxDrawdownPct:bench.maxDrawdownPct??null,
    factorReturns:result.crossSectionalBenchmark?.factorReturns||{}
  },
  costStress:{
    totalReturnPct:stress.totalReturnPct??null,
    priceOnlyReturnPct:stress.priceOnlyReturnPct??null,
    profitFactor:stress.profitFactor??null,
    sharpe:stress.sharpe??null,
    maxDrawdownPct:stress.maxDrawdownPct??null,
    factorReturns:result.costStress?.factorReturns||{}
  },
  anchorRuns:result.anchorRuns||[],
  gate:result.gate,
  decision:result.decision,
  researchOnly:true,executionImpact:false,autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'self-history-perpetual-factor-v1-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'self-history-perpetual-factor-v1-full.json'),JSON.stringify({summary,result},null,2)+'\n');

const fmt=x=>Number.isFinite(Number(x))?Number(x).toFixed(3):'n/a';
const factorRows=Object.entries(summary.ownHistory.factorReturns).map(([f,v])=>`| ${f} | ${fmt(v)}% | ${fmt(summary.crossSectionalBenchmark.factorReturns[f])}% | ${fmt(summary.costStress.factorReturns[f])}% |`).join('\n');
const anchorRows=(summary.anchorRuns||[]).map(x=>`| ${x.weekday} | ${fmt(x.returnPct)}% | ${fmt(x.sharpe)} | ${x.periods} | ${x.dataFailure?'FAIL':'OK'} |`).join('\n');

const md=`# Self-History Perpetual Factor V1 — Discovery

Generated: ${summary.generatedAt}

Foundation: PERPETUAL-FACTOR-DATA-V1  
Data: official Binance Vision USD-M 4h perpetual + 4h premium-index + funding archives.  
Discovery boundary: 2023-01-01 through 2025-12-31 UTC; no weekly holding crosses into 2026.

| Metric | Own-history | Cross-sectional | 4x-cost stress |
|---|---:|---:|---:|
| Net return | ${fmt(summary.ownHistory.totalReturnPct)}% | ${fmt(summary.crossSectionalBenchmark.totalReturnPct)}% | ${fmt(summary.costStress.totalReturnPct)}% |
| Price-only return | ${fmt(summary.ownHistory.priceOnlyReturnPct)}% | ${fmt(summary.crossSectionalBenchmark.priceOnlyReturnPct)}% | ${fmt(summary.costStress.priceOnlyReturnPct)}% |
| Profit Factor | ${fmt(summary.ownHistory.profitFactor)} | ${fmt(summary.crossSectionalBenchmark.profitFactor)} | ${fmt(summary.costStress.profitFactor)} |
| Sharpe | ${fmt(summary.ownHistory.sharpe)} | ${fmt(summary.crossSectionalBenchmark.sharpe)} | ${fmt(summary.costStress.sharpe)} |
| Max DD | ${fmt(summary.ownHistory.maxDrawdownPct)}% | ${fmt(summary.crossSectionalBenchmark.maxDrawdownPct)}% | ${fmt(summary.costStress.maxDrawdownPct)}% |

Completed Monday periods: ${summary.ownHistory.periods}  
Positive chronological windows: ${summary.ownHistory.positiveWindows}/5  
Positive factor-books: ${summary.ownHistory.positiveFactorBooks}/4  
Positive factor-book concentration: ${fmt(summary.ownHistory.positiveFactorConcentrationPct)}%

## Factor books

| Factor | Own-history | Cross-sectional | Stress |
|---|---:|---:|---:|
${factorRows}

## Weekday-anchor robustness

| Anchor | Return | Sharpe | Periods | Data |
|---|---:|---:|---:|---|
${anchorRows}

**Gate:** ${summary.gate?.pass?'PASS':'FAIL'}  
**Reasons:** ${(summary.gate?.reasons||[]).join(', ')||'none'}  
**Decision:** ${summary.decision}

Research only. A discovery pass authorizes only the already frozen 2026 temporal holdout.
`;
fs.writeFileSync(path.join(OUT,'self-history-perpetual-factor-v1.md'),md);
console.log(JSON.stringify(summary,null,2));
