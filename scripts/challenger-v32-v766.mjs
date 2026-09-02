#!/usr/bin/env node
// MERIDIAN v7.66 — offline Challenger V3.2 signal-level comparison.
import fs from 'node:fs';
import { compareV32ToBaseline } from '../challenger-v32.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
const out=valueOf('--out')||'research/challenger-v32-evidence-v766.json';
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;if(Array.isArray(raw?.rows))return raw.rows;throw new Error(`${file}: expected rows array`)}
const periods={};for(const [name,file] of Object.entries(inputs)){if(!file)throw new Error(`Missing --${name.toLowerCase()}`);periods[name]=compareV32ToBaseline(load(file));}
const adequate=Object.entries(periods).filter(([,x])=>x.baseline.samples>0),wins=adequate.filter(([,x])=>(x.challengerV32.avgR??-999)>(x.baseline.avgR??-999));
const report={schemaVersion:'7.66-CHALLENGER-V32-EVIDENCE-V1',researchOnly:true,executionImpact:false,generatedAt:new Date().toISOString(),periods,summary:{adequatePeriods:adequate.length,v32AvgRBetterPeriods:wins.length,v32AvgRBetterPct:adequate.length?Math.round(wins.length/adequate.length*1000)/10:null,allCoverageMatched:adequate.every(([,x])=>x.opportunity.coverageMatched)}};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,summary:report.summary},null,2));
