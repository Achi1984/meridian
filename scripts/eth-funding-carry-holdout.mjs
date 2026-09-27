import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {evaluateEthFundingHoldout,classifyEthFundingHoldout,ETH_FUNDING_HOLDOUT_CONFIG,ETH_FUNDING_HOLDOUT_RULESET} from '../funding-carry-eth-holdout.js';

const INPUT=process.env.ETH_HOLDOUT_INPUT||'/tmp/meridian-eth-holdout-input.json';
if(!fs.existsSync(INPUT)){
  execFileSync('python3',['scripts/collect-eth-funding-holdout.py'],{stdio:'inherit',env:{...process.env,ETH_HOLDOUT_INPUT:INPUT}});
}
const raw=JSON.parse(fs.readFileSync(INPUT,'utf8'));
const market={spot:raw.spot||[],perp:raw.perp||[],funding:raw.funding||[]};
if(!market.spot.length||!market.perp.length||!market.funding.length)throw new Error('holdout archive input incomplete');

const windows=[
  {label:'2024',start:Date.UTC(2024,0,1),end:Date.UTC(2025,0,1)},
  {label:'2025',start:Date.UTC(2025,0,1),end:Date.UTC(2026,0,1)},
  {label:'2026-H1',start:Date.UTC(2026,0,1),end:Date.UTC(2026,5,1)}
];
const evalWindow=w=>({label:w.label,...evaluateEthFundingHoldout({...market,start:w.start,end:w.end})});
const full=evaluateEthFundingHoldout({...market,start:ETH_FUNDING_HOLDOUT_CONFIG.start,end:ETH_FUNDING_HOLDOUT_CONFIG.end});
const blocks=windows.map(evalWindow);
const classification=classifyEthFundingHoldout(full,blocks);

const out={
  schemaVersion:ETH_FUNDING_HOLDOUT_RULESET,
  generatedAt:new Date().toISOString(),
  source:raw.source||'Binance Vision official public archive',
  method:'FROZEN_LONG_SPOT_SHORT_PERPETUAL_EQUAL_BASE_QUANTITY',
  holdout:{start:new Date(ETH_FUNDING_HOLDOUT_CONFIG.start).toISOString(),end:new Date(ETH_FUNDING_HOLDOUT_CONFIG.end).toISOString()},
  assumptions:{
    notionalPerLeg:ETH_FUNDING_HOLDOUT_CONFIG.notionalPerLeg,
    conservativeCapital:ETH_FUNDING_HOLDOUT_CONFIG.notionalPerLeg*2,
    spotFeeBps:ETH_FUNDING_HOLDOUT_CONFIG.spotFeeBps,
    perpFeeBps:ETH_FUNDING_HOLDOUT_CONFIG.perpFeeBps,
    slippageBpsPerFill:ETH_FUNDING_HOLDOUT_CONFIG.slippageBps,
    noLeverage:true,
    researchOnly:true,
    executionImpact:false
  },
  coverage:raw.coverage||null,
  classification,
  full,
  blocks
};
fs.mkdirSync('research',{recursive:true});
fs.writeFileSync('research/eth-funding-carry-holdout-v1.json',JSON.stringify(out,null,2));

const money=v=>`${Number(v)<0?'-':''}$${Math.abs(Number(v)||0).toFixed(2)}`;
const pct=v=>`${Number(v||0).toFixed(3)}%`;
let md=`# MERIDIAN ETH Funding Carry Holdout V1

Generated: ${out.generatedAt}

Frozen holdout: **2024-01-01 → 2026-06-01 UTC**. Research only; no Paper or live execution. ETH was selected before this run. The test uses equal-base long spot + short USD-M perpetual exposure, conservative capital of $20,000, 10 bps spot fees, 5 bps perpetual fees and 3 bps slippage per fill. Calendar blocks are predeclared robustness diagnostics and each block pays its own round-trip costs.

## Decision

**${classification.decision}** — ${classification.reasons.join(' · ')}

| Window | Funding | Basis P&L | Costs | Net | Capital return | Annualized | Positive funding |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full holdout | ${money(full.fundingIncome)} | ${money(full.basisPnl)} | ${money(full.costs)} | ${money(full.netPnl)} | ${pct(full.returnOnConservativeCapitalPct)} | ${pct(full.annualizedPct)} | ${(Number(full.positiveShare||0)*100).toFixed(1)}% |
`;
for(const x of blocks)md+=`| ${x.label} | ${money(x.fundingIncome)} | ${money(x.basisPnl)} | ${money(x.costs)} | ${money(x.netPnl)} | ${pct(x.returnOnConservativeCapitalPct)} | ${pct(x.annualizedPct)} | ${(Number(x.positiveShare||0)*100).toFixed(1)}% |\n`;
md+=`
## Frozen gate

- Full holdout must remain positive after all modeled costs.
- Every predeclared calendar block must also remain positive after its own modeled costs.
- A passing result only permits a separate prospective Paper trial. It never auto-promotes the strategy or changes live execution.
- No thresholds, asset selection or fee assumptions are changed after seeing this result.
`;
fs.writeFileSync('research/eth-funding-carry-holdout-v1.md',md);
console.log(JSON.stringify(out,null,2));
