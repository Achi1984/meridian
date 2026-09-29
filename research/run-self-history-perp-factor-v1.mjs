import fs from 'node:fs';
import path from 'node:path';
import {
  SELF_HISTORY_PERP_FACTOR_V1_RULESET,
  SELF_HISTORY_DISCOVERY_ASSETS,
  runSelfHistoryPerpFactorV1
} from './self-history-perp-factor-v1.js';

const DATA=process.env.SELF_HISTORY_DATA_DIR||'/tmp/meridian-self-history-factor';
const OUT=path.resolve('research/results');
const START=Date.UTC(2022,3,4);
const END=Date.UTC(2024,11,30);

const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'MANIFEST.json'),'utf8'));
if(manifest?.source!=='Binance Vision official public USD-M monthly archives')throw new Error('invalid source manifest');
if(manifest?.set!=='DISCOVERY')throw new Error('discovery runner requires DISCOVERY data set');

const dataset={};
const coverage={};
for(const symbol of SELF_HISTORY_DISCOVERY_ASSETS){
  const p=path.join(DATA,symbol+'.json');
  if(!fs.existsSync(p))throw new Error('missing discovery asset '+symbol);
  const x=JSON.parse(fs.readFileSync(p,'utf8'));
  if(x?.symbol!==symbol||x?.source!==manifest.source)throw new Error('invalid discovery asset '+symbol);
  dataset[symbol]={bars:x.bars,funding:x.funding};
  coverage[symbol]=x.coverage;
}

const result=runSelfHistoryPerpFactorV1(dataset,{
  assets:[...SELF_HISTORY_DISCOVERY_ASSETS],
  start:START,
  endExclusive:END,
  phase:'DISCOVERY'
});

const own=result.ownHistory||{};
const bench=result.crossSectionalBenchmark||{};
const stress=result.costStress||{};
const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SELF_HISTORY_PERP_FACTOR_V1_RULESET,
  source:manifest.source,
  window:{start:new Date(START).toISOString(),end:new Date(END).toISOString()},
  assets:[...SELF_HISTORY_DISCOVERY_ASSETS],
  coverage,
  dataErrors:result.dataErrors||[],
  ownHistory:{
    completedPeriods:own.completedPeriods??0,
    activeWeeks:own.activeWeeks??0,
    flatWeeks:own.flatWeeks??0,
    rejectedWeeks:own.rejectedWeeks??0,
    totalReturnPct:own.totalReturnPct??null,
    priceOnlyReturnPct:own.priceOnlyReturnPct??null,
    profitFactor:own.profitFactor??null,
    sharpe:own.sharpe??null,
    maxDrawdownPct:own.maxDrawdownPct??null,
    positiveWindows:own.positiveWindows??0,
    fundingContributionPct:own.fundingContributionPct??null,
    priceContributionPct:own.priceContributionPct??null,
    costContributionPct:own.costContributionPct??null,
    longGrossContributionPct:own.longGrossContributionPct??null,
    shortGrossContributionPct:own.shortGrossContributionPct??null,
    positiveAssets:own.positiveAssets??0,
    positivePnlConcentrationPct:own.positivePnlConcentrationPct??null,
    turnover:own.turnover??null,
    attributionPct:own.attributionPct??{}
  },
  crossSectionalBenchmark:{
    totalReturnPct:bench.totalReturnPct??null,
    priceOnlyReturnPct:bench.priceOnlyReturnPct??null,
    profitFactor:bench.profitFactor??null,
    sharpe:bench.sharpe??null,
    maxDrawdownPct:bench.maxDrawdownPct??null,
    activeWeeks:bench.activeWeeks??0
  },
  costStress:{
    totalReturnPct:stress.totalReturnPct??null,
    priceOnlyReturnPct:stress.priceOnlyReturnPct??null,
    profitFactor:stress.profitFactor??null,
    sharpe:stress.sharpe??null,
    maxDrawdownPct:stress.maxDrawdownPct??null
  },
  gate:result.gate,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'self-history-perp-factor-v1-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'self-history-perp-factor-v1-full.json'),JSON.stringify({summary,result},null,2)+'\n');

const fmt=x=>Number.isFinite(Number(x))?Number(x).toFixed(3):'n/a';
const md=`# Self-History Perpetual Factor V1 — Discovery

Generated: ${summary.generatedAt}

Official Binance Vision USD-M 8h + funding data.  
Discovery: 2022-04-04 through final exit 2024-12-30 UTC.

| Metric | Own-history | Cross-sectional | 4x-cost stress |
|---|---:|---:|---:|
| Net return | ${fmt(summary.ownHistory.totalReturnPct)}% | ${fmt(summary.crossSectionalBenchmark.totalReturnPct)}% | ${fmt(summary.costStress.totalReturnPct)}% |
| Price-only return | ${fmt(summary.ownHistory.priceOnlyReturnPct)}% | ${fmt(summary.crossSectionalBenchmark.priceOnlyReturnPct)}% | ${fmt(summary.costStress.priceOnlyReturnPct)}% |
| Profit Factor | ${fmt(summary.ownHistory.profitFactor)} | ${fmt(summary.crossSectionalBenchmark.profitFactor)} | ${fmt(summary.costStress.profitFactor)} |
| Sharpe | ${fmt(summary.ownHistory.sharpe)} | ${fmt(summary.crossSectionalBenchmark.sharpe)} | ${fmt(summary.costStress.sharpe)} |
| Max DD | ${fmt(summary.ownHistory.maxDrawdownPct)}% | ${fmt(summary.crossSectionalBenchmark.maxDrawdownPct)}% | ${fmt(summary.costStress.maxDrawdownPct)}% |
| Active weeks | ${summary.ownHistory.activeWeeks} | ${summary.crossSectionalBenchmark.activeWeeks} | ${stress.activeWeeks??0} |

Positive windows: ${summary.ownHistory.positiveWindows}/5  
Positive assets: ${summary.ownHistory.positiveAssets}/${summary.assets.length}  
Long gross contribution: ${fmt(summary.ownHistory.longGrossContributionPct)}%  
Short gross contribution: ${fmt(summary.ownHistory.shortGrossContributionPct)}%  
Funding contribution: ${fmt(summary.ownHistory.fundingContributionPct)}%  
Modeled base cost contribution: ${fmt(summary.ownHistory.costContributionPct)}%

**Gate:** ${summary.gate?.pass?'PASS':'FAIL'}  
**Reasons:** ${(summary.gate?.reasons||[]).join(', ')||'none'}  
**Decision:** ${summary.decision}

Research only. A discovery pass authorizes only the preregistered temporal holdout.
`;
fs.writeFileSync(path.join(OUT,'self-history-perp-factor-v1.md'),md);
console.log(JSON.stringify(summary,null,2));
