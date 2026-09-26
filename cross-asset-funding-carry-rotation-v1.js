// MERIDIAN Cross-Asset Funding Carry Rotation V1 — frozen research selector.
// Research only. It selects among exact V2-eligible BTC/ETH/SOL candidates.

export const CROSS_ASSET_FUNDING_CARRY_ROTATION_V1=Object.freeze({
  version:'CROSS-ASSET-FUNDING-CARRY-ROTATION-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT']),
  fundingWarmupStart:'2020-12-01T00:00:00.000Z',
  evaluationStart:'2021-01-01T00:00:00.000Z',
  splitAt:'2023-07-01T00:00:00.000Z',
  evaluationEnd:'2026-06-01T00:00:00.000Z',
  cooldownMs:24*3600000,
  extraStressUsdPerCycle:8
});

const tieOrder=new Map(CROSS_ASSET_FUNDING_CARRY_ROTATION_V1.symbols.map((s,i)=>[s,i]));

export function selectFundingCarryAsset(candidates=[]){
  return (Array.isArray(candidates)?candidates:[])
    .filter(x=>x?.eligibility?.eligible===true&&tieOrder.has(x.symbol))
    .slice()
    .sort((a,b)=>{
      const ac=Number(a.eligibility.grossCostCoverage),bc=Number(b.eligibility.grossCostCoverage);
      if(Number.isFinite(ac)&&Number.isFinite(bc)&&bc!==ac)return bc-ac;
      if(Number.isFinite(bc)!==Number.isFinite(ac))return Number.isFinite(bc)?1:-1;
      return (tieOrder.get(a.symbol)??99)-(tieOrder.get(b.symbol)??99);
    })[0]||null;
}
