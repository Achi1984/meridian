#!/usr/bin/env node
import fs from 'node:fs';
import { interactionEdgeMap, crossWindowInteractionStability } from '../feature-interactions.js';
const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const files={'30d':valueOf('--30'),'60d':valueOf('--60'),'90d':valueOf('--90')},out=valueOf('--out'),minSamples=Math.max(1,Number(valueOf('--min-samples'))||40);
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;for(const k of ['rows','samples','cohort','signals'])if(Array.isArray(raw?.[k]))return raw[k];throw new Error(`${file}: no rows array`)}
const windows={};for(const [w,f] of Object.entries(files))if(f)windows[w]=interactionEdgeMap(load(f),{minSamples});if(!Object.keys(windows).length)throw new Error('Provide --30/--60/--90');
const report={schemaVersion:'7.63-FEATURE-INTERACTION-REPORT-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,minSamples,windows,stability:crossWindowInteractionStability(windows)};
const json=JSON.stringify(report,null,2)+'\n';if(out){fs.writeFileSync(out,json);console.log(`wrote ${out}`)}else process.stdout.write(json);
