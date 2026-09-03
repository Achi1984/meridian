#!/usr/bin/env node
import fs from 'node:fs';
import { buildContextReliabilityMap, crossWindowContextReliability } from '../context-reliability-v776.js';

const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const files=['--p0','--p1','--p2','--p3'].map(get);
const out=get('--out')||'research/context-reliability-v776.json';
if(files.some(x=>!x))throw new Error('required: --p0 --p1 --p2 --p3');

const periods={};
for(let i=0;i<files.length;i++){
  const cohort=JSON.parse(fs.readFileSync(files[i],'utf8'));
  const rows=Array.isArray(cohort.rows)?cohort.rows:Array.isArray(cohort.signals)?cohort.signals:[];
  periods[`P${i}`]=buildContextReliabilityMap(rows,{minSamples:20});
}
const reliability=crossWindowContextReliability(periods,{minWindows:3});
const result={schemaVersion:'7.76-CONTEXT-RELIABILITY-REPORT-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,periods,reliability,promotionAllowed:false,nextStep:reliability.nextStep};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,robustCells:reliability.robustCells.map(x=>({key:x.key,windows:x.windows,avgAvgR:x.avgAvgR,avgPf:x.avgPf,avgCaptureEfficiency:x.avgCaptureEfficiency})),nextStep:result.nextStep},null,2));
