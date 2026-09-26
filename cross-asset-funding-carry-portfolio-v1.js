// MERIDIAN Cross-Asset Funding Carry Portfolio V1 — frozen research contract.
// Three equal independent sleeves; research only.

export const CROSS_ASSET_FUNDING_CARRY_PORTFOLIO_V1=Object.freeze({
  version:'CROSS-ASSET-FUNDING-CARRY-PORTFOLIO-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT']),
  fundingWarmupStart:'2020-12-01T00:00:00.000Z',
  evaluationStart:'2021-01-01T00:00:00.000Z',
  splitAt:'2023-07-01T00:00:00.000Z',
  evaluationEnd:'2026-06-01T00:00:00.000Z',
  cooldownMs:24*3600000,
  sleeveCapital:20000,
  portfolioReferenceCapital:60000,
  extraStressUsdPerCycle:8
});
