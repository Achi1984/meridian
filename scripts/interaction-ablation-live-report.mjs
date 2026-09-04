#!/usr/bin/env node
// MERIDIAN v7.76 — live interaction-family ablation report. Research-only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildInteractionAblationReport, renderInteractionAblationMarkdown } from '../interaction-ablation-report.js';

const DEFAULT_ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
const arg=(name,fallback=null)=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback};
const nums=(v,fallback)=>v?String(v).split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0):fallback;
const strs=(v,fallback)=>v?String(v).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean):fallback;

const assets=strs(arg('assets'),DEFAULT_ASSETS),windowsDays=nums(arg('windows'),[30,60,90]),horizonDays=Number(arg('horizon','14')),dataEnd=arg('end')?Number(arg('end')):Date.now(),outBase=arg('out','research/generated/interaction-ablation-v776');
console.log(`[MERIDIAN] v7.76 family ablation: ${assets.length} assets, ${windowsDays.join('/')}d, horizon ${horizonDays}d`);
const source=await loadPreparedAdaptiveEvents({assets,windowsDays,horizonDays,dataEnd,onProgress:p=>{if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`);else if(p.stage==='retry')console.warn(`[retry] ${p.symbol} ${p.interval} ${p.endpoint||''} attempt ${p.attempt}: ${p.error}`)}});
const report=buildInteractionAblationReport(source.events,{dataEnd,horizonDays,windowsDays,walkForwardSlices:Number(arg('walk-forward','5')),trainWindowCount:Number(arg('train-windows','4')),feeBps:Number(arg('fee-bps','5')),slippageBps:Number(arg('slippage-bps','3'))});
report.source={version:source.version,method:source.method,assets:source.assets,preparedEvents:source.events.length,endpoints:source.endpoints};
await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,renderInteractionAblationMarkdown(report)+'\n');
console.log(JSON.stringify({ok:true,researchOnly:true,version:report.version,assets:assets.length,preparedEvents:source.events.length,json:`${outBase}.json`,markdown:`${outBase}.md`},null,2));
