import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {
  SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS,
  SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_RULESET,
  runSpotPerpBasisVolatilityRegimeV1
} from './spot-perp-basis-volatility-regime-v1.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=process.env.SPOT_PERP_BASIS_V1_DATA_DIR||'/tmp/meridian-spot-perp-basis-v1';
const OUT=path.join(ROOT,'research','results');

const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const manifest=JSON.parse(fs.readFileSync(path.join(DATA,'manifest.json'),'utf8'));
if(manifest?.holdoutLoaded!==false)throw new Error('HOLDOUT_GUARD:holdoutLoaded must be false');
if(manifest?.range?.start!=='2024-06'||manifest?.range?.end!=='2025-08'){
  throw new Error('HOLDOUT_GUARD:unexpected feature-discovery data range');
}

const raw={};
for(const asset of SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS){
  raw[asset]=JSON.parse(fs.readFileSync(path.join(DATA,asset+'.json'),'utf8'));
}

const result=runSpotPerpBasisVolatilityRegimeV1(raw,{stage:'DISCOVERY'});

const summary={
  generatedAt:new Date().toISOString(),
  ruleset:SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_RULESET,
  stage:'FEATURE_DISCOVERY',
  rawWindow:'2024-06..2025-08',
  anchorWindow:'2024-09-01..2025-08-30',
  holdoutLoaded:false,
  source:'Binance Vision public synchronized Spot 8h + USD-M Perp Trade 8h archives',
  assets:[...SPOT_PERP_BASIS_VOLATILITY_REGIME_V1_ASSETS],
  collected:manifest.files,
  anchors:result.anchors,
  dataIntegrityFailure:result.dataIntegrityFailure,
  dataIntegrityErrors:result.dataIntegrityErrors,
  byAsset:result.byAsset,
  pooled:result.pooled,
  stability:result.stability,
  gate:result.gate,
  decision:result.decision,
  strategyPnlCalculated:false,
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false
};

fs.mkdirSync(OUT,{recursive:true});
const sp=path.join(OUT,'spot-perp-basis-volatility-regime-v1-summary.json');
const fp=path.join(OUT,'spot-perp-basis-volatility-regime-v1-full.json');
const mp=path.join(OUT,'spot-perp-basis-volatility-regime-v1.md');

fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(fp,JSON.stringify({summary,result},null,2)+'\n');

const rows=result.byAsset.map(x=>
  `| ${x.asset} | ${x.observations} | ${Number(x.spearmanBasisForward||0).toFixed(4)} | ${Number(x.partialSpearmanBasisForwardControllingLag||0).toFixed(4)} | ${Number(x.topQuartileUpliftRatio||0).toFixed(4)} |`
).join('\n');

const windows=result.stability.windows.map(x=>
  `| ${x.index} | ${x.anchors} | ${Number(x.spearmanBasisForward||0).toFixed(4)} |`
).join('\n');

const md=`# Spot-Perp Basis-Volatility Regime V1 — Feature Discovery

Generated: ${summary.generatedAt}

No trading strategy or strategy PnL is evaluated in this stage.

| Metric | Result |
|---|---:|
| Daily anchors | ${result.anchors} |
| Data-integrity failure | ${result.dataIntegrityFailure?'YES':'NO'} |
| Pooled Spearman | ${Number(result.pooled.spearmanBasisForward||0).toFixed(4)} |
| Pooled partial Spearman vs lagged RV | ${Number(result.pooled.partialSpearmanBasisForwardControllingLag||0).toFixed(4)} |
| Pooled top-quartile uplift | ${Number(result.pooled.topQuartileUpliftRatio||0).toFixed(4)} |
| Positive windows | ${result.stability.positiveWindows}/5 |

## Per-asset feature results

| Asset | Obs | Spearman | Partial Spearman | Top-quartile uplift |
|---|---:|---:|---:|---:|
${rows}

## Stability

| Window | Anchors | Pooled Spearman |
|---|---:|---:|
${windows}

**Gate:** ${result.gate.pass?'PASS':'FAIL'}

**Decision:** ${result.decision}

Gate reasons: ${result.gate.reasons.join(', ')||'none'}

Feature research only. A Discovery PASS authorizes only the frozen temporal feature holdout, never a trading strategy, Paper or live execution.
`;
fs.writeFileSync(mp,md);

summary.artifactHashes={
  summaryPrehashSha256:sha256(sp),
  fullSha256:sha256(fp),
  markdownSha256:sha256(mp)
};
fs.writeFileSync(sp,JSON.stringify(summary,null,2)+'\n');

console.log(JSON.stringify(summary,null,2));
