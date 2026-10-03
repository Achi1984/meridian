import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runRegimeTrendBreakoutV1Discovery} from './paper-profit-regime-trend-breakout-v1-evaluator.js';

const SOURCE=path.resolve('research/results/regime-trend-breakout-v1-source.json');
const OUT_DIR=path.resolve('research/results');
const raw=fs.readFileSync(SOURCE);
const source=JSON.parse(raw);
if(source?.schemaVersion!=='MERIDIAN-REGIME-TREND-BREAKOUT-V1-SOURCE-1')throw new Error('source_schema_mismatch');
if(source?.contract?.sourceStartUtc!=='2021-08-08T00:00:00.000Z'||source?.contract?.sourceEndUtc!=='2026-09-30T23:59:59.999Z')throw new Error('source_window_mismatch');
if(source?.contract?.closedBarsOnly!==true||source?.contract?.privateData!==false||source?.contract?.syntheticHistory!==false)throw new Error('source_contract_invalid');

const result=runRegimeTrendBreakoutV1Discovery(source.data||{});
const evidence={
  schemaVersion:'MERIDIAN-REGIME-TREND-BREAKOUT-V1-RESULT-1',
  generatedAt:new Date().toISOString(),
  sourceSha256:createHash('sha256').update(raw).digest('hex'),
  sourceContract:source.contract,
  sources:source.sources,
  result
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'regime-trend-breakout-v1-result.json'),JSON.stringify(evidence,null,2)+'\n');
const d=result.discovery||null,h=result.holdout||null;
const md=`# Regime-Gated Trend / Breakout V1 — First Untouched Result

Generated: ${evidence.generatedAt}

Decision: **${result.decision}**

Source SHA-256: \`${evidence.sourceSha256}\`

Split: ${result.split?.ok?`${new Date(result.split.discoveryFrom).toISOString()} → ${new Date(result.split.discoveryTo).toISOString()} / holdout ${new Date(result.split.holdoutFrom).toISOString()} → ${new Date(result.split.holdoutTo).toISOString()}`:'unavailable'}

Discovery: ${d?JSON.stringify(d):'not evaluated'}

Holdout: ${h?JSON.stringify(h):'not evaluated'}

Research only. No auto-promotion. No live execution impact.
`;
fs.writeFileSync(path.join(OUT_DIR,'regime-trend-breakout-v1-result.md'),md);
console.log(JSON.stringify({decision:result.decision,split:result.split,discovery:result.discovery,holdout:result.holdout,sourceSha256:evidence.sourceSha256},null,2));
