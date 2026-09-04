#!/usr/bin/env node
import fs from 'node:fs';
import { runChronologicalV33RiskShadow } from '../risk-allocation-v777.js';

const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const files=['--p0','--p1','--p2','--p3'].map(get);
const out=get('--out')||'research/risk-allocation-v777.json';
if(files.some(x=>!x))throw new Error('required: --p0 --p1 --p2 --p3');

const periods={};
for(let i=0;i<files.length;i++){
  const cohort=JSON.parse(fs.readFileSync(files[i],'utf8'));
  periods[`P${i}`]=Array.isArray(cohort.rows)?cohort.rows:Array.isArray(cohort.signals)?cohort.signals:[];
}
const result={generatedAt:new Date().toISOString(),...runChronologicalV33RiskShadow(periods)};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,summary:result.summary,nextStep:result.nextStep,steps:result.steps.map(s=>({training:s.training,test:s.test,policyCells:s.policy.cells.length,trades:s.replay.selectedTrades,boosted:s.replay.allocation.boostedTrades,returnDelta:s.replay.delta.returnPct,ddDelta:s.replay.delta.maxDrawdownPct,pfDelta:s.replay.delta.pf,riskEfficiency:s.replay.adaptive.winnerMinusLoserRiskPct}))},null,2));
