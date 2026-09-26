// MERIDIAN BTC FUNDING CARRY V2 — cost-amortized persistent carry shadow.
// Executable bid/ask assumptions, conservative funding gate, no venue execution.

const DAY=86400000,HOUR=3600000;
const copy=x=>structuredClone(x);
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

export const FUNDING_CARRY_V2_RULESET='8.40-PAPER-BTC-FUNDING-CARRY-V2-COST-AMORTIZED';
export const FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED=false;
export const FUNDING_CARRY_V2_RETIREMENT_REASON='REPEATABILITY_SAMPLE_GATE_6_LT_8';
export const FUNDING_CARRY_V2_CONFIG=Object.freeze({
  symbol:'BTCUSDT',startEquity:20000,notionalPerLeg:10000,spotFeeBps:10,perpFeeBps:5,slippageBps:3,
  projectionDays:30,minFundingPeriods30d:80,minFundingPeriods7d:18,minPositiveShare:.85,minGrossCostCoverage:2,
  minEntryBasisPct:-.10,maxEntryBasisPct:.75,maxFundingAgeHours:12,maxCadenceGapHours:12,
  checkpointDays:30,maxHoldDays:90,forwardCostBuffer:1.25,maxBasisChangePct:1.5,maxLossPct:1
});

function normalize(rows,now){return(Array.isArray(rows)?rows:[]).map(x=>({fundingTime:Number(x.fundingTime??x.ts),fundingRate:Number(x.fundingRate??x.rate),markPrice:Number(x.markPrice??x.price)})).filter(x=>x.fundingTime>0&&x.fundingTime<=now&&Number.isFinite(x.fundingRate)).sort((a,b)=>a.fundingTime-b.fundingTime);}
function estimatedRoundTripCosts(cfg){return cfg.notionalPerLeg*((cfg.spotFeeBps+cfg.perpFeeBps)*2+cfg.slippageBps*4)/10000;}

export function fundingEligibilityV2(rows,snapshot,now=Date.now(),cfg=FUNDING_CARRY_V2_CONFIG){
  const all=normalize(rows,now),p30=all.filter(x=>x.fundingTime>=now-30*DAY),p7=all.filter(x=>x.fundingTime>=now-7*DAY);
  const sum=a=>a.reduce((s,x)=>s+x.fundingRate,0),sum30=sum(p30),sum7=sum(p7),projectedRate=Math.min(sum30,sum7*(cfg.projectionDays/7));
  const projectedFundingUsd=projectedRate*cfg.notionalPerLeg,costs=estimatedRoundTripCosts(cfg),coverage=costs>0?projectedFundingUsd/costs:0;
  const positiveShare=p30.length?p30.filter(x=>x.fundingRate>0).length/p30.length:0,last=p30.at(-1),gaps=p30.slice(1).map((x,i)=>x.fundingTime-p30[i].fundingTime),maxGapHours=gaps.length?Math.max(...gaps)/HOUR:null;
  const spotAsk=Number(snapshot?.spotAsk),perpBid=Number(snapshot?.perpBid),basisPct=spotAsk>0&&perpBid>0?(perpBid-spotAsk)/spotAsk*100:null,reasons=[];
  if(p30.length<cfg.minFundingPeriods30d||p7.length<cfg.minFundingPeriods7d)reasons.push('INCOMPLETE_FUNDING_HISTORY');
  if(!last||now-last.fundingTime>cfg.maxFundingAgeHours*HOUR)reasons.push('STALE_FUNDING_HISTORY');
  if(maxGapHours!=null&&maxGapHours>cfg.maxCadenceGapHours)reasons.push('FUNDING_CADENCE_GAP');
  if(positiveShare<cfg.minPositiveShare)reasons.push('FUNDING_NOT_PERSISTENT');
  if(coverage<cfg.minGrossCostCoverage)reasons.push('NET_CARRY_BELOW_HURDLE');
  if(!Number.isFinite(basisPct)||basisPct<cfg.minEntryBasisPct||basisPct>cfg.maxEntryBasisPct)reasons.push('EXECUTABLE_BASIS_OUTSIDE_BAND');
  return{eligible:reasons.length===0,reasons,periods30d:p30.length,periods7d:p7.length,positiveShare:round(positiveShare,4),sum30dRate:round(sum30,8),sum7dRate:round(sum7,8),conservativeProjectedRate:round(projectedRate,8),projectedFundingUsd:round(projectedFundingUsd,2),estimatedRoundTripCostsUsd:round(costs,2),grossCostCoverage:round(coverage,2),executableEntryBasisPct:round(basisPct,5),maxCadenceGapHours:round(maxGapHours,2),evaluatedAt:new Date(now).toISOString()};
}

