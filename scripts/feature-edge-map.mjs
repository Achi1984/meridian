#!/usr/bin/env node
// MERIDIAN v7.61 — offline Feature Attribution report runner.
// Usage: node scripts/feature-edge-map.mjs --30 path.json --60 path.json --90 path.json [--out report.json]
import fs from 'node:fs';
import { featureEdgeMap, crossWindowFeatureStability } from '../feature-attribution.js';

const args=process.argv.slice(2);
const valueOf=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
const inputs={'30d':valueOf('--30'),'60d':valueOf('--60'),'90d':valueOf('--90')};
const out=valueOf('--out');
const minSamples=Math.max(1,Number(valueOf('--min-samples'))||30);

function load(file){
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));
  if(Array.isArray(raw))return raw;
  for(const key of ['cohort','signals','rows','samples'])if(Array.isArray(raw?.[key]))return raw[key];
  throw new Error(`${file}: expected JSON array or cohort/signals/rows/samples array`);
}
const maps={};
for(const [window,file] of Object.entries(inputs))if(file)maps[window]=featureEdgeMap(load(file),{minSamples});
if(!Object.keys(maps).length)throw new Error('Provide at least one of --30, --60 or --90');
const report={schemaVersion:'7.61-FEATURE-EDGE-REPORT-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,minSamples,windows:maps,stability:crossWindowFeatureStability(maps)};
const json=JSON.stringify(report,null,2)+'\n';
if(out){fs.writeFileSync(out,json);console.log(`wrote ${out}`);}else process.stdout.write(json);
