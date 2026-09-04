// ACHI MERIDIAN Context Interaction Report — v7.75
// Research-only. Compares hierarchical residual interactions against v7.74 marginal Adaptive Evidence on identical cohorts.

import { buildSignalCohort, rollingWindows, cohortSummary } from './adaptive-evidence-cohorts.js';
import { expandingWalkForward } from './adaptive-evidence-walkforward.js';
import { buildInteractionEvidence } from './context-interaction-evidence.js';
import { expandingInteractionWalkForward } from './context-interaction-walkforward.js';

export const CONTEXT_INTERACTION_REPORT_VERSION='7.75-CONTEXT-INTERACTION-REPORT-V1';
const DAY=86400000;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function flattenInteractions(map={}){
  const out=[];
  for(const [specId,spec] of Object.entries(map.specs||{}))for(const g of Object.values(spec.groups||{}))out.push({spec:specId,key:g.childKey,parentKey:g.parentKey,childN:g.child?.n||0,parentN:g.parent?.n||0,childAvgR:g.child?.avgR,parentAvgR:g.parent?.avgR,rawResidualR:g.rawResidualR,residualR:g.residualR,reliability:g.reliability,windowAgreement:g.windowAgreement,windowCount:g.windowCount,eligible:g.eligible});
  return out.sort((a,b)=>b.reliability-a.reliability||Math.abs(b.residualR)-Math.abs(a.residualR));
}
function top(rows,sign,limit=12){return rows.filter(x=>x.eligible&&x.reliability>=.45&&Math.sign(x.residualR)===sign).sort((a,b)=>sign*(b.residualR-a.residualR)).slice(0,limit)}
function selectorSummary(wf={}){const a=wf.aggregate||{},s=a.selected||{},m=a.marketCapture||{};return{selected:s.n||0,avgR:s.avgR??null,pf:s.pf??0,winRate:s.winRate??null,totalR:s.totalR??0,coveragePct:m.coveragePct??0,marketCapturePct:m.marketCapturePct??0,missedWinnerR:m.missedWinnerR??0,avoidedLoserR:m.avoidedLoserR??0,opportunityCostR:m.opportunityCostR??0}}

export function buildContextInteractionReport(events=[],opts={}){
  const dataEnd=Number(opts.dataEnd??Math.max(...events.map(x=>Number(x.t||0))));
  const horizonDays=Math.max(1,Number(opts.horizonDays??14));
  const windowsDays=(opts.windowsDays||[30,60,90]).map(Number).filter(x=>x>0).sort((a,b)=>a-b);
  if(!(dataEnd>0)||!windowsDays.length)throw new Error('Context Interaction report requires dataEnd and windows');
  const signalEnd=dataEnd-horizonDays*DAY,anchorStart=signalEnd-Math.max(...windowsDays)*DAY;
  const masterRows=buildSignalCohort(events,{start:anchorStart,end:dataEnd,horizonDays,sampleEveryMs:opts.sampleEveryMs,feeBps:opts.feeBps,slippageBps:opts.slippageBps,requireFullHorizon:true}).filter(r=>r.ts>=anchorStart&&r.ts<=signalEnd);
  const windows={};
  for(const days of windowsDays){
    const start=signalEnd-days*DAY,rows=masterRows.filter(r=>r.ts>=start&&r.ts<=signalEnd),stability=rows.length?rollingWindows({start,end:signalEnd,count:opts.stabilityWindows||5}):[];
    const interactionMap=buildInteractionEvidence(rows,stability,opts.interactionOptions),flat=flattenInteractions(interactionMap);
    const marginal=expandingWalkForward(rows,{slices:opts.walkForwardSlices||5,evidenceOptions:opts.evidenceOptions});
    const interaction=expandingInteractionWalkForward(rows,{slices:opts.walkForwardSlices||5,interactionOptions:opts.interactionOptions});
    const m=selectorSummary(marginal),i=selectorSummary(interaction);
    windows[`${days}d`]={days,start,signalEnd,cohort:cohortSummary(rows),topPositiveResidual:top(flat,1),topNegativeResidual:top(flat,-1),marginal:{...m,version:marginal.version},interaction:{...i,version:interaction.version},delta:{avgR:i.avgR==null||m.avgR==null?null:round(i.avgR-m.avgR),pf:round(i.pf-m.pf),coveragePct:round(i.coveragePct-m.coveragePct,2),marketCapturePct:round(i.marketCapturePct-m.marketCapturePct,2)}};
  }
  return{version:CONTEXT_INTERACTION_REPORT_VERSION,researchOnly:true,executionImpact:false,method:'SAME_MASTER_COHORT_V774_MARGINAL_VS_V775_HIERARCHICAL_RESIDUAL_OOS',dataEnd,signalEnd,anchorStart,horizonDays,masterCohort:cohortSummary(masterRows),windows,promotion:{allowed:false,reason:'RESEARCH_ONLY_SIGNAL_EDGE_NOT_YET_VALIDATED'},generatedAt:new Date().toISOString()};
}

const r=v=>v==null?'—':`${Number(v).toFixed(3)}R`,p=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
export function renderContextInteractionMarkdown(report){
  const lines=[`# MERIDIAN ${report.version} — OOS Comparison`,'','> Research-only. Same master cohort; no Paper execution impact.','',`Method: ${report.method}`,`Outcome horizon: ${report.horizonDays} days.`, ''];
  for(const [label,w] of Object.entries(report.windows||{})){
    lines.push(`## ${label}`,'',`Cohort: **${w.cohort.n||0}** · avg ${r(w.cohort.avgR)}`,'','| Selector | Selected | Avg R | PF | Coverage | Capture |','| --- | ---: | ---: | ---: | ---: | ---: |',`| v7.74 Marginal | ${w.marginal.selected} | ${r(w.marginal.avgR)} | ${w.marginal.pf} | ${p(w.marginal.coveragePct)} | ${p(w.marginal.marketCapturePct)} |`,`| v7.75 Interaction | ${w.interaction.selected} | ${r(w.interaction.avgR)} | ${w.interaction.pf} | ${p(w.interaction.coveragePct)} | ${p(w.interaction.marketCapturePct)} |`,'',`Delta interaction − marginal: avg ${r(w.delta.avgR)}, PF ${w.delta.pf}, coverage ${p(w.delta.coveragePct)}, capture ${p(w.delta.marketCapturePct)}`,'','### Strongest positive residual interactions','');
    if(!w.topPositiveResidual.length)lines.push('_No eligible reliable positive residual interaction._');
    else for(const x of w.topPositiveResidual)lines.push(`- ${x.spec} · ${x.key} vs ${x.parentKey}: residual ${r(x.residualR)}, child n=${x.childN}, reliability ${p(x.reliability*100)}`);
    lines.push('','### Strongest negative residual interactions','');
    if(!w.topNegativeResidual.length)lines.push('_No eligible reliable negative residual interaction._');
    else for(const x of w.topNegativeResidual)lines.push(`- ${x.spec} · ${x.key} vs ${x.parentKey}: residual ${r(x.residualR)}, child n=${x.childN}, reliability ${p(x.reliability*100)}`);
    lines.push('');
  }
  lines.push('## Promotion status','','**NO PROMOTION.** A v7.75 win requires repeatable positive OOS expectancy/PF with useful coverage across multiple windows before any Challenger V3.2 portfolio replay.','');
  return lines.join('\n');
}

export const __test={flattenInteractions,selectorSummary};
