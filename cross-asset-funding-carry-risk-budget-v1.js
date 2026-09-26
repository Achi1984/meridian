// MERIDIAN Cross-Asset Funding Carry Risk Budget V1 — frozen research contract.
export const CROSS_ASSET_FUNDING_CARRY_RISK_BUDGET_V1=Object.freeze({
  version:'CROSS-ASSET-FUNDING-CARRY-RISK-BUDGET-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT']),
  fundingWarmupStart:'2020-12-01T00:00:00.000Z',
  evaluationStart:'2021-01-01T00:00:00.000Z',
  splitAt:'2023-07-01T00:00:00.000Z',
  evaluationEnd:'2026-06-01T00:00:00.000Z',
  cooldownMs:24*3600000,
  sleeveCapital:20000,
  portfolioReferenceCapital:60000,
  maxConcurrent:2,
  extraStressUsdPerCycle:8,
  initialPointer:'BTCUSDT'
});

export function cyclicAdmissionOrder(pointer='BTCUSDT'){
  const a=CROSS_ASSET_FUNDING_CARRY_RISK_BUDGET_V1.symbols,i=Math.max(0,a.indexOf(pointer));
  return [...a.slice(i),...a.slice(0,i)];
}
export function nextAdmissionPointer(admitted){
  const a=CROSS_ASSET_FUNDING_CARRY_RISK_BUDGET_V1.symbols,i=a.indexOf(admitted);
  return a[(Math.max(0,i)+1)%a.length];
}
