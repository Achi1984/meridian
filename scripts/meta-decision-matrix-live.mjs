#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildSignalCohort, cohortSummary } from '../adaptive-evidence-cohorts.js';
import { matricesFromCohort, META_MATRIX_SOURCE_VERSION } from '../meta-decision-matrix-source.js';
import { decisionMatrixEvidence, META_MATRIX_EVIDENCE_VERSION } from '../meta-decision-matrix-evidence.js';

const DAY=86400000;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const dataEnd=Date.now(),horizonDays=14,windowsDays=[30,60,90],outBase='research/generated/meta-decision-matrix-v780-r2';
const source=await loadPreparedAdaptiveEvents({assets:ASSETS,windowsDays,horizonDays,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`)}});
const signalEnd=dataEnd-horizonDays*DAY,masterStart=signalEnd-90*DAY;
const master=buildSignalCohort(source.events,{start:masterStart,end:dataEnd,horizonDays,requireFullHorizon:true}).filter(r=>r.ts>=masterStart&&r.ts<=signalEnd);
const windows={};
for(const d of windowsDays){
  const rows=master.filter(r=>r.ts>=signalEnd-d*DAY&&r.ts<=signalEnd);
  const matrices=matricesFromCohort(source.events,rows);
  windows[`${d}d`]={cohort:cohortSummary(rows),matrixCount:matrices.length,evidence:decisionMatrixEvidence(matrices)};
}
const report={version:'7.80-R2-META-DECISION-MATRIX-LIVE',sourceVersion:META_MATRIX_SOURCE_VERSION,evidenceVersion:META_MATRIX_EVIDENCE_VERSION,researchOnly:true,executionImpact:false,assets:ASSETS,dataEnd,signalEnd,horizonDays,masterCohort:cohortSummary(master),windows,promotion:{allowed:false,reason:'ATTRIBUTION_ONLY'},generatedAt:new Date().toISOString()};
const lines=[`# MERIDIAN ${report.version}`,'','> Research-only. Baseline/Paper execution unchanged.','',`Source outcome geometry: **A_CURRENT baseline-side**. Regime side conflict is evaluated as a quality/risk signal, not as alternate-side P&L.`,''];
for(const [label,w] of Object.entries(windows)){
  const e=w.evidence;
  lines.push(`## ${label}`,'',`Cohort: **${e.all.n}** · avg ${e.all.avgR?.toFixed(3)??'—'}R · PF ${e.all.pf}`,'','### Support count','', '| Class | n | Avg R | PF | Win rate |','| --- | ---: | ---: | ---: | ---: |');
  for(const x of e.bySupport)lines.push(`| ${x.key} | ${x.n} | ${x.avgR==null?'—':x.avgR.toFixed(3)+'R'} | ${x.pf} | ${x.winRate??'—'}% |`);
  lines.push('','### Conflict / disagreement','','| Class | n | Avg R | PF |','| --- | ---: | ---: | ---: |');
  for(const x of [...e.bySideConflict,...e.byHardDisagreement])lines.push(`| ${x.key} | ${x.n} | ${x.avgR==null?'—':x.avgR.toFixed(3)+'R'} | ${x.pf} |`);
  lines.push('');
}
lines.push('## Decision','','No routing or risk policy is authorized by this report. Any allocator policy requires OOS validation of predeclared matrix classes.','');
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({ok:true,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
