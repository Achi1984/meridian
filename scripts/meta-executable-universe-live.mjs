#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildSignalCohort, cohortSummary } from '../adaptive-evidence-cohorts.js';
import { matricesFromCohort } from '../meta-decision-matrix-source.js';
import { executableUniverseEvidence, META_EXEC_UNIVERSE_VERSION } from '../meta-executable-universe-evidence.js';

const DAY=86400000;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const windowsDays=[30,60,90],horizonDays=14,dataEnd=Date.now(),outBase='research/generated/meta-executable-universe-v780-r3';
const source=await loadPreparedAdaptiveEvents({assets:ASSETS,windowsDays,horizonDays,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`)}});
const signalEnd=dataEnd-horizonDays*DAY,masterStart=signalEnd-90*DAY;
const master=buildSignalCohort(source.events,{start:masterStart,end:dataEnd,horizonDays,requireFullHorizon:true}).filter(r=>r.ts>=masterStart&&r.ts<=signalEnd);
const windows={};
for(const d of windowsDays){
  const cohort=master.filter(r=>r.ts>=signalEnd-d*DAY&&r.ts<=signalEnd),matrices=matricesFromCohort(source.events,cohort),evidence=executableUniverseEvidence(matrices,{folds:5});
  windows[`${d}d`]={cohort:cohortSummary(cohort),matrixCount:matrices.length,evidence};
}
const report={version:META_EXEC_UNIVERSE_VERSION,researchOnly:true,executionImpact:false,method:'PREDECLARED_EXECUTABLE_UNIVERSE_ATTRIBUTION_WITH_CHRONOLOGICAL_FOLDS',assets:ASSETS,dataEnd,signalEnd,horizonDays,masterCohort:cohortSummary(master),windows,promotion:{allowed:false,reason:'ATTRIBUTION_ONLY'},generatedAt:new Date().toISOString()};
const lines=[`# MERIDIAN ${report.version}`,'','> Research-only. No routing, sizing or Paper execution changes.','',`Outcome geometry remains **A_CURRENT baseline-side**.`,''];
for(const [label,w] of Object.entries(windows)){
  lines.push(`## ${label}`,'',`Cohort: **${w.evidence.all.n}** · avg ${w.evidence.all.avgR?.toFixed(3)??'—'}R · PF ${w.evidence.all.pf}`,'','### Universes','', '| Universe | n | Avg R | PF | Positive folds | Active folds |','| --- | ---: | ---: | ---: | ---: | ---: |');
  for(const x of w.evidence.universes)lines.push(`| ${x.key} | ${x.n} | ${x.avgR==null?'—':x.avgR.toFixed(3)+'R'} | ${x.pf} | ${x.positiveFolds} | ${x.activeFolds} |`);
  lines.push('','### Predeclared subclasses','', '| Class | n | Avg R | PF | Positive folds | Active folds |','| --- | ---: | ---: | ---: | ---: | ---: |');
  for(const x of w.evidence.subclasses)lines.push(`| ${x.key} | ${x.n} | ${x.avgR==null?'—':x.avgR.toFixed(3)+'R'} | ${x.pf} | ${x.positiveFolds} | ${x.activeFolds} |`);
  lines.push('');
  if(w.evidence.candidateClasses.length){lines.push('Candidate classes (research only):',...w.evidence.candidateClasses.map(x=>`- ${x.key}: n=${x.n}, avg=${x.avgR}R, PF=${x.pf}, folds ${x.positiveFolds}/${x.activeFolds}`),'');}
}
lines.push('## Decision','','No allocator policy is authorized. A class must repeat across windows and later survive a strict train-before-test allocator replay before risk multipliers are considered.','');
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({ok:true,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
