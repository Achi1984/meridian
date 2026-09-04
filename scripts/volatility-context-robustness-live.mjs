#!/usr/bin/env node
// MERIDIAN v7.78 — fixed LONG|TRANSITION|NORMAL robustness report. Research-only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildSignalCohort, cohortSummary } from '../adaptive-evidence-cohorts.js';
import { robustnessSummary, VOLATILITY_ROBUSTNESS_VERSION, PREDECLARED_CONTEXT } from '../volatility-context-robustness.js';

const DAY=86400000;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const dataEnd=Date.now(),horizonDays=14,signalEnd=dataEnd-horizonDays*DAY,anchorStart=signalEnd-90*DAY;
const outBase='research/generated/volatility-context-robustness-v778';
console.log(`[MERIDIAN] v7.78 robustness: ${PREDECLARED_CONTEXT}`);
const source=await loadPreparedAdaptiveEvents({assets:ASSETS,windowsDays:[90],horizonDays,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`)}});
const rows=buildSignalCohort(source.events,{start:anchorStart,end:dataEnd,horizonDays,requireFullHorizon:true}).filter(r=>r.ts>=anchorStart&&r.ts<=signalEnd);
const result=robustnessSummary(rows,{temporalBuckets:6});
const report={version:VOLATILITY_ROBUSTNESS_VERSION,researchOnly:true,executionImpact:false,method:'PREDECLARED_CONTEXT_SAME_SAMPLE_ROBUSTNESS',assets:ASSETS,context:PREDECLARED_CONTEXT,dataEnd,signalEnd,horizonDays,cohort:cohortSummary(rows),result,promotion:{allowed:false,reason:'REQUIRES_FUTURE_HOLDOUT'},generatedAt:new Date().toISOString()};
const lines=[`# MERIDIAN ${report.version} — Context Robustness`,'','> Research-only. Same-sample stress test; not independent validation.','',`Context: **${PREDECLARED_CONTEXT}**`,'',`Overall: n=${result.overall.n}, avgR=${result.overall.avgR??'—'}, PF=${result.overall.pf??0}`,'',`Temporal buckets positive: ${result.diagnostics.positiveTemporalBuckets}/${result.diagnostics.activeTemporalBuckets}`,'',`Leave-one-asset-out positive: ${result.diagnostics.positiveLooCases}/${result.diagnostics.adequateLooCases}`,'',`Robustness gate: **${result.robustnessGate.passed?'PASS':'FAIL'}**`,'',`Note: ${result.robustnessGate.note}`,'','## Temporal buckets','','| Bucket | n | Avg R | PF |','| --- | ---: | ---: | ---: |'];
for(const x of result.temporal)lines.push(`| ${x.id} | ${x.n} | ${x.avgR??'—'} | ${x.pf??0} |`);
lines.push('','## Leave-one-asset-out','','| Excluded | n | Avg R | PF |','| --- | ---: | ---: | ---: |');
for(const x of result.leaveOneAssetOut)lines.push(`| ${x.excludedAsset} | ${x.n} | ${x.avgR??'—'} | ${x.pf??0} |`);
lines.push('','## Promotion status','','**NO PROMOTION.** Even a robustness PASS is still discovery-sample evidence and requires future holdout data.','');
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({ok:true,version:report.version,gate:result.robustnessGate.passed,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
