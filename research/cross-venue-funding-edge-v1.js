export const CROSS_VENUE_FUNDING_EDGE_V1='CROSS-VENUE-FUNDING-EDGE-V1';

export const CROSS_VENUE_FUNDING_EDGE_V1_CONFIG=Object.freeze({
  symbol:'BTCUSDT',
  venues:Object.freeze({binance:'BINANCE_USDM',bybit:'BYBIT_LINEAR'}),
  notionalPerLeg:10000,
  reservedCapital:20000,
  projectionIntervals:3,
  fundingIntervalMs:8*60*60*1000,
  projectionHorizonHours:24,
  maxHoldingHours:24,
  binanceTakerBps:5,
  bybitTakerBps:5.5,
  slippageBps:3,
  stressSlippageBps:6,
  operationalBufferBps:5,
  entrySafetyMultiple:1.5,
  basisLossLimitPctOfOneLeg:1,
  gate:Object.freeze({
    minProfitFactor:1.20,
    maxDrawdownPct:8,
    minPositiveWindows:4,
    maxPositiveMonthConcentrationPct:35,
    minClosedFundingSettlements:100,
    minCompletedPositionCycles:20
  })
});

const finite=x=>Number.isFinite(Number(x));
const sign=x=>Number(x)>0?1:Number(x)<0?-1:0;
const abs=x=>Math.abs(Number(x));

export function roundTripCosts(cfg=CROSS_VENUE_FUNDING_EDGE_V1_CONFIG){
  const feeBps=2*Number(cfg.binanceTakerBps)+2*Number(cfg.bybitTakerBps);
  const baseSlippageBps=4*Number(cfg.slippageBps);
  const stressSlippageBps=4*Number(cfg.stressSlippageBps);
  const baseBps=feeBps+baseSlippageBps+Number(cfg.operationalBufferBps);
  const stressBps=feeBps+stressSlippageBps+Number(cfg.operationalBufferBps);
  const baseUsd=Number(cfg.notionalPerLeg)*baseBps/10000;
  const stressUsd=Number(cfg.notionalPerLeg)*stressBps/10000;
  const closeBps=Number(cfg.binanceTakerBps)+Number(cfg.bybitTakerBps)+2*Number(cfg.slippageBps);
  const closeUsd=Number(cfg.notionalPerLeg)*closeBps/10000;
  return Object.freeze({
    feeBps,baseSlippageBps,stressSlippageBps,baseBps,stressBps,closeBps,
    baseUsd,stressUsd,closeUsd,
    entryHurdleUsd:baseUsd*Number(cfg.entrySafetyMultiple),
    closeHurdleUsd:closeUsd*Number(cfg.entrySafetyMultiple)
  });
}

export function fundingSpread(binanceRate,bybitRate){
  if(!finite(binanceRate)||!finite(bybitRate))throw new Error('CROSS_VENUE_V1_INVALID_FUNDING_RATE');
  return Number(bybitRate)-Number(binanceRate);
}

export function conservativeProjection(spreads=[],cfg=CROSS_VENUE_FUNDING_EDGE_V1_CONFIG){
  const n=Number(cfg.projectionIntervals);
  const xs=(spreads||[]).slice(-n).map(Number);
  if(xs.length!==n||xs.some(x=>!finite(x)))return{valid:false,reason:'INSUFFICIENT_SPREAD_HISTORY'};
  const directions=xs.map(sign);
  if(directions.some(x=>x===0)||!directions.every(x=>x===directions[0]))return{valid:false,reason:'SPREAD_NOT_PERSISTENT'};
  const conservative8hSpread=Math.min(...xs.map(abs));
  const projectedSpread=conservative8hSpread*n;
  const direction=directions[0];
  return{
    valid:true,
    direction,
    directionLabel:direction>0?'LONG_BINANCE_SHORT_BYBIT':'LONG_BYBIT_SHORT_BINANCE',
    conservative8hSpread,
    projectedSpread,
    projectedFundingUsd:Number(cfg.notionalPerLeg)*projectedSpread
  };
}

