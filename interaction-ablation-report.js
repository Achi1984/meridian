// ACHI MERIDIAN Interaction Family Ablation Report — v7.76
// Research-only. Uses the same master cohort and evaluates each predefined interaction family independently OOS.

import { buildSignalCohort, cohortSummary } from './adaptive-evidence-cohorts.js';
import { runInteractionFamilyAblation } from './interaction-family-ablation.js';

export const INTERACTION_ABLATION_REPORT_VERSION='7.76-INTERACTION-ABLATION-REPORT-V1';
const DAY=86400000;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function compactFamily(x={}){
  const s=x.aggregate?.selected||{},m=x.aggregate?.marketCapture||{};
  return{specId:x.specId,selected:s.n||0,avgR:s.avgR??null,pf:s.pf??0,winRate:s.winRate??null,totalR:s.totalR??0,coveragePct:m.coveragePct??0,marketCapturePct:m.marketCapturePct??0,missedWinnerR:m.missedWinnerR??0,avoidedLoserR:m.avoidedLoserR??0,opportunityCostR:m.opportunityCostR??0};
}

export function buildInteractionAblationReport(events=[],opts={}){
  const dataEnd=Number(opts.dataEnd??Math.max(...events.map(x=>Number(x.t||0)))),horizonDays=Math.max(1,Number(opts.horizonDays??14));
  const windowsDays=(opts.windowsDays||[30,60,90]).map(Number).filter(x=>x>0).sort((a,b)=>a-b);
  if(!(dataEnd>0)||!windowsDays.length)throw new Error('Interaction Ablation report requires dataEnd and windows');
  const signalEnd=dataEnd-horizonDays*DAY,anchorStart=signalEnd-Math.max(...windowsDays)*DAY;
  const masterRows=buildSignalCohort(events,{start:anchorStart,end:dataEnd,horizonDays,sampleEveryMs:opts.sampleEveryMs,feeBps:opts.feeBps,slippageBps:opts.slippageBps,requireFullHorizon:true}).filter(r=>r.ts>=anchorStart&&r.ts<=signalEnd);
  const windows={};
  for(const days of windowsDays){
    const start=signalEnd-days*DAY,rows=masterRows.filter(r=>r.ts>=start&&r.ts<=signalEnd),ablation=runInteractionFamilyAblation(rows,{slices:opts.walkForwardSlices||5,trainWindowCount:opts.trainWindowCount||4,interactionOptions:opts.interactionOptions});
    const families=Object.fromEntries(Object.entries(ablation.families).map(([k,v])=>[k,compactFamily(v)]));
    const ranking=ablation.ranking.map(x=>families[x.specId]);
    windows[`${days}d`]={days,start,signalEnd,cohort:cohortSummary(rows),families,ranking};
  }
  const familyIds=Object.keys(windows[`${windowsDays.at(-1)}d`]?.families||{}),consensus=[];
  for(const id of familyIds){
    const perWindow=windowsDays.map(d=>({window:`${d}d`,...windows[`${d}d`].families[id]})),positive=perWindow.filter(x=>x.selected>=8&&x.avgR>0&&x.pf>=1).length,adequate=perWindow.filter(x=>x.selected>=8).length;
    consensus.push({specId:id,positiveWindows:positive,adequateWindows:adequate,perWindow,score:round(positive*2+adequate*.25,2)});
  }
  consensus.sort((a,b)=>b.positiveWindows-a.positiveWindows||b.score-a.score);
  return{version:INTERACTION_ABLATION_REPORT_VERSION,researchOnly:true,executionImpact:false,method:'SAME_MASTER_COHORT_PREDEFINED_INTERACTION_FAMILY_OOS_ABLATION',dataEnd,signalEnd,anchorStart,horizonDays,masterCohort:cohortSummary(masterRows),windows,consensus,promotion:{allowed:false,reason:'FAMILY_ATTRIBUTION_ONLY'},generatedAt:new Date().toISOString()};
}

const r=v=>v==null?'—':`${Number(v).toFixed(3)}R`,p=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
export function renderInteractionAblationMarkdown(report){
  const lines=[`# MERIDIAN ${report.version} — Family OOS Ablation`,'','> Research-only. No Paper execution impact.','',`Method: ${report.method}`,`Outcome horizon: ${report.horizonDays} days.`,''];
  for(const [label,w] of Object.entries(report.windows||{})){
    lines.push(`## ${label}`,'',`Cohort: **${w.cohort.n||0}** · avg ${r(w.cohort.avgR)}`,'','| Family | Selected | Avg R | PF | Coverage | Capture |','| --- | ---: | ---: | ---: | ---: | ---: |');
    for(const x of w.ranking)lines.push(`| ${x.specId} | ${x.selected} | ${r(x.avgR)} | ${x.pf} | ${p(x.coveragePct)} | ${p(x.marketCapturePct)} |`);
    lines.push('');
  }
  lines.push('## Cross-window consensus','','| Family | Positive windows | Adequate windows |','| --- | ---: | ---: |');
  for(const x of report.consensus)lines.push(`| ${x.specId} | ${x.positiveWindows}/3 | ${x.adequateWindows}/3 |`);
  lines.push('','Positive window criterion: at least 8 selected signals, avgR > 0 and PF ≥ 1.','','## Promotion status','','**NO PROMOTION.** Family ablation is attribution research. A family must show repeatable positive OOS edge and useful coverage before any predeclared combination test.','');
  return lines.join('\n');
}

export const __test={compactFamily};
