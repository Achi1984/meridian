import fs from 'node:fs';
import { evaluateAdaptivePolicies } from '../adaptive-evidence-v774.js';

const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const files=['--p0','--p1','--p2','--p3'].map(get);
const out=get('--out')||'research/adaptive-evidence-v774.json';
if(files.some(x=>!x))throw new Error('required: --p0 --p1 --p2 --p3');
const periods={};
for(let i=0;i<files.length;i++){
  const cohort=JSON.parse(fs.readFileSync(files[i],'utf8'));
  const rows=Array.isArray(cohort.rows)?cohort.rows:Array.isArray(cohort.signals)?cohort.signals:Array.isArray(cohort.samples)?cohort.samples:[];
  periods[`P${i}`]=evaluateAdaptivePolicies(rows);
}
const policies=['LR_MTF3','LR_VOLUME','LR_MTF3_VOLUME'];
const summary={};
for(const p of policies){
  const obs=Object.values(periods).map(x=>x.results[p]);
  summary[p]={
    periods:obs.length,
    avgRBetterPeriods:obs.filter(x=>x.comparison.avgRDelta>0).length,
    pfBetterPeriods:obs.filter(x=>x.comparison.pfDelta>0).length,
    equalCoveragePeriods:obs.filter(x=>x.equalCoverage).length,
    avgAvgRDelta:Number((obs.reduce((s,x)=>s+(x.comparison.avgRDelta||0),0)/obs.length).toFixed(3)),
    totalMissedWinners:obs.reduce((s,x)=>s+x.opportunity.missedWinners,0),
    totalAvoidedLosers:obs.reduce((s,x)=>s+x.opportunity.avoidedLosers,0),
  };
}
const ranked=policies.slice().sort((a,b)=>summary[b].avgRBetterPeriods-summary[a].avgRBetterPeriods||summary[b].avgAvgRDelta-summary[a].avgAvgRDelta);
const winner=ranked.find(p=>summary[p].avgRBetterPeriods>=3&&summary[p].pfBetterPeriods>=3&&summary[p].equalCoveragePeriods===4)||null;
const result={schemaVersion:'7.74-ADAPTIVE-EVIDENCE-REPORT-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,periods,summary,winner,promotionAllowed:false,nextStep:winner?'INDEPENDENT_ADAPTIVE_VALIDATION':'REJECT_FIXED_ADAPTIVE_BONUS'};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:true,out,winner,summary},null,2));