export function newFundingCarryV2State(now=Date.now(),cfg=FUNDING_CARRY_V2_CONFIG){const at=new Date(now).toISOString();return{schemaVersion:'1.0',ruleset:FUNDING_CARRY_V2_RULESET,researchOnly:true,executionImpact:false,lifecycle:'WAITING_ENTRY',frozenPolicy:{...cfg,frozenAt:at},account:{startEquity:cfg.startEquity,equity:cfg.startEquity,realizedPnl:0},basket:null,settlements:[],closedCycles:[],lastEligibility:null,lastCheckedAt:null,createdAt:at,updatedAt:at};}

export function openFundingCarryV2(state,snapshot,eligibility,now=Date.now()){
  if(state.lifecycle!=='WAITING_ENTRY'||state.basket)throw new Error('V2 not waiting for entry');if(!eligibility?.eligible)throw new Error('V2 entry rejected');
  const out=copy(state),cfg=out.frozenPolicy,spot=Number(snapshot?.spotAsk),perp=Number(snapshot?.perpBid);if(!(spot>0&&perp>0))throw new Error('invalid executable entry');
  const qty=cfg.notionalPerLeg/spot,entryFees=qty*spot*cfg.spotFeeBps/10000+qty*perp*cfg.perpFeeBps/10000,entrySlip=qty*(spot+perp)*cfg.slippageBps/10000;
  out.lifecycle='ACTIVE_PAPER';out.lastEligibility=copy(eligibility);out.basket={id:crypto.randomUUID(),status:'OPEN',symbol:cfg.symbol,openedAt:new Date(now).toISOString(),checkpointAt:new Date(now+cfg.checkpointDays*DAY).toISOString(),maxExitAt:new Date(now+cfg.maxHoldDays*DAY).toISOString(),quantity:round(qty,10),spotEntry:spot,perpEntry:perp,entryBasisPct:round((perp-spot)/spot*100,5),entryFees:round(entryFees,8),entrySlippage:round(entrySlip,8),fundingIncome:0,appliedFundingTimes:[],netPnl:round(-(entryFees+entrySlip),8)};return out;
}

export function applyFundingSettlementsV2(state,rows,now=Date.now()){
  const out=copy(state);if(!out.basket||out.basket.status!=='OPEN')return out;const applied=new Set(out.basket.appliedFundingTimes||[]),opened=Date.parse(out.basket.openedAt);
  for(const x of normalize(rows,now))if(x.fundingTime>opened&&!applied.has(x.fundingTime)&&x.markPrice>0){const income=out.basket.quantity*x.markPrice*x.fundingRate;out.basket.fundingIncome+=income;out.settlements.push({fundingTime:x.fundingTime,at:new Date(x.fundingTime).toISOString(),rate:round(x.fundingRate,8),income:round(income,8)});applied.add(x.fundingTime);}
  out.basket.appliedFundingTimes=[...applied].sort((a,b)=>a-b).slice(-500);out.basket.fundingIncome=round(out.basket.fundingIncome,8);out.settlements=out.settlements.slice(-500);out.updatedAt=new Date(now).toISOString();return out;
}

