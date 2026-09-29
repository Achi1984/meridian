import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {
  SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS,
  SPOT_PERP_BASIS_DISLOCATION_V1_RULESET,
  runSpotPerpBasisDislocationV1
} from './spot-perp-basis-dislocation-v1.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=process.env.SPOT_PERP_BASIS_V1_DATA_DIR||'/tmp/meridian-spot-perp-basis-v1';
const OUT=path.join(ROOT,'research','results');

const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'manifest.json'),'utf8'));

if(manifest?.holdoutLoaded!==false)throw new Error('HOLDOUT_GUARD:holdoutLoaded must be false');
if(manifest?.range?.start!=='2024-06'||manifest?.range?.end!=='2025-08'){
  throw new Error('HOLDOUT_GUARD:unexpected discovery data range');
}

const raw={};
for(const asset of SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS){
  raw[asset]=JSON.parse(fs.readFileSync(path.join(DATA,asset+'.json'),'utf8'));
}

const result=runSpotPerpBasisDislocationV1(raw,{stage:'DISCOVERY'});

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SPOT_PERP_BASIS_DISLOCATION_V1_RULESET,
  stage:'DISCOVERY',
  rawWindow:'2024-06..2025-08',
  signalWindow:'2024-09..2025-08',
  holdoutLoaded:false,
  source:'Binance Vision public Spot 8h + USD-M Perp Trade 8h + Funding archives',
  assets:[...SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS],
  collected:manifest.files,
  dataIntegrityFailure:result.dataIntegrityFailure,
  dataIntegrityErrors:result.dataIntegrityErrors,
  eligibleSignalEvaluations:result.eligibleSignalEvaluations,
  percentileQualifiedSignals:result.percentileQualifiedSignals,
  cancelledByExecutionBasis:result.cancelledByExecutionBasis,
  completedTrades:result.completedTrades,
  activeMonths:result.activeMonths,
  summary:result.summary,
  stressSummary:result.stressSummary,
  mtmMaxDrawdownPct:result.mtmMaxDrawdownPct,
  positiveWindows:result.positiveWindows,
  windows:result.windows,
  positiveAssets:result.positiveAssets,
  positiveConcentrationPct:result.positiveConcentrationPct,
  diagnostics:result.diagnostics,
  byAsset:result.byAsset,
  gate:result.gate,
  decision:result.decision,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'spot-perp-basis-dislocation-v1-summary.json');
const fp=path.join(OUT,'spot-perp-basis-dislocation-v1-full.json');
const mp=path.join(OUT,'spot-perp-basis-dislocation-v1.md');

fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const attrs=result.byAsset.map(x=>
  `| ${x.asset} | ${x.completedTrades} | $${x.netPnl.toFixed(2)} | $${x.basisPnl.toFixed(2)} | $${x.fundingPnl.toFixed(2)} |`
).join('\n');

const md=`# Spot-Perp Basis Dislocation V1 — Discovery

Generated: ${summary.generatedAt}

This is the first strategy-PnL evaluation after the 8/8 synchronized data-foundation PASS.

| Metric | Result |
|---|---:|
| Eligible signal evaluations | ${result.eligibleSignalEvaluations} |
| 95th-percentile qualified signals | ${result.percentileQualifiedSignals} |
| Cancelled by execution basis | ${result.cancelledByExecutionBasis} |
| Completed trades | ${result.completedTrades} |
| Active months | ${result.activeMonths} |
| Net return | ${result.summary.totalReturnPct.toFixed(4)}% |
| Net PnL | $${result.summary.totalNetPnl.toFixed(2)} |
| Basis/price PnL | $${result.summary.totalBasisPnl.toFixed(2)} |
| Funding PnL | $${result.summary.totalFundingPnl.toFixed(2)} |
| Base costs | $${result.summary.totalCosts.toFixed(2)} |
| Gross-edge/base-cost ratio | ${Number(result.summary.grossEdgeCostRatio||0).toFixed(4)} |
| Profit Factor | ${result.summary.profitFactor.toFixed(4)} |
| Win rate | ${(result.summary.winRate*100).toFixed(2)}% |
| Closed/monthly max DD | ${result.summary.maxDrawdownPct.toFixed(4)}% |
| 8h MTM max DD | ${result.mtmMaxDrawdownPct.toFixed(4)}% |
| Positive windows | ${result.positiveWindows}/5 |
| Stress return | ${result.stressSummary.totalReturnPct.toFixed(4)}% |
| Positive assets | ${result.positiveAssets}/8 |
| Positive concentration | ${result.positiveConcentrationPct.toFixed(2)}% |
| Basis compression rate | ${((result.diagnostics.compressionRate||0)*100).toFixed(2)}% |

## Asset attribution

| Asset | Trades | Net PnL | Basis PnL | Funding PnL |
|---|---:|---:|---:|---:|
${attrs}

**Gate:** ${result.gate.pass?'PASS':'FAIL'}

**Decision:** ${result.decision}

Gate reasons: ${result.gate.reasons.join(', ')||'none'}

Research only. A Discovery PASS authorizes only the frozen temporal holdout, never Paper or live execution.
`;
fs.writeFileSync(mp,md);

summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');

console.log(JSON.stringify(summary,null,2));
