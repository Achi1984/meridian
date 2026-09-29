import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS,
  SPOT_PERP_FUNDING_PERSISTENCE_V2_RULESET,
  runSpotPerpFundingPersistenceV2
} from './spot-perp-funding-persistence-v2.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=process.env.SPOT_PERP_V2_DATA_DIR||'/tmp/meridian-spot-perp-v2';
const OUT=path.join(ROOT,'research','results');
const months=[
  '2025-09','2025-10','2025-11','2025-12',
  '2026-01','2026-02','2026-03','2026-04',
  '2026-05','2026-06','2026-07','2026-08'
];

const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const raw={};
for(const asset of SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS){
  raw[asset]=JSON.parse(fs.readFileSync(path.join(DATA,asset+'.json'),'utf8'));
}
const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'manifest.json'),'utf8'));
const result=runSpotPerpFundingPersistenceV2(raw,{tradeMonths:months});

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SPOT_PERP_FUNDING_PERSISTENCE_V2_RULESET,
  stage:'INDEPENDENT_VALIDATION',
  rawWindow:'2025-08..2026-08',
  tradeWindow:'2025-09..2026-08',
  source:'Binance Vision public Spot 8h + USD-M Perp Trade 8h + Funding archives',
  assets:[...SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS],
  collected:manifest.files,
  stateSlots:result.stateSlots,
  validStateSlots:result.validStateSlots,
  rejectedStateSlots:result.rejectedStateSlots,
  dataIntegrityFailure:result.dataIntegrityFailure,
  activeStateMonths:result.activeStateMonths,
  inactiveStateMonths:result.inactiveStateMonths,
  entryTransitions:result.entryTransitions,
  exitTransitions:result.exitTransitions,
  continuationMonths:result.continuationMonths,
  forcedTerminalExits:result.forcedTerminalExits,
  summary:result.summary,
  stressSummary:result.stressSummary,
  positiveWindows:result.positiveWindows,
  windows:result.windows,
  positiveAssets:result.positiveAssets,
  positiveConcentrationPct:result.positiveConcentrationPct,
  persistenceDiagnostics:result.persistenceDiagnostics,
  byAsset:result.byAsset,
  gate:result.gate,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'spot-perp-funding-persistence-v2-summary.json');
const fp=path.join(OUT,'spot-perp-funding-persistence-v2-full.json');
const mp=path.join(OUT,'spot-perp-funding-persistence-v2.md');

fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const attrs=result.byAsset.map(x=>`| ${x.asset} | ${x.activeMonths} | ${x.entryTransitions} | ${x.continuationMonths} | $${x.netPnl.toFixed(2)} | $${x.fundingPnl.toFixed(2)} | $${x.basisPnl.toFixed(2)} | $${x.costs.toFixed(2)} |`).join('\n');

const md=`# Spot-Perp Funding Persistence V2 — Independent Validation

Generated: ${summary.generatedAt}

This is the first independent V2 evaluation. The seen V1 discovery interval is not reused as independent evidence.

| Metric | Result |
|---|---:|
| State slots | ${result.stateSlots} |
| Valid slots | ${result.validStateSlots} |
| Active state-months | ${result.activeStateMonths} |
| Inactive state-months | ${result.inactiveStateMonths} |
| Entry transitions | ${result.entryTransitions} |
| Exit transitions | ${result.exitTransitions} |
| Continuation months | ${result.continuationMonths} |
| Forced terminal exits | ${result.forcedTerminalExits} |
| Net return | ${result.summary.totalReturnPct.toFixed(4)}% |
| Net PnL | $${result.summary.totalNetPnl.toFixed(2)} |
| Funding PnL | $${result.summary.totalFundingPnl.toFixed(2)} |
| Spot+Perp price/basis PnL | $${result.summary.totalBasisPnl.toFixed(2)} |
| Base transition costs | $${result.summary.totalCosts.toFixed(2)} |
| Funding/base-cost ratio | ${Number(result.summary.fundingCostRatio||0).toFixed(4)} |
| Profit Factor | ${result.summary.profitFactor.toFixed(4)} |
| Max drawdown | ${result.summary.maxDrawdownPct.toFixed(4)}% |
| Positive windows | ${result.positiveWindows}/5 |
| Stress return | ${result.stressSummary.totalReturnPct.toFixed(4)}% |
| Positive assets | ${result.positiveAssets}/8 |
| Positive concentration | ${result.positiveConcentrationPct.toFixed(2)}% |
| Mean episode duration | ${result.persistenceDiagnostics.meanEpisodeDurationMonths.toFixed(2)} months |
| Max episode duration | ${result.persistenceDiagnostics.maxEpisodeDurationMonths} months |

## Asset attribution

| Asset | Active months | Entries | Continuations | Net PnL | Funding PnL | Basis PnL | Costs |
|---|---:|---:|---:|---:|---:|---:|---:|
${attrs}

**Gate:** ${result.gate.pass?'PASS':'FAIL'}

**Decision:** ${result.decision}

Gate reasons: ${result.gate.reasons.join(', ')||'none'}

Research only. A PASS authorizes only a separate prospective Paper shadow, never live execution.
`;

fs.writeFileSync(mp,md);

summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');

console.log(JSON.stringify(summary,null,2));
