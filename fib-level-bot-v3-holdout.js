// Locked prospective evaluation contract for FIB Level Bot V3.
export const FIB_V3_HOLDOUT=Object.freeze({
  strategyHead:'7b15a8b37431af317bc5d8b50ef960024b353982',
  start:'2026-09-06T14:15:00.000Z',
  earliestEligibility:'2027-03-05T14:15:00.000Z',
  minClosedBaskets:100,
  minSideBaskets:30,
  minAssetBaskets:15,
  minPositiveAssets:5,
  minProfitFactor:1.10,
  maxPositiveAssetSharePct:40,
  maxDrawdownR:20
});

const positive=x=>(x?.profitFactor||0)>1&&(x?.expectancy||0)>0;
export function evaluateFibV3Holdout(snapshot,cutoff){
  const c=FIB_V3_HOLDOUT,s=snapshot?.summary||{},folds=snapshot?.walkForward||[],sides=snapshot?.bySide||{},assets=snapshot?.bySymbol||{},groups=snapshot?.byUniverseGroup||{};
  const timeEligible=Date.parse(cutoff)>=Date.parse(c.earliestEligibility),sampleEligible=(s.closedBaskets||0)>=c.minClosedBaskets;
  if(!timeEligible||!sampleEligible)return {status:'NOT_ELIGIBLE',timeEligible,sampleEligible,reviewPermitted:false,promotionPermitted:false};
  const positiveAssets=Object.values(assets).filter(x=>(x?.closedBaskets||0)>=c.minAssetBaskets&&positive(x)).length,shares=Object.values(snapshot?.positiveNetRConcentrationPct||{}).filter(Number.isFinite);
  const gates={aggregateEdge:(s.profitFactor||0)>=c.minProfitFactor&&(s.expectancy||0)>0,chronologicalThirds:folds.length===3&&folds.every(x=>positive(x.summary)),bothSides:['LONG','SHORT'].every(k=>(sides[k]?.closedBaskets||0)>=c.minSideBaskets&&positive(sides[k])),assetBreadth:positiveAssets>=c.minPositiveAssets,universeBreadth:['CORE','EXPANSION'].every(k=>(groups[k]?.expectancy??-Infinity)>=0),concentration:shares.length>0&&Math.max(...shares)<=c.maxPositiveAssetSharePct,drawdown:(s.maxDrawdownR??Infinity)<=c.maxDrawdownR,dataAdequacy:snapshot?.dataAdequate===true};
  return {status:Object.values(gates).every(Boolean)?'REVIEW_ELIGIBLE':'FAILED',timeEligible,sampleEligible,gates,positiveAssets,reviewPermitted:Object.values(gates).every(Boolean),promotionPermitted:false};
}
