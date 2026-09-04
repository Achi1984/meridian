#!/usr/bin/env node
// MERIDIAN v7.77 — focused SIDE_REGIME_VOLATILITY OOS attribution. Research-only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildSignalCohort, cohortSummary } from '../adaptive-evidence-cohorts.js';
import { drilldownVolatilityContext, VOLATILITY_DRILLDOWN_VERSION } from '../volatility-context-drilldown.js';

const DAY=86400000;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const arg=(n,f=null)=>{const i=process.argv.indexOf(`--${n}`);return i>=0?process.argv[i+1]:f};
const windowsDays=[30,60,90],horizonDays=14,dataEnd=arg('end')?Number(arg('end')):Date.now(),outBase=arg('out','research/generated/volatility-context-drilldown-v777');
const source=await loadPreparedAdaptiveEvents({assets:ASSETS,windowsDays,horizonDays,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`)}});
const signalEnd=dataEnd-horizonDays*DAY,anchorStart=signalEnd-90*DAY;
const master=buildSignalCohort(source.events,{start:anchorStart,end:dataEnd,horizonDays,requireFullHorizon:true}).filter(r=>r.ts>=anchorStart&&r.ts<=signalEnd);
const windows={};
for(const d of windowsDays){
  const rows=master.filter(r=>r.ts>=signalEnd-d*DAY&&r.ts<=signalEnd);
  windows[`${d}d`]={cohort:cohortSummary(rows),drilldown:drilldownVolatilityContext(rows,{slices:5,trainWindowCount:4})};
}
const report={version:VOLATILITY_DRILLDOWN_VERSION,researchOnly:true,executionImpact:false,method:'FOCUSED_SIDE_REGIME_VOLATILITY_EXPANDING_OOS_ATTRIBUTION',assets:ASSETS,dataEnd,signalEnd,horizonDays,masterCohort:cohortSummary(master),windows,promotion:{allowed:false,reason:'FOCUSED_ATTRIBUTION_ONLY'},generatedAt:new Date().toISOString()};
const lines=[`# MERIDIAN ${report.version} — Volatility Context Drilldown`,'','> Research-only. No Paper execution impact.',''];
for(const [label,w] of Object.entries(windows)){
  const a=w.drilldown.aggregate?.selected||{};
  lines.push(`## ${label}`,'',`Selected: **${a.n||0}** · avg ${a.avgR==null?'—':a.avgR.toFixed(3)+'R'} · PF ${a.pf??0}`,'','| Context | n | Avg R | PF | Active folds | Positive folds | Max asset share |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for(const x of w.drilldown.contexts)lines.push(`| ${x.key} | ${x.n} | ${x.avgR==null?'—':x.avgR.toFixed(3)+'R'} | ${x.pf} | ${x.activeFolds} | ${x.positiveFolds} | ${x.maxAssetSharePct.toFixed(1)}% |`);
  lines.push('');
}
lines.push('## Promotion status','','**NO PROMOTION.** This report only checks whether the positive family-level result comes from repeatable contexts rather than one fold or asset.','');
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({ok:true,version:report.version,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
