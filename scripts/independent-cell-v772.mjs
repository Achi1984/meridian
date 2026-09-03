#!/usr/bin/env node
// MERIDIAN v7.72 — independent side×regime validation runner.
import fs from 'node:fs';
import { validateIndependentCells } from '../independent-cell-v772.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const inputs={Q0:valueOf('--q0'),Q1:valueOf('--q1'),Q2:valueOf('--q2'),Q3:valueOf('--q3')};
const out=valueOf('--out')||'research/independent-cell-evidence-v772.json';
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;if(Array.isArray(raw?.rows))return raw.rows;throw new Error(`${file}: expected rows array`)}
const periodRows={};for(const [name,file] of Object.entries(inputs)){if(!file)throw new Error(`Missing --${name.toLowerCase()}`);periodRows[name]=load(file)}
const report={...validateIndependentCells(periodRows),generatedAt:new Date().toISOString(),windowDesign:'four disjoint 90d cohorts ending 360/450/540/630 days before run date; independent of v7.71 P0-P3'};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,validatedCells:report.validatedCells},null,2));