export function markFundingCarryV2(state,snapshot,now=Date.now()){
  const out=copy(state);if(!out.basket||out.basket.status!=='OPEN')return out;const cfg=out.frozenPolicy,b=out.basket,spot=Number(snapshot?.spotBid),perp=Number(snapshot?.perpAsk);if(!(spot>0&&perp>0))throw new Error('invalid executable exit mark');
  const q=b.quantity,basisPnl=q*(spot-b.spotEntry)+q*(b.perpEntry-perp),closeFees=q*spot*cfg.spotFeeBps/10000+q*perp*cfg.perpFeeBps/10000,closeSlip=q*(spot+perp)*cfg.slippageBps/10000,totalCosts=b.entryFees+b.entrySlippage+closeFees+closeSlip,net=basisPnl+b.fundingIncome-totalCosts,currentBasis=(perp-spot)/spot*100;
  Object.assign(b,{spotExitMark:spot,perpExitMark:perp,basisPct:round(currentBasis,5),basisChangePct:round(currentBasis-b.entryBasisPct,5),basisPnl:round(basisPnl,8),estimatedCloseFees:round(closeFees,8),estimatedCloseSlippage:round(closeSlip,8),totalEstimatedCosts:round(totalCosts,8),netPnl:round(net,8),lastMarkedAt:new Date(now).toISOString()});
  out.account.equity=round(out.account.startEquity+net,8);out.updatedAt=new Date(now).toISOString();return out;
}

export function fundingCarryV2ExitReason(state,recentRows,now=Date.now()){
  const b=state?.basket,cfg=state?.frozenPolicy;if(!b||b.status!=='OPEN')return null;
  if(now>=Date.parse(b.maxExitAt))return 'MAX_HOLD_90D';if(Number(b.netPnl)<=-cfg.startEquity*cfg.maxLossPct/100)return 'MAX_LOSS';if(Math.abs(Number(b.basisChangePct))>=cfg.maxBasisChangePct)return 'BASIS_CHANGE';
  if(now>=Date.parse(b.checkpointAt)){const rows=normalize(recentRows,now).filter(x=>x.fundingTime>=now-7*DAY),projected=rows.reduce((s,x)=>s+x.fundingRate,0)*(30/7)*cfg.notionalPerLeg;if(projected<Number(b.estimatedCloseFees||0)*cfg.forwardCostBuffer)return 'FORWARD_NET_CARRY_NEGATIVE';}
  return null;
}

export function closeFundingCarryV2(state,snapshot,reason,now=Date.now()){
  const out=markFundingCarryV2(state,snapshot,now),done={...out.basket,status:'CLOSED',closedAt:new Date(now).toISOString(),exitReason:reason,realizedPnl:out.basket.netPnl};out.closedCycles.push(done);out.basket=null;out.lifecycle='STOPPED_REVIEW';out.account.realizedPnl=done.realizedPnl;out.account.equity=round(out.account.startEquity+done.realizedPnl,8);out.updatedAt=new Date(now).toISOString();return out;
}

export function fundingCarryV2Status(state){const s=state||newFundingCarryV2State(),b=s.basket;return{enabled:true,researchOnly:true,executionImpact:false,autoPromotion:false,newEntriesAllowed:FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED,retirementReason:FUNDING_CARRY_V2_RETIREMENT_REASON,ruleset:s.ruleset,lifecycle:s.lifecycle,policy:s.frozenPolicy,account:s.account,basket:b,lastEligibility:s.lastEligibility,settlements:(s.settlements||[]).slice(-5).reverse(),telemetry:{breakEvenRemaining:b?round(Math.max(0,-Number(b.netPnl||0)),2):null,projectedFundingUsd:s.lastEligibility?.projectedFundingUsd??null,costCoverage:s.lastEligibility?.grossCostCoverage??null},closedCycles:(s.closedCycles||[]).slice(-3).reverse()};}
