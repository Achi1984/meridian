import fs from 'node:fs';
import {evaluateEthFundingHoldout,classifyEthFundingHoldout,ETH_FUNDING_HOLDOUT_CONFIG,ETH_FUNDING_HOLDOUT_RULESET} from '../funding-carry-eth-holdout.js';

const SPOT='https://api.binance.com';
const FUT='https://fapi.binance.com';
const HOUR=3600000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function json(url){
  let last;
  for(let i=0;i<5;i++){
    try{
      const r=await fetch(url,{headers:{'user-agent':'ACHI-MERIDIAN-ETH-HOLDOUT/1'}});
      if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    }catch(e){
      last=e;
      await sleep(500*2**i);
    }
  }
  throw last;
}

async function boundary(base,symbol,t){
  const path=base===SPOT?'api/v3':'fapi/v1';
  const start=t-12*HOUR,end=t+HOUR;
  const rows=await json(`${base}/${path}/klines?symbol=${symbol}&interval=1h&startTime=${start}&endTime=${end}&limit=32`);
  return (Array.isArray(rows)?rows:[]).map(k=>({ts:+k[6],close:+k[4]})).filter(x=>Number.isFinite(x.ts)&&x.close>0);
}

async function funding(symbol,start,end){
  const out=[];let cursor=start+1;
  while(cursor<=end){
    const rows=await json(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${end}&limit=1000`);
    if(!Array.isArray(rows)||!rows.length)break;
    for(const x of rows)out.push({ts:+x.fundingTime,rate:+x.fundingRate,markPrice:+x.markPrice});
    const last=+rows.at(-1).fundingTime,next=last+1;
    if(!(next>cursor))break;
    cursor=next;
    if(rows.length<1000)break;
    await sleep(120);
  }
  return [...new Map(out.map(x=>[x.ts,x])).values()].sort((a,b)=>a.ts-b.ts);
}

const SYMBOL=ETH_FUNDING_HOLDOUT_CONFIG.symbol;
const boundaries=[
  Date.UTC(2024,0,1),
  Date.UTC(2025,0,1),
  Date.UTC(2026,0,1),
  Date.UTC(2026,5,1)
];
const [fundingRows,...boundarySets]=await Promise.all([
  funding(SYMBOL,ETH_FUNDING_HOLDOUT_CONFIG.start,ETH_FUNDING_HOLDOUT_CONFIG.end),
  ...boundaries.flatMap(t=>[boundary(SPOT,SYMBOL,t),boundary(FUT,SYMBOL,t)])
]);
const spot=[],perp=[];
for(let i=0;i<boundaries.length;i++){
  spot.push(...boundarySets[i*2]);
  perp.push(...boundarySets[i*2+1]);
}
const dedupe=a=>[...new Map(a.map(x=>[x.ts,x])).values()].sort((a,b)=>a.ts-b.ts);
const market={spot:dedupe(spot),perp:dedupe(perp),funding:fundingRows};

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
  source:'Binance Spot + Binance USD-M perpetual public market data',
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
