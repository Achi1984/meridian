import fs from 'node:fs';
import path from 'node:path';
import {runRegimeTrendBreakoutV1Holdout,sha256Buffer} from './paper-profit-regime-trend-breakout-v1-holdout.js';

const SOURCE=path.resolve('research/results/regime-trend-breakout-v1-source.json');
const FROZEN=path.resolve('research/results/regime-trend-breakout-v1-result.json');
const OUT_DIR=path.resolve('research/results');
const raw=fs.readFileSync(SOURCE),source=JSON.parse(raw),frozen=JSON.parse(fs.readFileSync(FROZEN,'utf8'));
const expectedSourceSha=String(frozen?.sourceSha256||'');
const actualSourceSha=sha256Buffer(raw);
if(actualSourceSha!==expectedSourceSha)throw new Error('frozen_source_sha_mismatch expected='+expectedSourceSha+' actual='+actualSourceSha);
if(source?.schemaVersion!=='MERIDIAN-REGIME-TREND-BREAKOUT-V1-SOURCE-1')throw new Error('source_schema_mismatch');

const result=runRegimeTrendBreakoutV1Holdout(source.data||{},frozen);
if(result?.decision==='HOLDOUT_BLOCKED_DISCOVERY_PARITY_FAIL')throw new Error('discovery_parity_fail '+JSON.stringify(result.parity));
const evidence={
  schemaVersion:'MERIDIAN-REGIME-TREND-BREAKOUT-V1-HOLDOUT-RESULT-1',
  generatedAt:new Date().toISOString(),
  sourceSha256:actualSourceSha,
  frozenDiscoveryResultBlob:'c3a5b72d27f825e2df951794fb782af429cfafc8',
  result
};
fs.mkdirSync(OUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUT_DIR,'regime-trend-breakout-v1-holdout-result.json'),JSON.stringify(evidence,null,2)+'\n');
const h=result.holdout||null;
const md=`# Regime-Gated Trend / Breakout V1 — First Untouched Holdout Result

Generated: ${evidence.generatedAt}

Decision: **${result.decision}**

Source SHA-256: \`${actualSourceSha}\`

Discovery parity: **${result.discoveryParity===true?'PASS':'FAIL'}**

Holdout: ${h?JSON.stringify(h):'not evaluated'}

Research only. No auto-promotion. No live execution impact.
`;
fs.writeFileSync(path.join(OUT_DIR,'regime-trend-breakout-v1-holdout-result.md'),md);
console.log(JSON.stringify({decision:result.decision,discoveryParity:result.discoveryParity,split:result.split,holdout:result.holdout,sourceSha256:actualSourceSha},null,2));
