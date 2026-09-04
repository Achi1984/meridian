#!/usr/bin/env node
// MERIDIAN v7.74 — Live-source Adaptive Evidence report runner
// Research-only. Downloads public Binance klines, prepares canonical MERIDIAN candidates and writes evidence reports.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPreparedAdaptiveEvents } from '../adaptive-evidence-source.js';
import { buildAdaptiveEvidenceReport, renderAdaptiveEvidenceMarkdown } from '../adaptive-evidence-report.js';

const DEFAULT_ASSETS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','SUIUSDT','HBARUSDT','AVAXUSDT','NEARUSDT','DOTUSDT','FETUSDT','INJUSDT'];
function arg(name,fallback=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback}
function nums(v,fallback){if(!v)return fallback;return String(v).split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0)}
function strs(v,fallback){if(!v)return fallback;return String(v).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean)}

const assets=strs(arg('assets'),DEFAULT_ASSETS);
const windowsDays=nums(arg('windows'),[30,60,90]);
const horizonDays=Number(arg('horizon','14'));
const dataEnd=arg('end')?Number(arg('end')):Date.now();
const outBase=arg('out','research/adaptive-evidence-live-v774');

console.log(`[MERIDIAN] Adaptive Evidence live research: ${assets.length} assets, windows ${windowsDays.join('/')}, horizon ${horizonDays}d`);
const source=await loadPreparedAdaptiveEvents({
  assets,windowsDays,horizonDays,dataEnd,
  onProgress:p=>{
    if(p.stage==='loading')console.log(`[load] ${p.index+1}/${p.total} ${p.asset}`);
    else if(p.stage==='retry')console.warn(`[retry] ${p.symbol} ${p.interval} attempt ${p.attempt}: ${p.error}`);
  }
});

const report=buildAdaptiveEvidenceReport(source.events,{
  dataEnd,
  horizonDays,
  windowsDays,
  walkForwardSlices:Number(arg('walk-forward','5')),
  stabilityWindows:Number(arg('stability-windows','5')),
  feeBps:Number(arg('fee-bps','5')),
  slippageBps:Number(arg('slippage-bps','3'))
});
report.source={
  version:source.version,
  method:source.method,
  assets:source.assets,
  windowsDays:source.windowsDays,
  horizonDays:source.horizonDays,
  dataEnd:source.dataEnd,
  signalStart:source.signalStart,
  signalEnd:source.signalEnd,
  warmStart:source.warmStart,
  preparedEvents:source.events.length
};

await fs.mkdir(path.dirname(outBase),{recursive:true});
await fs.writeFile(`${outBase}.json`,JSON.stringify(report,null,2)+'\n');
await fs.writeFile(`${outBase}.md`,renderAdaptiveEvidenceMarkdown(report)+'\n');
console.log(JSON.stringify({
  ok:true,
  researchOnly:true,
  version:report.version,
  source:report.source.version,
  assets:assets.length,
  preparedEvents:source.events.length,
  json:`${outBase}.json`,
  markdown:`${outBase}.md`,
  windows:Object.keys(report.windows)
},null,2));
