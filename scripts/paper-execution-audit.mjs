import fs from 'node:fs/promises';
import {auditAssistantSnapshot} from '../paper-execution-audit.js';

const endpoint=process.env.MERIDIAN_PUBLIC_STATUS_URL||'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/assistant';
const response=await fetch(endpoint,{headers:{accept:'application/json'}});
if(!response.ok)throw new Error(`status fetch failed: ${response.status}`);
const audit=auditAssistantSnapshot(await response.json());
await fs.mkdir('artifacts',{recursive:true});
await fs.writeFile('artifacts/paper-execution-audit-v1.json',JSON.stringify(audit,null,2)+'\n');

const rows=audit.bots.map(b=>`| ${b.name} | ${b.lastClosedAt||'—'} | ${b.observedClosed}/${b.expectedClosed} | ${b.stopAudit.observed} | ${b.stopAudit.materialOverruns} | ${b.stopAudit.maxActualLossR??'—'} | ${b.closureClusters.length} | ${b.openingBundles.length} | ${b.sameDirectionReentries.length} |`).join('\n');
const evaluatedStops=audit.bots.reduce((s,b)=>s+b.stopAudit.observed,0);
const overruns=audit.bots.reduce((s,b)=>s+b.stopAudit.materialOverruns,0);
const reentries=audit.bots.reduce((s,b)=>s+b.sameDirectionReentries.length,0);
const bundles=audit.bots.reduce((s,b)=>s+b.openingBundles.length,0);
const clusters=audit.bots.reduce((s,b)=>s+b.closureClusters.length,0);
const report=`# MERIDIAN Paper Execution Audit V1\n\nStatus: RESEARCH ONLY · PARTIAL PUBLIC SAMPLE · NO EXECUTION IMPACT\n\nSource snapshot: ${audit.sourceGeneratedAt}\n\n| Bot | Last close UTC | Observed/ledger | SL sample | >1.25R | Max loss R | Close clusters | Direction bundles | Re-entries |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Findings\n\n- ${overruns}/${evaluatedStops} evaluable stop exits exceed 1.25R including fees and sampled-price slippage.\n- The largest observed stop loss is ${Math.max(...audit.bots.map(b=>b.stopAudit.maxActualLossR||0))}R.\n- The partial windows contain ${reentries} same-symbol/same-side re-entries within six hours, ${bundles} directional multi-asset opening bundles and ${clusters} close clusters.\n- Baseline recentClosed projection omits position quantity and stop, so its stop-loss R cannot be reconstructed from the public contract.\n- These are audit leads, not causal proof. A protected aggregate full-ledger export and candle-level replay are required before changing execution.\n\n## Interpretation boundary\n\n${audit.limitations.map(x=>`- ${x}`).join('\n')}\n\nThe audit does not alter Baseline 6.2, research bots, risk gates, sizing, exits, Paper/live execution, Pionex or server.js. Full-ledger conclusions remain blocked until a protected aggregate export exists.\n`;
await fs.writeFile('research/paper-execution-audit-v1-evidence.md',report);
console.log(JSON.stringify({artifact:'artifacts/paper-execution-audit-v1.json',report:'research/paper-execution-audit-v1-evidence.md',bots:audit.bots.map(b=>({name:b.name,coveragePct:b.coveragePct,lastClosedAt:b.lastClosedAt}))},null,2));
