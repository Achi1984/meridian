#!/usr/bin/env node
import fs from 'node:fs';
import { attributeSideRegime } from '../side-regime-v771.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
const out=valueOf('--out')||'research/side-regime-evidence-v771.json';
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;if(Array.isArray(raw?.rows))return raw.rows;throw new Error(`${file}: expected rows array`)}
const periods={};
for(const [name,file] of Object.entries(inputs)){if(!file)throw new Error(`Missing --${name.toLowerCase()}`);periods[name]=attributeSideRegime(load(file));}

const cellIds=[...new Set(Object.values(periods).flatMap(x=>Object.keys(x.cells||{})))].sort();
const persistence={};
for(const id of cellIds){
  const rows=Object.values(periods).map(p=>p.cells?.[id]).filter(Boolean).filter(x=>x.baseline.samples>=20&&x.challengerV32.samples>=20);
  const better=rows.filter(x=>Number(x.deltaAvgR)>0).length;
  persistence[id]={adequatePeriods:rows.length,betterAvgRPeriods:better,betterPct:rows.length?Math.round(better/rows.length*1000)/10:null,robustPositive:rows.length>=3&&better>=3};
}
const sidePersistence={};
for(const side of ['LONG','SHORT']){
  const rows=Object.values(periods).map(p=>p.sideOnly?.[side]).filter(Boolean).filter(x=>x.baseline.samples>=20&&x.challengerV32.samples>=20);
  const better=rows.filter(x=>Number(x.deltaAvgR)>0).length;
  sidePersistence[side]={adequatePeriods:rows.length,betterAvgRPeriods:better,betterPct:rows.length?Math.round(better/rows.length*1000)/10:null,robustPositive:rows.length>=3&&better>=3};
}
const report={schemaVersion:'7.71-SIDE-REGIME-EVIDENCE-V1',researchOnly:true,executionImpact:false,generatedAt:new Date().toISOString(),periods,summary:{sidePersistence,cellPersistence:persistence,robustCells:Object.entries(persistence).filter(([,x])=>x.robustPositive).map(([id])=>id)}};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,summary:report.summary},null,2));
