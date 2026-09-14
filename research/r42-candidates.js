// R42 experimental signal screening. No orders, ledger mutation or runtime activation.
// Thresholds are hypotheses, not validated estimates of profitability.
const reject=(...reasons)=>({eligible:false,reasons});
const valid=x=>typeof x==='number'&&Number.isFinite(x);
const fresh=(at,now,max)=>valid(at)&&at<=now&&now-at<=max;
export const R42_POLICY=Object.freeze({version:'R42-SCREENING-V1',researchOnly:true,executionImpact:false,
  minUniverse:8,maxQuoteAgeMs:60000,minQuoteVolumeUsd:20000000,
  pairEntryZ:2.5,pairMaxZ:4,pairMaxPValue:.01,pairMinObservations:250,
  carryCoverage:2.5});

export function relativeMomentum(rows,now=Date.now()){
  const p=R42_POLICY;
  const usable=rows.filter(x=>fresh(x.quoteAt,now,p.maxQuoteAgeMs)&&valid(x.return30d)&&
    valid(x.beta)&&x.beta>0&&valid(x.quoteVolumeUsd)&&x.quoteVolumeUsd>=p.minQuoteVolumeUsd&&x.historyComplete===true);
  if(new Set(usable.map(x=>x.symbol)).size!==usable.length)return reject('DUPLICATE_SYMBOL');
  if(usable.length<p.minUniverse)return reject('INSUFFICIENT_LIQUID_UNIVERSE');
  usable.sort((a,b)=>b.return30d-a.return30d||a.symbol.localeCompare(b.symbol));
  const longs=usable.slice(0,2),shorts=usable.slice(-2);
  if(longs.at(-1).return30d<=shorts[0].return30d)return reject('NO_RANK_DISPERSION');
  // Equal dollars is not generally beta neutral. Report residual beta explicitly.
  const legs=[...longs.map(x=>({symbol:x.symbol,weight:.25,beta:x.beta})),...shorts.map(x=>({symbol:x.symbol,weight:-.25,beta:x.beta}))];
  const netBeta=legs.reduce((s,x)=>s+x.weight*x.beta,0);
  if(Math.abs(netBeta)>.10)return reject('BETA_IMBALANCE');
  return {eligible:true,reasons:[],legs,netBeta,rebalanceDays:7};
}

export function residualPairs(evidence,now=Date.now()){
  const e=evidence,p=R42_POLICY;
  if(!e||!fresh(e.asOf,now,3600000))return reject('STALE_PAIR_EVIDENCE');
  if(e.method!=='ENGLE_GRANGER_RESIDUAL_ADF'||e.multipleTestingAdjusted!==true)return reject('UNVERIFIED_COINTEGRATION');
  if(!valid(e.observations)||e.observations<p.pairMinObservations||!valid(e.pValue)||e.pValue<0||e.pValue>p.pairMaxPValue||e.stableAcrossWindows!==true)return reject('UNSTABLE_RELATIONSHIP');
  if(!valid(e.hedgeRatio)||e.hedgeRatio<=0||!valid(e.zScore)||!valid(e.expectedNetEdge)||e.expectedNetEdge<=0)return reject('INVALID_OR_UNECONOMIC_SPREAD');
  if(Math.abs(e.zScore)<p.pairEntryZ||Math.abs(e.zScore)>p.pairMaxZ)return reject('SPREAD_OUTSIDE_ENTRY_BAND');
  return {eligible:true,reasons:[],spreadSide:e.zScore>0?'SHORT_SPREAD':'LONG_SPREAD',hedgeRatio:e.hedgeRatio};
}

export function squeezeExhaustion(e,now=Date.now()){
  if(!e||!fresh(e.asOf,now,60000)||e.liquidationCoverageComplete!==true)return reject('INCOMPLETE_EVENT_DATA');
  if(![e.fundingPercentile,e.openInterestChange,e.liquidationPercentile,e.takerBuyShare].every(valid)||e.fundingPercentile<0||e.fundingPercentile>1||e.liquidationPercentile<0||e.liquidationPercentile>1||e.takerBuyShare<0||e.takerBuyShare>1)return reject('INVALID_EVENT_METRICS');
  if(e.openInterestChange>=0||e.liquidationPercentile<.95)return reject('NO_DELEVERAGING_EVENT');
  if(e.fundingPercentile>=.95&&e.takerBuyShare<.45&&e.confirmedCloseBelowVwap===true)return {eligible:true,reasons:[],side:'SHORT'};
  if(e.fundingPercentile<=.05&&e.takerBuyShare>.55&&e.confirmedCloseAboveVwap===true)return {eligible:true,reasons:[],side:'LONG'};
  return reject('NO_CONFIRMED_EXHAUSTION');
}

export function carrySelector(rows,now=Date.now()){
  const eligible=rows.filter(e=>fresh(e.asOf,now,60000)&&e.completeFundingHistory===true&&e.executableQuotes===true&&
    e.basisWithinBand===true&&e.liquidityPassed===true&&valid(e.conservativeFundingUsd)&&
    valid(e.allInRoundTripCostsUsd)&&e.allInRoundTripCostsUsd>0&&
    e.conservativeFundingUsd/e.allInRoundTripCostsUsd>=R42_POLICY.carryCoverage);
  if(!eligible.length)return reject('NO_COST_COVERED_CARRY');
  eligible.sort((a,b)=>(b.conservativeFundingUsd-b.allInRoundTripCostsUsd)-(a.conservativeFundingUsd-a.allInRoundTripCostsUsd));
  return {eligible:true,reasons:[],symbol:eligible[0].symbol,projectedNetUsd:eligible[0].conservativeFundingUsd-eligible[0].allInRoundTripCostsUsd};
}
