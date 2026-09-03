#!/usr/bin/env node
import fs from 'node:fs';
import { compareSignalSelection, comparePortfolioPath } from '../soft-allocation-v773.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
const out=valueOf('--out')||'research/soft-allocation-evidence-v773.json';
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;if(Array.isArray(raw?.rows))return raw.rows;throw new Error(`${file}: expected rows array`)}
const periods={};
for(const [name,file] of Object.entries(inputs)){
  if(!file)throw new Error(`Missing --${name.toLowerCase()}`);
  const rows=load(file);
  periods[name]={signal:compareSignalSelection(rows),portfolio:comparePortfolioPath(rows,{riskPerTradePct:0.25})};
}
const adequate=Object.values(periods);
const signalWins=adequate.filter(x=>(x.signal.comparison.avgRDelta??0)>0).length;
const pathWins=adequate.filter(x=>(x.portfolio.comparison.avgRDelta??0)>0).length;
const lowerDd=adequate.filter(x=>(x.portfolio.comparison.maxDrawdownDeltaPct??0)<0).length;
const report={schemaVersion:'7.73-SOFT-ALLOCATION-EVIDENCE-V1',researchOnly:true,executionImpact:false,generatedAt:new Date().toISOString(),bonus:{cell:'LONG__RANGE',score:0.5},periods,summary:{periods:adequate.length,signalAvgRBetterPeriods:signalWins,portfolioAvgRBetterPeriods:pathWins,lowerDrawdownPeriods:lowerDd,promotionAllowed:false}};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,summary:report.summary},null,2));
