import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  SPOT_PERP_FUNDING_HARVEST_V2_ASSETS,
  SPOT_PERP_FUNDING_HARVEST_V2_RULESET,
  runSpotPerpFundingHarvestV2
} from './spot-perp-funding-harvest-v2-persistent.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=process.env.SPOT_PERP_V2_DATA_DIR||'/tmp/meridian-spot-perp-v2';
const OUT=path.join(ROOT,'research','results');
const months=[
  '2024-10','2024-11','2024-12','2025-01','2025-02','2025-03',
  '2025-04','2025-05','2025-06','2025-07','2025-08'
];

const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const raw={};
for(const asset of SPOT_PERP_FUNDING_HARVEST_V2_ASSETS){
  raw[asset]=JSON.parse(fs.readFileSync(path.join(DATA,asset+'.json'),'utf8'));
}
const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'manifest.json'),'utf8'));

const result=runSpotPerpFundingHarvestV2(raw,{tradeMonths:months,stage:'DEVELOPMENT'});

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SPOT_PERP_FUNDING_HARVEST_V2_RULESET,
  stage:'DEVELOPMENT',
  rawWindow:'2024-09..2025-08',
  tradeWindow:'2024-10..2025-08',
  source:'Binance Vision public Spot 8h + USD-M Perp Trade 8h + Funding archives',
  assets:[...SPOT_PERP_FUNDING_HARVEST_V2_ASSETS],
  collected:manifest.files,
  decisionSlots:result.decisionSlots,
  validDecisionSlots:result.validDecisionSlots,
  rejectedDecisionSlots:result.rejectedDecisionSlots,
  dataIntegrityFailure:result.dataIntegrityFailure,
  exposureMonths:result.exposureMonths,
  entryEvents:result.entryEvents,
  exitEvents:result.exitEvents,
  persistentHoldMonths:result.persistentHoldMonths,
  averageHoldingStreakLength:result.averageHoldingStreakLength,
  summary:result.summary,
  stressSummary:result.stressSummary,
  positiveWindows:result.positiveWindows,
  windows:result.windows,
  positiveAssets:result.positiveAssets,
  positiveConcentrationPct:result.positiveConcentrationPct,
  byAsset:result.byAsset,
  gate:result.gate,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'spot-perp-funding-harvest-v2-persistent-summary.json');
const fp=path.join(OUT,'spot-perp-funding-harvest-v2-persistent-full.json');
const mp=path.join(OUT,'spot-perp-funding-harvest-v2-persistent.md');

fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const attrs=result.byAsset.map(x=>
  `| ${x.asset} | ${x.exposureMonths} | ${x.entryEvents} | ${x.exitEvents} | ${x.persistentHoldMonths} | $${x.netPnl.toFixed(2)} | $${x.fundingPnl.toFixed(2)} | $${x.basisPnl.toFixed(2)} |`
).join('\n');

const md=`# Spot-Perp Funding Harvest V2 Persistent Carry — Development

Generated: ${summary.generatedAt}

| Metric | Result |
|---|---:|
| Decision slots | ${result.decisionSlots} |
| Exposure months | ${result.exposureMonths} |
| Entry events | ${result.entryEvents} |
| Exit events | ${result.exitEvents} |
| Persistent hold months | ${result.persistentHoldMonths} |
| Avg holding streak | ${result.averageHoldingStreakLength.toFixed(3)} |
| Net return | ${result.summary.totalReturnPct.toFixed(4)}% |
| Net PnL | $${result.summary.totalNetPnl.toFixed(2)} |
| Funding PnL | $${result.summary.totalFundingPnl.toFixed(2)} |
| Spot+Perp price/basis PnL | $${result.summary.totalBasisPnl.toFixed(2)} |
| Base costs | $${result.summary.totalCosts.toFixed(2)} |
| Funding/base-cost ratio | ${Number(result.summary.fundingCostRatio||0).toFixed(4)} |
| Profit Factor | ${result.summary.profitFactor.toFixed(4)} |
| Max drawdown | ${result.summary.maxDrawdownPct.toFixed(4)}% |
| Positive windows | ${result.positiveWindows}/5 |
| Stress return | ${result.stressSummary.totalReturnPct.toFixed(4)}% |
| Positive assets | ${result.positiveAssets}/8 |
| Positive concentration | ${result.positiveConcentrationPct.toFixed(2)}% |

## Asset attribution

| Asset | Exposure | Entries | Exits | Hold months | Net PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|---:|---:|
${attrs}

**Gate:** ${result.gate.pass?'PASS':'FAIL'}

**Decision:** ${result.decision}

Gate reasons: ${result.gate.reasons.join(', ')||'none'}

Research only. Development PASS authorizes only the frozen independent validation; it does not authorize Paper or live execution.
`;

fs.writeFileSync(mp,md);

summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');

console.log(JSON.stringify(summary,null,2));
