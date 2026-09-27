// MERIDIAN ETH FUNDING CARRY HOLDOUT — frozen research-only evaluator.
// Long spot + short USD-M perpetual with equal base quantity.
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const norm=a=>(Array.isArray(a)?a:[]).map(x=>({ts:Number(x.ts??x.time??x.fundingTime),close:Number(x.close??x.price??x.markPrice),rate:Number(x.rate??x.fundingRate)})).filter(x=>Number.isFinite(x.ts)).sort((a,b)=>a.ts-b.ts);
const atOrBefore=(a,t)=>{let out=null;for(const x of a){if(x.ts>t)break;out=x;}return out;};

export const ETH_FUNDING_HOLDOUT_RULESET='10.0-RESEARCH-ETH-FUNDING-HOLDOUT-V1';
export const ETH_FUNDING_HOLDOUT_CONFIG=Object.freeze({
  symbol:'ETHUSDT',
  start:Date.UTC(2024,0,1),
  end:Date.UTC(2026,5,1),
  notionalPerLeg:10000,
  spotFeeBps:10,
  perpFeeBps:5,
  slippageBps:3
});

export function evaluateEthFundingHoldout({spot,perp,funding,start=ETH_FUNDING_HOLDOUT_CONFIG.start,end=ETH_FUNDING_HOLDOUT_CONFIG.end,notionalPerLeg=ETH_FUNDING_HOLDOUT_CONFIG.notionalPerLeg,spotFeeBps=ETH_FUNDING_HOLDOUT_CONFIG.spotFeeBps,perpFeeBps=ETH_FUNDING_HOLDOUT_CONFIG.perpFeeBps,slippageBps=ETH_FUNDING_HOLDOUT_CONFIG.slippageBps}={}){
  const s=norm(spot).filter(x=>x.close>0),p=norm(perp).filter(x=>x.close>0),f=norm(funding).filter(x=>Number.isFinite(x.rate)&&x.close>0);
  const from=Number(start),to=Number(end),s0=atOrBefore(s,from),p0=atOrBefore(p,from),s1=atOrBefore(s,to),p1=atOrBefore(p,to);
  if(!(Number(notionalPerLeg)>0)||!s0||!p0||!s1||!p1||!(to>from))return{eligible:false,decision:'INSUFFICIENT_DATA',reasons:['INSUFFICIENT_COMMON_HISTORY'],ruleset:ETH_FUNDING_HOLDOUT_RULESET,researchOnly:true,executionImpact:false};
  const qty=Number(notionalPerLeg)/s0.close,periods=f.filter(x=>x.ts>from&&x.ts<=to);
  if(!periods.length)return{eligible:false,decision:'INSUFFICIENT_DATA',reasons:['NO_FUNDING_PERIODS'],ruleset:ETH_FUNDING_HOLDOUT_RULESET,researchOnly:true,executionImpact:false};
  const fundingIncome=periods.reduce((sum,x)=>sum+qty*x.close*x.rate,0);
  const spotPnl=qty*(s1.close-s0.close),perpPnl=qty*(p0.close-p1.close),basisPnl=spotPnl+perpPnl;
  const spotCosts=qty*(s0.close+s1.close)*Number(spotFeeBps)/10000;
  const perpCosts=qty*(p0.close+p1.close)*Number(perpFeeBps)/10000;
  const slippageCosts=qty*(s0.close+s1.close+p0.close+p1.close)*Number(slippageBps)/10000;
  const costs=spotCosts+perpCosts+slippageCosts,netPnl=fundingIncome+basisPnl-costs,capital=Number(notionalPerLeg)*2,days=(to-from)/86400000;
  const positive=periods.filter(x=>x.rate>0).length,negative=periods.filter(x=>x.rate<0).length,zero=periods.length-positive-negative;
  return{symbol:'ETHUSDT',eligible:netPnl>0,decision:netPnl>0?'POSITIVE_HOLDOUT':'REJECT',start:from,end:to,days:round(days,2),periods:periods.length,positivePeriods:positive,negativePeriods:negative,zeroPeriods:zero,positiveShare:round(positive/periods.length,4),notionalPerLeg:Number(notionalPerLeg),conservativeCapital:capital,quantity:round(qty,10),spotStart:s0.close,spotEnd:s1.close,perpStart:p0.close,perpEnd:p1.close,fundingIncome:round(fundingIncome,2),basisPnl:round(basisPnl,2),spotCosts:round(spotCosts,2),perpCosts:round(perpCosts,2),slippageCosts:round(slippageCosts,2),costs:round(costs,2),netPnl:round(netPnl,2),returnOnConservativeCapitalPct:round(netPnl/capital*100,3),annualizedPct:days>0?round(netPnl/capital*100*365/days,3):null,spotFeeBps:Number(spotFeeBps),perpFeeBps:Number(perpFeeBps),slippageBps:Number(slippageBps),ruleset:ETH_FUNDING_HOLDOUT_RULESET,researchOnly:true,executionImpact:false};
}

export function classifyEthFundingHoldout(full,blocks=[]){
  if(!full||full.decision==='INSUFFICIENT_DATA'||blocks.some(x=>x?.decision==='INSUFFICIENT_DATA'))return{decision:'INSUFFICIENT_DATA',paperCandidate:false,reasons:['HOLDOUT_DATA_INCOMPLETE']};
  const losing=blocks.filter(x=>Number(x.netPnl)<=0).map(x=>x.label||'BLOCK');
  if(Number(full.netPnl)<=0)return{decision:'REJECT',paperCandidate:false,reasons:['FULL_HOLDOUT_NOT_POSITIVE',...(losing.length?['NEGATIVE_CALENDAR_BLOCK']:[])]};
  if(losing.length)return{decision:'WATCH',paperCandidate:false,reasons:['NEGATIVE_CALENDAR_BLOCK'],losingBlocks:losing};
  return{decision:'PAPER_CANDIDATE',paperCandidate:true,reasons:['FULL_HOLDOUT_POSITIVE','ALL_FROZEN_CALENDAR_BLOCKS_POSITIVE']};
}
