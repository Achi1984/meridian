#!/usr/bin/env node
// MERIDIAN v7.79 — prospective locked holdout report. Research-only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildSignalCohort } from '../adaptive-evidence-cohorts.js';
import { evaluateProspectiveHoldout, PROSPECTIVE_HOLDOUT_VERSION, HOLDOUT_START_MS, HOLDOUT_START_UTC, HORIZON_DAYS, RAW_CONTEXT } from '../prospective-holdout.js';

const DAY=86400000;
const ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const dataEnd=Date.now();
const lookbackDays=Math.max(30,Math.ceil((dataEnd-HOLDOUT_START_MS)/DAY)+HORIZON_DAYS+2);
const outBase='research/generated/prospective-holdout-v779';
console.log(`[MERIDIAN] v7.79 prospective holdout from ${HOLDOUT_START_UTC}; lookback ${lookbackDays}d`);
const source=await loadPreparedAdaptiveEvents({assets:ASSETS,windowsDays:[lookbackDays],horizonDays:HORIZON_DAYS,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`)}});
const rows=buildSignalCohort(source.events,{start:HOLDOUT_START_MS,end:dataEnd,horizonDays:HORIZON_DAYS,requireFullHorizon:true}).filter(r=>r.ts>=HOLDOUT_START_MS);
const result=evaluateProspectiveHoldout(rows,{nowMs:dataEnd});
const report={version:PROSPECTIVE_HOLDOUT_VERSION,researchOnly:true,executionImpact:false,method:'LOCKED_POST_DISCOVERY_PROSPECTIVE_HOLDOUT',assets:ASSETS,dataEnd,holdoutStartUtc:HOLDOUT_START_UTC,horizonDays:HORIZON_DAYS,hypothesis:RAW_CONTEXT,result,promotion:{allowed:false,reason:'HOLDOUT_REQUIRES_MATURED_SAMPLE_AND_HUMAN_REVIEW'},generatedAt:new Date().toISOString()};
const lines=[`# MERIDIAN ${report.version} — Prospective Holdout`,'','> Research-only. Hypothesis and start time were frozen before future outcomes matured.','',`Holdout start: **${HOLDOUT_START_UTC}**`,`Outcome horizon: **${HORIZON_DAYS} days**`,`Locked context: **${RAW_CONTEXT}**`,'',`Matured universe: ${result.maturedUniverse.n}`,`Matured locked-context signals: **${result.rawContext.n}**`,`Avg R: ${result.rawContext.avgR??'—'}`,`PF: ${result.rawContext.pf??0}`,`Status: **${result.readiness.status}**`,'','## Rule','','Do not alter the context, horizon, sample threshold or outcome model during this holdout. If the hypothesis changes, start a new holdout version/date rather than rewriting v7.79.','','## Promotion status','','**NO PROMOTION.** Review only after at least 30 fully matured locked-context signals and explicit human approval.',''];
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,lines.join('\n')+'\n');
console.log(JSON.stringify({ok:true,version:report.version,status:result.readiness.status,maturedContext:result.rawContext.n,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
