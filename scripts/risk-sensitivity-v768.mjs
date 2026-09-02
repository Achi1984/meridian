#!/usr/bin/env node
// MERIDIAN v7.68 — offline risk sensitivity runner.
import fs from 'node:fs';
import { runRiskSensitivity } from '../risk-sensitivity-v768.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const out=valueOf('--out')||'research/risk-sensitivity-evidence-v768.json';
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
if(!inputs.P0)throw new Error('Missing --p0');
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;for(const k of ['rows','samples','cohort','signals'])if(Array.isArray(raw?.[k]))return raw[k];throw new Error(`${file}: expected cohort rows`)}
const periods={};
for(const [name,file] of Object.entries(inputs)){if(file)periods[name]=runRiskSensitivity(load(file));}
const names=Object.keys(periods);
const levels=['risk_0.25','risk_0.50','risk_0.75','risk_1.00'];
const aggregate={};
for(const level of levels){
  const xs=names.map(n=>periods[n].variants[level]).filter(Boolean);
  aggregate[level]={
    periods:xs.length,
    v32Positive:xs.filter(x=>(x.challengerV32.avgR??-999)>0).length,
    v32PfAbove1:xs.filter(x=>(x.challengerV32.pf??0)>1).length,
    v32BetterAvgR:xs.filter(x=>x.comparison.v32BetterAvgR).length,
    v32LowerDd:xs.filter(x=>(x.challengerV32.maxDrawdownPct??99)<(x.baseline.maxDrawdownPct??99)).length,
    avgEndEquity:xs.length?Math.round(xs.reduce((a,x)=>a+Number(x.challengerV32.endEquity||0),0)/xs.length*100)/100:null,
    avgMaxDdPct:xs.length?Math.round(xs.reduce((a,x)=>a+Number(x.challengerV32.maxDrawdownPct||0),0)/xs.length*100)/100:null
  };
}
const noDd=names.map(n=>periods[n].diagnosticNoDrawdown);
const diagnostic={periods:noDd.length,v32Positive:noDd.filter(x=>(x.challengerV32.avgR??-999)>0).length,v32PfAbove1:noDd.filter(x=>(x.challengerV32.pf??0)>1).length,avgEndEquity:noDd.length?Math.round(noDd.reduce((a,x)=>a+Number(x.challengerV32.endEquity||0),0)/noDd.length*100)/100:null};
const payload={schemaVersion:'7.68-RISK-SENSITIVITY-EVIDENCE-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,scorerFrozen:true,periods,aggregate,diagnosticNoDrawdown:diagnostic};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,aggregate,diagnostic},null,2));
