// MERIDIAN BTC FUNDING CARRY V1 — isolated, prospective PAPER state machine.
// Equal BTC quantity: long spot + short USD-M perpetual. No live execution.
const DAY=86400000;
const round=(v,d=8)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const copy=x=>JSON.parse(JSON.stringify(x));

export const FUNDING_CARRY_PAPER_V1_RULESET='8.0-PAPER-BTC-FUNDING-CARRY-V1';
export const FUNDING_CARRY_PAPER_V1_CONFIG=Object.freeze({
  symbol:'BTCUSDT',startEquity:20000,notionalPerLeg:10000,
  feeBps:5,slippageBps:3,entryLookbackDays:30,minFundingPeriods:80,
  minRollingFundingRate:.0045,minPositiveShare:.8,reviewDays:30,
  reversalLookbackDays:7,maxBasisDivergencePct:1.5,maxLossPct:1
});

export function newFundingCarryPaperState(now=Date.now(),cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  return {schemaVersion:'1.0',ruleset:FUNDING_CARRY_PAPER_V1_RULESET,researchOnly:true,executionImpact:false,
    lifecycle:'WAITING_ENTRY',account:{startEquity:cfg.startEquity,equity:cfg.startEquity,realizedPnl:0},
    basket:null,closedCycles:[],settlements:[],lastEligibility:null,lastCheckedAt:null,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
}

export function fundingEligibility(rows,now=Date.now(),cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  const from=now-cfg.entryLookbackDays*DAY;
  const periods=(Array.isArray(rows)?rows:[]).map(x=>({fundingTime:Number(x.fundingTime??x.ts),fundingRate:Number(x.fundingRate??x.rate),markPrice:Number(x.markPrice??x.price)}))
    .filter(x=>x.fundingTime>=from&&x.fundingTime<=now&&Number.isFinite(x.fundingRate)).sort((a,b)=>a.fundingTime-b.fundingTime);
  const sumFundingRate=periods.reduce((s,x)=>s+x.fundingRate,0),positivePeriods=periods.filter(x=>x.fundingRate>0).length;
  const positiveShare=periods.length?positivePeriods/periods.length:0,reasons=[];
  if(periods.length<cfg.minFundingPeriods)reasons.push('INSUFFICIENT_FUNDING_HISTORY');
  if(sumFundingRate<cfg.minRollingFundingRate)reasons.push('FUNDING_BELOW_COST_BUFFER');
  if(positiveShare<cfg.minPositiveShare)reasons.push('FUNDING_NOT_PERSISTENT');
  return {eligible:reasons.length===0,reasons,lookbackDays:cfg.entryLookbackDays,periods:periods.length,positivePeriods,
    positiveShare:round(positiveShare,4),sumFundingRate:round(sumFundingRate,8),minimumRate:cfg.minRollingFundingRate,evaluatedAt:new Date(now).toISOString()};
}

export function openFundingCarryPaper(state,snapshot,eligibility,{now=Date.now(),id='btc-funding-carry-v1'}={},cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  if(state?.lifecycle!=='WAITING_ENTRY'||state?.basket)throw new Error('funding carry is not waiting for entry');
  if(!eligibility?.eligible)throw new Error('funding carry entry gate rejected');
  const spot=Number(snapshot?.spotPrice),perp=Number(snapshot?.perpMarkPrice);
  if(!(spot>0&&perp>0))throw new Error('invalid funding carry entry prices');
  const out=copy(state),qty=cfg.notionalPerLeg/spot,feeRate=cfg.feeBps/10000;
  out.lifecycle='ACTIVE_PAPER';out.lastEligibility=copy(eligibility);
  out.basket={id,symbol:cfg.symbol,status:'OPEN',openedAt:new Date(now).toISOString(),reviewAt:new Date(now+cfg.reviewDays*DAY).toISOString(),
    quantity:round(qty,10),spotSide:'LONG',perpSide:'SHORT',spotEntry:spot,perpEntry:perp,
    entryFees:round(qty*(spot+perp)*feeRate,8),fundingIncome:0,basisPnl:0,estimatedCloseCosts:0,netPnl:0,
    appliedFundingThrough:null,lastMarkedAt:new Date(now).toISOString()};
  return markFundingCarryPaper(out,snapshot,now,cfg);
}

export function applyFundingSettlements(state,rows,now=Date.now()){
  const out=copy(state);if(!out.basket||out.basket.status!=='OPEN')return out;
  const after=Math.max(new Date(out.basket.openedAt).getTime(),Number(out.basket.appliedFundingThrough)||0);
  const fresh=(Array.isArray(rows)?rows:[]).map(x=>({fundingTime:Number(x.fundingTime??x.ts),fundingRate:Number(x.fundingRate??x.rate),markPrice:Number(x.markPrice??x.price)}))
    .filter(x=>x.fundingTime>after&&x.fundingTime<=now&&Number.isFinite(x.fundingRate)&&x.markPrice>0).sort((a,b)=>a.fundingTime-b.fundingTime);
  for(const x of fresh){
    const amount=out.basket.quantity*x.markPrice*x.fundingRate;
    out.basket.fundingIncome+=amount;out.basket.appliedFundingThrough=x.fundingTime;
    out.settlements.push({fundingTime:x.fundingTime,at:new Date(x.fundingTime).toISOString(),rate:round(x.fundingRate,8),markPrice:round(x.markPrice,8),income:round(amount,8)});
  }
  out.settlements=out.settlements.slice(-250);out.basket.fundingIncome=round(out.basket.fundingIncome,8);out.updatedAt=new Date(now).toISOString();return out;
}

export function markFundingCarryPaper(state,snapshot,now=Date.now(),cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  const out=copy(state);if(!out.basket||out.basket.status!=='OPEN')return out;
  const spot=Number(snapshot?.spotPrice),perp=Number(snapshot?.perpMarkPrice),q=out.basket.quantity;
  if(!(spot>0&&perp>0))throw new Error('invalid funding carry mark prices');
  const feeRate=cfg.feeBps/10000,slipRate=cfg.slippageBps/10000;
  const basisPnl=q*(spot-out.basket.spotEntry)+q*(out.basket.perpEntry-perp);
  const closeFees=q*(spot+perp)*feeRate,slippage=q*(out.basket.spotEntry+out.basket.perpEntry+spot+perp)*slipRate;
  const totalCosts=out.basket.entryFees+closeFees+slippage;
  const net=basisPnl+out.basket.fundingIncome-totalCosts;
  Object.assign(out.basket,{spotMark:spot,perpMark:perp,basisPct:round((perp-spot)/spot*100,5),basisPnl:round(basisPnl,8),
    estimatedCloseCosts:round(closeFees,8),estimatedSlippage:round(slippage,8),totalEstimatedCosts:round(totalCosts,8),netPnl:round(net,8),lastMarkedAt:new Date(now).toISOString()});
  out.account.equity=round(out.account.startEquity+net,8);out.account.realizedPnl=round(out.basket.fundingIncome-out.basket.entryFees,8);
  out.updatedAt=new Date(now).toISOString();return out;
}

export function fundingCarryExitReason(state,recentFunding=[],now=Date.now(),cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  const b=state?.basket;if(!b||b.status!=='OPEN')return null;
  if(now>=new Date(b.reviewAt).getTime())return 'REVIEW_30D';
  if(Number(b.netPnl)<=-cfg.startEquity*cfg.maxLossPct/100)return 'MAX_LOSS';
  if(Math.abs(Number(b.basisPct))>=cfg.maxBasisDivergencePct)return 'BASIS_DIVERGENCE';
  const from=now-cfg.reversalLookbackDays*DAY,rates=(Array.isArray(recentFunding)?recentFunding:[]).filter(x=>Number(x.fundingTime??x.ts)>=from&&Number(x.fundingTime??x.ts)<=now);
  if(rates.length>=18&&rates.reduce((s,x)=>s+Number(x.fundingRate??x.rate??0),0)<=0)return 'FUNDING_REVERSAL_7D';
  return null;
}

export function closeFundingCarryPaper(state,snapshot,reason,now=Date.now(),cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  let out=markFundingCarryPaper(state,snapshot,now,cfg);if(!out.basket||out.basket.status!=='OPEN')throw new Error('no open funding carry basket');
  const done={...out.basket,status:'CLOSED',closedAt:new Date(now).toISOString(),exitReason:String(reason||'MANUAL_REVIEW'),realizedPnl:out.basket.netPnl};
  out.closedCycles.push(done);out.basket=null;out.lifecycle='STOPPED_REVIEW';out.account.realizedPnl=done.realizedPnl;out.account.equity=round(out.account.startEquity+done.realizedPnl,8);out.updatedAt=new Date(now).toISOString();return out;
}

export function fundingCarryPaperStatus(state,cfg=FUNDING_CARRY_PAPER_V1_CONFIG){
  const s=state||newFundingCarryPaperState();return {enabled:true,researchOnly:true,executionImpact:false,autoPromotion:false,
    ruleset:FUNDING_CARRY_PAPER_V1_RULESET,lifecycle:s.lifecycle,lastCheckedAt:s.lastCheckedAt,account:s.account,basket:s.basket,
    lastEligibility:s.lastEligibility,settlements:(s.settlements||[]).slice(-5).reverse(),closedCycles:(s.closedCycles||[]).slice(-3).reverse(),
    policy:{symbol:cfg.symbol,notionalPerLeg:cfg.notionalPerLeg,entryFundingMinimum:cfg.minRollingFundingRate,reviewDays:cfg.reviewDays,maxLossPct:cfg.maxLossPct}};
}
