#!/usr/bin/env node
import fs from 'node:fs';
import { walkForwardInteractions } from '../walk-forward-interactions.js';
const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const input=valueOf('--input'),out=valueOf('--out');if(!input)throw new Error('Provide --input 90d-cohort.json');
const raw=JSON.parse(fs.readFileSync(input,'utf8'));const rows=Array.isArray(raw)?raw:(raw.rows||raw.samples||raw.cohort||raw.signals);if(!Array.isArray(rows))throw new Error('Input must contain rows');
const report=walkForwardInteractions(rows,{trainDays:Number(valueOf('--train-days'))||45,testDays:Number(valueOf('--test-days'))||15,stepDays:Number(valueOf('--step-days'))||15,minTrainSamples:Number(valueOf('--min-train-samples'))||50,minTestSamples:Number(valueOf('--min-test-samples'))||15,minTrainAvgR:Number(valueOf('--min-train-avgr'))||0.03});
const json=JSON.stringify(report,null,2)+'\n';if(out){fs.writeFileSync(out,json);console.log(`wrote ${out}`)}else process.stdout.write(json);