export function entryDecision(spreads=[],cfg=CROSS_VENUE_FUNDING_EDGE_V1_CONFIG){
  const projection=conservativeProjection(spreads,cfg);
  if(!projection.valid)return{active:false,reason:projection.reason,projection};
  const costs=roundTripCosts(cfg);
  const active=projection.projectedFundingUsd>costs.entryHurdleUsd;
  return{
    active,
    reason:active?'ENTRY':'PROJECTED_FUNDING_BELOW_HURDLE',
    projection,
    costs
  };
}

export function remainingFundingIntervals(remainingHours,cfg=CROSS_VENUE_FUNDING_EDGE_V1_CONFIG){
  if(!finite(remainingHours)||Number(remainingHours)<=0)return 0;
  return Math.max(0,Math.floor(Number(remainingHours)/(Number(cfg.fundingIntervalMs)/3600000)));
}

export function exitDecision({heldDirection,spreads=[],remainingHours,basisPnlUsd,integrityOk=true}={},cfg=CROSS_VENUE_FUNDING_EDGE_V1_CONFIG){
  if(integrityOk!==true)return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true};
  if(![1,-1].includes(Number(heldDirection)))throw new Error('CROSS_VENUE_V1_INVALID_HELD_DIRECTION');
  if(!finite(basisPnlUsd))return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true};
  const basisFloor=-Number(cfg.notionalPerLeg)*Number(cfg.basisLossLimitPctOfOneLeg)/100;
  if(Number(basisPnlUsd)<=basisFloor)return{exit:true,reason:'BASIS_RISK_LIMIT',inconclusive:false};
  if(!finite(remainingHours)||Number(remainingHours)<=0)return{exit:true,reason:'MAX_HOLDING_HORIZON',inconclusive:false};
  const projection=conservativeProjection(spreads,cfg);
  if(!projection.valid)return{exit:true,reason:'SPREAD_NOT_PERSISTENT',inconclusive:false,projection};
  if(projection.direction!==Number(heldDirection))return{exit:true,reason:'SPREAD_REVERSAL',inconclusive:false,projection};
  const intervals=remainingFundingIntervals(remainingHours,cfg);
  if(intervals<=0)return{exit:true,reason:'MAX_HOLDING_HORIZON',inconclusive:false,projection};
  const projectedRemainingUsd=Number(cfg.notionalPerLeg)*projection.conservative8hSpread*intervals;
  const hurdle=roundTripCosts(cfg).closeHurdleUsd;
  if(!(projectedRemainingUsd>hurdle))return{exit:true,reason:'REMAINING_FUNDING_BELOW_EXIT_HURDLE',inconclusive:false,projection,projectedRemainingUsd,hurdle};
  return{exit:false,reason:'HOLD',inconclusive:false,projection,projectedRemainingUsd,hurdle};
}

export function fundingCashflow({side,qty,mark,rate}={}){
  if(!['LONG','SHORT'].includes(side)||![qty,mark,rate].every(finite)||Number(qty)<0||Number(mark)<=0)throw new Error('CROSS_VENUE_V1_INVALID_FUNDING_CASHFLOW');
  const payment=Number(qty)*Number(mark)*Number(rate);
  return side==='LONG'?-payment:payment;
}

export function basisPnl({binanceSide,binanceQty,binanceEntry,binanceMark,bybitSide,bybitQty,bybitEntry,bybitMark}={}){
  const fields=[binanceQty,binanceEntry,binanceMark,bybitQty,bybitEntry,bybitMark];
  if(!['LONG','SHORT'].includes(binanceSide)||!['LONG','SHORT'].includes(bybitSide)||fields.some(x=>!finite(x)))throw new Error('CROSS_VENUE_V1_INVALID_BASIS_INPUT');
  const leg=(side,qty,entry,mark)=>(side==='LONG'?1:-1)*Number(qty)*(Number(mark)-Number(entry));
  return leg(binanceSide,binanceQty,binanceEntry,binanceMark)+leg(bybitSide,bybitQty,bybitEntry,bybitMark);
}

export function directionLegs(direction){
  if(Number(direction)===1)return{binance:'LONG',bybit:'SHORT'};
  if(Number(direction)===-1)return{binance:'SHORT',bybit:'LONG'};
  throw new Error('CROSS_VENUE_V1_INVALID_DIRECTION');
}
