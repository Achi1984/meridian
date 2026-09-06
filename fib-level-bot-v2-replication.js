// MERIDIAN FIB Level Bot V2 — frozen 4h replication gate.
// Research only. Imports V1 trading behavior unchanged.
export {runFibLevelBot} from './fib-level-bot-v1.js';

export const FIB_LEVEL_BOT_V2=Object.freeze({
  timeframe:'4h',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  core:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT']),
  expansion:Object.freeze(['XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']),
  replicationStart:'2024-09-06T14:15:00.000Z',
  discoveryStart:'2025-09-06T14:15:00.000Z',
  holdoutStart:'2026-09-06T14:15:00.000Z',
  minAggregate:300,
  minCohort:30,
  minPf:1.10,
  minPositiveAssets:5,
  maxPositiveAssetSharePct:40
});

export function evaluateFibV2Replication(primary,secondary){
  const c=FIB_LEVEL_BOT_V2,summary=primary?.summary||{},folds=primary?.walkForward||[],sides=primary?.bySide||{},assets=primary?.bySymbol||{},groups=primary?.byUniverseGroup||{};
  const adequatePositiveAssets=Object.values(assets).filter(x=>(x?.closedBaskets||0)>=c.minCohort&&(x?.profitFactor||0)>1&&(x?.expectancy||0)>0).length;
  const shares=Object.values(primary?.positiveNetRConcentrationPct||{}).filter(Number.isFinite);
  const gates={
    aggregateSample:(summary.closedBaskets||0)>=c.minAggregate,
    aggregateEdge:(summary.profitFactor||0)>=c.minPf&&(summary.expectancy||0)>0,
    allFoldsPositive:folds.length===3&&folds.every(x=>(x?.summary?.profitFactor||0)>1&&(x?.summary?.expectancy||0)>0),
    bothSidesPositive:['LONG','SHORT'].every(k=>(sides[k]?.profitFactor||0)>1&&(sides[k]?.expectancy||0)>0),
    assetBreadth:adequatePositiveAssets>=c.minPositiveAssets,
    universeBreadth:['CORE','EXPANSION'].every(k=>(groups[k]?.expectancy??-Infinity)>=0),
    concentration:shares.length>0&&Math.max(...shares)<=c.maxPositiveAssetSharePct,
    secondaryStress:(secondary?.summary?.profitFactor||0)>1&&(secondary?.summary?.expectancy||0)>0
  };
  return {schemaVersion:'FIB-LEVEL-BOT-V2-REPLICATION-GATE',researchOnly:true,executionImpact:false,gates,historicalReplicated:Object.values(gates).every(Boolean),promotionPermitted:false,adequatePositiveAssets};
}
