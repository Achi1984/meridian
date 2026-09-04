// ACHI MERIDIAN Adaptive Evidence Report — v7.74
// Research-only orchestration for prepared MERIDIAN research events.

import { buildSignalCohort, buildEvidenceMap, rollingWindows, cohortSummary } from './adaptive-evidence-cohorts.js';
import { cohortEvidence } from './adaptive-evidence.js';
import { expandingWalkForward } from './adaptive-evidence-walkforward.js';

export const ADAPTIVE_REPORT_VERSION='7.74-ADAPTIVE-REPORT-V1';
const DAY=86400000;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function flattenEvidence(map={}){
  const out=[];
  for(const [dimension,groups] of Object.entries(map)){
    for(const [key,stats] of Object.entries(groups||{})){
      const e=cohortEvidence(stats);
      out.push({dimension,key,n:stats.n,avgR:stats.avgR,medianR:stats.medianR,winRate:stats.winRate,totalR:stats.totalR,edgeR:round(e.edgeR),reliability:round(e.reliability),windowAgreement:round(e.windowAgreement),windowCount:e.windowCount});
    }
  }
  return out.sort((a,b)=>b.reliability-a.reliability||Math.abs(b.edgeR)-Math.abs(a.edgeR));
}

function topFeatures(rows,sign=1,limit=12){
  return rows.filter(x=>x.n>=24&&x.reliability>=.5&&Math.sign(x.edgeR)===sign).sort((a,b)=>sign*(b.edgeR-a.edgeR)).slice(0,limit);
}

export function buildAdaptiveEvidenceReport(events=[],opts={}){
  const dataEnd=Number(opts.dataEnd??Math.max(...events.map(x=>Number(x.t||0))));
  const horizonDays=Math.max(1,Number(opts.horizonDays??14));
  const windowsDays=(opts.windowsDays||[30,60,90]).map(Number).filter(x=>x>0).sort((a,b)=>a-b);
  if(!(dataEnd>0))throw new Error('Adaptive Evidence report requires a valid dataEnd');
  const signalEnd=dataEnd-horizonDays*DAY;
  const windows={};
  for(const days of windowsDays){
    const start=signalEnd-days*DAY;
    const rows=buildSignalCohort(events,{start,end:dataEnd,horizonDays,sampleEveryMs:opts.sampleEveryMs,feeBps:opts.feeBps,slippageBps:opts.slippageBps,requireFullHorizon:true});
    const evalRows=rows.filter(r=>r.ts>=start&&r.ts<=signalEnd);
    const stabilityWindows=evalRows.length?rollingWindows({start,end:signalEnd,count:opts.stabilityWindows||5}):[];
    const evidenceMap=buildEvidenceMap(evalRows,stabilityWindows);
    const featureRows=flattenEvidence(evidenceMap);
    const walkForward=expandingWalkForward(evalRows,{slices:opts.walkForwardSlices||5});
    windows[`${days}d`]={
      days,start,signalEnd,dataEnd,horizonDays,
      cohort:cohortSummary(evalRows),
      features:featureRows,
      topPositive:topFeatures(featureRows,1),
      topNegative:topFeatures(featureRows,-1),
      walkForward
    };
  }
  return{
    version:ADAPTIVE_REPORT_VERSION,
    researchOnly:true,
    executionImpact:false,
    method:'PORTFOLIO_INDEPENDENT_FULL_HORIZON_COHORTS_PLUS_EXPANDING_OOS',
    dataEnd,signalEnd,horizonDays,windows,
    promotion:{allowed:false,reason:'RESEARCH_ONLY_REQUIRES_HUMAN_APPROVAL_AND_PORTFOLIO_REPLAY'},
    generatedAt:new Date().toISOString()
  };
}

function pct(v){return v==null?'—':`${Number(v).toFixed(1)}%`}
function r(v){return v==null?'—':`${Number(v).toFixed(3)}R`}

export function renderAdaptiveEvidenceMarkdown(report){
  const lines=[
    `# MERIDIAN ${report.version} — Evidence Report`,
    '',
    '> Research-only. No Paper execution impact and no automatic promotion.',
    '',
    `Method: ${report.method}`,
    `Outcome horizon: ${report.horizonDays} days; recent signals without a full horizon are excluded.`,
    ''
  ];
  for(const [label,w] of Object.entries(report.windows||{})){
    const c=w.cohort||{},mc=w.walkForward?.aggregate?.marketCapture||{},sel=w.walkForward?.aggregate?.selected||{};
    lines.push(`## ${label}`,'',`Cohort: **${c.n||0}** signals · avg ${r(c.avgR)} · win rate ${pct(c.winRate)}`,'',`Walk-forward selected: **${sel.n||0}** · avg ${r(sel.avgR)} · PF ${sel.pf??'—'}`,'',`Market capture: ${pct(mc.marketCapturePct)} · coverage ${pct(mc.coveragePct)} · missed winners ${r(mc.missedWinnerR)} · avoided losers ${r(mc.avoidedLoserR)} · opportunity cost ${r(mc.opportunityCostR)}`,'');
    lines.push('### Strongest positive evidence','');
    if(!w.topPositive?.length)lines.push('_No reliable positive cohort met the minimum sample/reliability bar._');
    else for(const x of w.topPositive)lines.push(`- ${x.dimension} · ${x.key}: edge ${r(x.edgeR)}, n=${x.n}, reliability ${pct(x.reliability*100)}`);
    lines.push('','### Strongest negative evidence','');
    if(!w.topNegative?.length)lines.push('_No reliable negative cohort met the minimum sample/reliability bar._');
    else for(const x of w.topNegative)lines.push(`- ${x.dimension} · ${x.key}: edge ${r(x.edgeR)}, n=${x.n}, reliability ${pct(x.reliability*100)}`);
    lines.push('');
  }
  lines.push('## Promotion status','','**NO PROMOTION.** Adaptive Evidence remains research-only until signal calibration, opportunity coverage, portfolio replay, drawdown and human approval all pass.','');
  return lines.join('\n');
}
