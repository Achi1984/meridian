#!/usr/bin/env node
// MERIDIAN v7.65 — offline disjoint historical validation runner.
import fs from 'node:fs';
import { validateDisjointPeriods } from '../disjoint-period-validation.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
const out=valueOf('--out')||'research/disjoint-history-evidence-v765.json';
const minSamples=Math.max(1,Number(valueOf('--min-samples'))||30);
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;for(const k of ['rows','samples','cohort','signals'])if(Array.isArray(raw?.[k]))return raw[k];throw new Error(`${file}: expected rows array`)}
const periodRows={};for(const [name,file] of Object.entries(inputs)){if(!file)throw new Error(`Missing --${name.toLowerCase()}`);periodRows[name]=load(file)}
const report=validateDisjointPeriods(periodRows,{minSamples});
report.generatedAt=new Date().toISOString();
report.periodMeta=Object.fromEntries(Object.entries(inputs).map(([name,file])=>{const raw=JSON.parse(fs.readFileSync(file,'utf8'));return[name,{file,sampleStart:raw.sampleStart||null,sampleEnd:raw.sampleEnd||null,samples:Array.isArray(raw.rows)?raw.rows.length:null}]}));
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,robust:report.candidates.filter(x=>x.robust).map(x=>x.id)},null,2));
