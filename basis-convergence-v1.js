// MERIDIAN Basis Convergence V1 — frozen research contract.
// Market-neutral long spot / short perp basis compression. Research only.

export const BASIS_CONVERGENCE_V1=Object.freeze({
  version:'BASIS-CONVERGENCE-V1',
  symbols:Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT']),
  evaluationStart:'2021-01-01T00:00:00.000Z',
  splitAt:'2023-07-01T00:00:00.000Z',
  evaluationEnd:'2026-06-01T00:00:00.000Z',
  spotNotional:10000,
  referenceCapital:20000,
  spotFeeRate:.001,
  perpFeeRate:.0005,
  slippageRate:.0003,
  entryBasisPct:.75,
  exitBasisPct:.10,
  maxBasisWideningPct:1.00,
  maxMarkedLossUsd:200,
  maxHoldMs:14*24*3600000,
  cooldownMs:24*3600000,
  extraStressUsdPerBasket:8
});

export function entryExecution(spotOpen,perpOpen){
  const c=BASIS_CONVERGENCE_V1;
  const spotAsk=Number(spotOpen)*(1+c.slippageRate),perpBid=Number(perpOpen)*(1-c.slippageRate);
  return{spotAsk,perpBid,basisPct:(perpBid-spotAsk)/spotAsk*100};
}
export function exitExecution(spotOpen,perpOpen){
  const c=BASIS_CONVERGENCE_V1;
  const spotBid=Number(spotOpen)*(1-c.slippageRate),perpAsk=Number(perpOpen)*(1+c.slippageRate);
  return{spotBid,perpAsk,basisPct:(perpAsk-spotBid)/spotBid*100};
}
export function selectBasisCandidate(candidates=[]){
  const order=new Map(BASIS_CONVERGENCE_V1.symbols.map((s,i)=>[s,i]));
  return candidates.filter(x=>order.has(x.symbol)&&Number(x.basisPct)>=BASIS_CONVERGENCE_V1.entryBasisPct)
    .slice().sort((a,b)=>Number(b.basisPct)-Number(a.basisPct)||(order.get(a.symbol)-order.get(b.symbol)))[0]||null;
}
