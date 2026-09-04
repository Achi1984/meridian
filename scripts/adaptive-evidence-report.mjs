#!/usr/bin/env node
// MERIDIAN v7.74 — Adaptive Evidence report CLI
// Input must be prepared MERIDIAN research events JSON. Research-only; no Paper execution impact.

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAdaptiveEvidenceReport, renderAdaptiveEvidenceMarkdown } from '../adaptive-evidence-report.js';

function arg(name,fallback=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback}
function list(v,fallback){if(!v)return fallback;return String(v).split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0)}

const input=arg('input');
if(!input){
  console.error('Usage: node scripts/adaptive-evidence-report.mjs --input <prepared-events.json> [--out research/adaptive-evidence-report-v774] [--windows 30,60,90] [--horizon 14]');
  process.exit(2);
}

const outBase=arg('out','research/adaptive-evidence-report-v774');
const raw=JSON.parse(await fs.readFile(input,'utf8'));
const events=Array.isArray(raw)?raw:(Array.isArray(raw.events)?raw.events:null);
if(!events)throw new Error('Input must be an event array or an object containing {events:[...]}');
const report=buildAdaptiveEvidenceReport(events,{
  dataEnd:arg('data-end')?Number(arg('data-end')):undefined,
  horizonDays:Number(arg('horizon','14')),
  windowsDays:list(arg('windows'),[30,60,90]),
  walkForwardSlices:Number(arg('walk-forward','5')),
  stabilityWindows:Number(arg('stability-windows','5')),
  feeBps:Number(arg('fee-bps','5')),
  slippageBps:Number(arg('slippage-bps','3'))
});
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,renderAdaptiveEvidenceMarkdown(report)+'\n');
console.log(JSON.stringify({ok:true,version:report.version,json:`${outBase}.json`,markdown:`${outBase}.md`,windows:Object.keys(report.windows)},null,2));
