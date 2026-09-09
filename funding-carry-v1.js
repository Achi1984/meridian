// MERIDIAN FUNDING CARRY V1 — research-only delta-neutral replay.
// Long spot + short USD-M perpetual with equal base quantity.
const round=(v,d=6)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const rows=a=>(Array.isArray(a)?a:[]).map(x=>({ts:Number(x.ts??x.time??x.fundingTime),close:Number(x.close??x.price??x.markPrice),rate:Number(x.rate??x.fundingRate)})).filter(x=>Number.isFinite(x.ts)).sort((a,b)=>a.ts-b.ts);
const atOrBefore=(a,t)=>{let out=null;for(const x of a){if(x.ts>t)break;out=x;}return out;};

export const FUNDING_CARRY_V1_RULESET='8.0-RESEARCH-FUNDING-CARRY-V1';

export function evaluateFundingCarry({symbol,spot,perp,funding,notional=10000,feeBps=5,slippageBps=3,start,end}={}){
  const s=rows(spot).filter(x=>x.close>0),p=rows(perp).filter(x=>x.close>0),f=rows(funding).filter(x=>Number.isFinite(x.rate)&&x.close>0);
  const from=Number(start??Math.max(s[0]?.ts??Infinity,p[0]?.ts??Infinity,f[0]?.ts??Infinity));
  const to=Number(end??Math.min(s.at(-1)?.ts??-Infinity,p.at(-1)?.ts??-Infinity,f.at(-1)?.ts??-Infinity));
  const s0=atOrBefore(s,from),p0=atOrBefore(p,from),s1=atOrBefore(s,to),p1=atOrBefore(p,to);
  if(!(Number(notional)>0)||!s0||!p0||!s1||!p1||!(to>from))return{eligible:false,reasons:['INSUFFICIENT_COMMON_HISTORY'],ruleset:FUNDING_CARRY_V1_RULESET,researchOnly:true,executionImpact:false};
  const quantity=Number(notional)/s0.close,periods=f.filter(x=>x.ts>from&&x.ts<=to);
  const fundingIncome=periods.reduce((sum,x)=>sum+quantity*x.close*x.rate,0);
  const spotPnl=quantity*(s1.close-s0.close),perpPnl=quantity*(p0.close-p1.close),basisPnl=spotPnl+perpPnl;
  const rate=(Number(feeBps)+Number(slippageBps))/10000;
  const costs=quantity*(s0.close+p0.close+s1.close+p1.close)*rate;
  const netPnl=fundingIncome+basisPnl-costs,capital=Number(notional)*2;
  const days=(to-from)/86400000,sumRates=periods.reduce((sum,x)=>sum+x.rate,0),positive=periods.filter(x=>x.rate>0).length,negative=periods.filter(x=>x.rate<0).length;
  return{symbol:String(symbol||'').toUpperCase(),eligible:netPnl>0,decision:netPnl>0?'PROSPECTIVE_CANDIDATE':'REJECT',start:from,end:to,days:round(days,2),periods:periods.length,positivePeriods:positive,negativePeriods:negative,notional:Number(notional),conservativeCapital:capital,quantity:round(quantity,8),spotStart:s0.close,spotEnd:s1.close,perpStart:p0.close,perpEnd:p1.close,sumFundingRate:round(sumRates,8),fundingIncome:round(fundingIncome,2),basisPnl:round(basisPnl,2),costs:round(costs,2),netPnl:round(netPnl,2),returnOnConservativeCapitalPct:round(netPnl/capital*100,3),annualizedPct:days>0?round(netPnl/capital*100*365/days,3):null,feeBps:Number(feeBps),slippageBps:Number(slippageBps),ruleset:FUNDING_CARRY_V1_RULESET,researchOnly:true,executionImpact:false};
}
