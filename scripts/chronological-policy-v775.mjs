import fs from 'node:fs';
import { evaluateChronologicalPolicy } from '../chronological-policy-v775.js';

const args=process.argv.slice(2);
const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const input=get('--in')||'research/adaptive-evidence-v774.json';
const out=get('--out')||'research/chronological-policy-v775.json';
const md=get('--md')||'research/chronological-policy-v775.md';

const source=JSON.parse(fs.readFileSync(input,'utf8'));
const result={generatedAt:new Date().toISOString(),sourceSchema:source.schemaVersion,...evaluateChronologicalPolicy(source)};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2));

const s=result.summary;
const lines=[
  '# MERIDIAN v7.75 — Chronological Policy Selection',
  '',
  `Generated: ${result.generatedAt}`,
  '',
  'Research-only. The policy for each 90d test period is selected exclusively from the immediately older 90d period. No same-period hindsight, no coverage reduction, no Paper/runtime/UI changes.',
  '',
  '## Walk-forward steps',
  '',
  ...result.steps.map(x=>`- ${x.trainPeriod} → ${x.testPeriod}: **${x.selectedPolicy}** · test ΔAvgR=${x.test.avgRDelta} · ΔPF=${x.test.pfDelta} · displaced=${x.test.opportunity?.displaced??0}`),
  '',
  '## Summary',
  '',
  `Positive: **${s.positivePeriods}/${s.periods}** · neutral: **${s.neutralPeriods}** · negative: **${s.negativePeriods}** · mean ΔAvgR=${s.avgAvgRDelta} · mean ΔPF=${s.avgPfDelta}.`,
  '',
  `Persistent: **${s.persistent}**. Promotion allowed: **${result.promotionAllowed}**. Next step: **${result.nextStep}**.`,
  '',
];
fs.writeFileSync(md,lines.join('\n'));
console.log(JSON.stringify({ok:true,out,md,summary:s,nextStep:result.nextStep},null,2));
