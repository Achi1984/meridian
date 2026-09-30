import {PAPER_PROFIT_CONTROL_V2_STAGE_B} from './paperbot-profit-control-v2-stage-b.js';

export const TSMOM_V2_PREREGISTRATION=Object.freeze({
  ruleset:'PAPER_PROFIT_TSMOM_V2_PREREGISTERED',
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false,
  universe:Object.freeze(["BTC","ETH","SOL","XRP","HBAR","LINK","AVAX","SUI"]),
  config:Object.freeze({
    lookbacks:Object.freeze([30,90,365]),
    rebalanceDays:30,
    volLookbackDays:60,
    targetVolAnnual:0.1,
    maxLeverage:2,
    baselineCostBps:8,
    stressCostBps:16,
    allowLong:true,
    allowShort:true,
    pyramiding:false,
    martingale:false,
    averagingDown:false
  }),
  split:Object.freeze({
    method:'CHRONOLOGICAL_COMMON_TIMESTAMPS',
    discoveryFraction:0.70,
    holdoutFraction:0.30,
    splitBeforeReturnEvaluation:true,
    insufficientSampleDecision:'INSUFFICIENT_SPLIT_SAMPLE'
  }),
  gate:PAPER_PROFIT_CONTROL_V2_STAGE_B.gate
});

export function freezeTsmomV2Split(commonTimestamps=[]){
  const xs=[...new Set((commonTimestamps||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(xs.length<2) return Object.freeze({ok:false,reason:'INSUFFICIENT_TIMESTAMPS'});
  const cut=Math.max(1,Math.min(xs.length-1,Math.floor(xs.length*TSMOM_V2_PREREGISTRATION.split.discoveryFraction)));
  return Object.freeze({
    ok:true,
    method:TSMOM_V2_PREREGISTRATION.split.method,
    totalTimestamps:xs.length,
    discoveryCount:cut,
    holdoutCount:xs.length-cut,
    discoveryFrom:xs[0],
    discoveryTo:xs[cut-1],
    holdoutFrom:xs[cut],
    holdoutTo:xs.at(-1),
    splitTimestamp:xs[cut]
  });
}
