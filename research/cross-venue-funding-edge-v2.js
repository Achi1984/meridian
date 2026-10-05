import crypto from 'node:crypto';

export const CROSS_VENUE_FUNDING_EDGE_V2='CROSS-VENUE-FUNDING-EDGE-V2';

export const CROSS_VENUE_FUNDING_EDGE_V2_CONFIG=Object.freeze({
  symbol:'BTCUSDT',
  venues:Object.freeze({binance:'BINANCE_USDM',okx:'OKX_USDT_SWAP'}),
  notionalPerLeg:10000,
  reservedCapital:20000,
  projectionIntervals:3,
  fundingIntervalMs:8*60*60*1000,
  projectionHorizonHours:24,
  maxHoldingHours:24,
  binanceTakerBps:5,
  okxTakerBps:5,
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

const DECIMAL=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function strictNum(value){
  if(typeof value==='number')return Number.isFinite(value)?value:NaN;
  if(typeof value!=='string')return NaN;
  const s=value.trim();
  if(!s||!DECIMAL.test(s))return NaN;
  const n=Number(s);
  return Number.isFinite(n)?n:NaN;
}

function finiteNumber(value){
  const n=strictNum(value);
  return Number.isFinite(n)?n:null;
}

function integrityProjection(reason='DATA_INTEGRITY_FAILURE'){
  return{valid:false,reason,inconclusive:true};
}

export function costBreakdown(scenario='baseline',cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  if(!['baseline','stress'].includes(scenario))throw new Error('CROSS_VENUE_V2_INVALID_COST_SCENARIO');
  const notional=finiteNumber(cfg.notionalPerLeg);
  const bFee=finiteNumber(cfg.binanceTakerBps),oFee=finiteNumber(cfg.okxTakerBps);
  const slip=finiteNumber(scenario==='stress'?cfg.stressSlippageBps:cfg.slippageBps);
  const op=finiteNumber(cfg.operationalBufferBps);
  const multiple=finiteNumber(cfg.entrySafetyMultiple);
  if([notional,bFee,oFee,slip,op,multiple].some(x=>x===null)||notional<=0||bFee<0||oFee<0||slip<0||op<0||multiple<=0)
    throw new Error('CROSS_VENUE_V2_INVALID_COST_CONFIG');
  const feeBps=2*bFee+2*oFee;
  const slippageBps=4*slip;
  const roundTripBps=feeBps+slippageBps+op;
  const roundTripUsd=notional*roundTripBps/10000;
  const closeBps=bFee+oFee+2*slip;
  const closeUsd=notional*closeBps/10000;
  return Object.freeze({
    scenario,
    notionalPerLeg:notional,
    fills:4,
    feeBps,
    slippageBpsPerFill:slip,
    slippageBps,
    operationalBufferBps:op,
    roundTripBps,
    roundTripUsd,
    closeBps,
    closeUsd,
    entryHurdleUsd:roundTripUsd*multiple,
    closeHurdleUsd:closeUsd*multiple
  });
}

export function fundingSpread(binanceRate,okxRate){
  const b=finiteNumber(binanceRate),o=finiteNumber(okxRate);
  if(b===null||o===null)throw new Error('CROSS_VENUE_V2_INVALID_FUNDING_RATE');
  return o-b;
}

export function conservativeProjection(spreads=[],cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  if(!Array.isArray(spreads))return integrityProjection();
  const n=finiteNumber(cfg.projectionIntervals);
  const notional=finiteNumber(cfg.notionalPerLeg);
  if(n===null||!Number.isInteger(n)||n<=0||notional===null||notional<=0)return integrityProjection();
  if(spreads.length<n)return{valid:false,reason:'INSUFFICIENT_SPREAD_HISTORY',inconclusive:false};
  const raw=spreads.slice(-n);
  const xs=raw.map(strictNum);
  if(xs.some(x=>!Number.isFinite(x)))return integrityProjection();
  const directions=xs.map(x=>x>0?1:x<0?-1:0);
  if(directions.some(x=>x===0)||!directions.every(x=>x===directions[0]))
    return{valid:false,reason:'SPREAD_NOT_PERSISTENT',inconclusive:false};
  const conservative8hSpread=Math.min(...xs.map(Math.abs));
  const projectedSpread=conservative8hSpread*n;
  const direction=directions[0];
  return{
    valid:true,
    inconclusive:false,
    direction,
    directionLabel:direction>0?'LONG_BINANCE_SHORT_OKX':'LONG_OKX_SHORT_BINANCE',
    conservative8hSpread,
    projectedSpread,
    projectedFundingUsd:notional*projectedSpread
  };
}

export function entryDecision(spreads=[],cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  const projection=conservativeProjection(spreads,cfg);
  if(!projection.valid)return{
    active:false,
    reason:projection.reason,
    inconclusive:projection.inconclusive===true,
    projection
  };
  const costs=costBreakdown('baseline',cfg);
  const active=projection.projectedFundingUsd>costs.entryHurdleUsd;
  return{
    active,
    reason:active?'ENTRY':'PROJECTED_FUNDING_BELOW_HURDLE',
    inconclusive:false,
    projection,
    costs
  };
}

export function remainingFundingIntervals(remainingHours,cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  const h=finiteNumber(remainingHours),stepMs=finiteNumber(cfg.fundingIntervalMs);
  if(h===null||stepMs===null||stepMs<=0)throw new Error('CROSS_VENUE_V2_INVALID_REMAINING_HOURS');
  if(h<=0)return 0;
  return Math.max(0,Math.floor(h/(stepMs/3600000)));
}

export function exitDecision({heldDirection,spreads=[],remainingHours,basisPnlUsd,integrityOk=true}={},cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  if(integrityOk!==true)return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true};
  if(typeof heldDirection!=='number'||![1,-1].includes(heldDirection))
    return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true};
  const basis=finiteNumber(basisPnlUsd),hours=finiteNumber(remainingHours);
  const notional=finiteNumber(cfg.notionalPerLeg),basisPct=finiteNumber(cfg.basisLossLimitPctOfOneLeg);
  if(basis===null||hours===null||notional===null||basisPct===null||notional<=0||basisPct<0)
    return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true};
  const basisFloor=-notional*basisPct/100;
  if(basis<=basisFloor)return{exit:true,reason:'BASIS_RISK_LIMIT',inconclusive:false};
  if(hours<=0)return{exit:true,reason:'MAX_HOLDING_HORIZON',inconclusive:false};
  const projection=conservativeProjection(spreads,cfg);
  if(!projection.valid){
    if(projection.inconclusive)return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true,projection};
    return{exit:true,reason:'SPREAD_NOT_PERSISTENT',inconclusive:false,projection};
  }
  if(projection.direction!==heldDirection)return{exit:true,reason:'SPREAD_REVERSAL',inconclusive:false,projection};
  let intervals;
  try{intervals=remainingFundingIntervals(hours,cfg)}catch{return{exit:true,reason:'DATA_INTEGRITY_FAILURE',inconclusive:true}}
  if(intervals<=0)return{exit:true,reason:'MAX_HOLDING_HORIZON',inconclusive:false,projection};
  const projectedRemainingUsd=notional*projection.conservative8hSpread*intervals;
  const hurdle=costBreakdown('baseline',cfg).closeHurdleUsd;
  if(!(projectedRemainingUsd>hurdle))
    return{exit:true,reason:'REMAINING_FUNDING_BELOW_EXIT_HURDLE',inconclusive:false,projection,projectedRemainingUsd,hurdle};
  return{exit:false,reason:'HOLD',inconclusive:false,projection,projectedRemainingUsd,hurdle};
}

export function fundingCashflow({side,qty,mark,rate}={}){
  if(!['LONG','SHORT'].includes(side))throw new Error('CROSS_VENUE_V2_INVALID_FUNDING_CASHFLOW');
  const q=finiteNumber(qty),m=finiteNumber(mark),r=finiteNumber(rate);
  if(q===null||m===null||r===null||q<=0||m<=0)throw new Error('CROSS_VENUE_V2_INVALID_FUNDING_CASHFLOW');
  const payment=q*m*r;
  return side==='LONG'?-payment:payment;
}

export function basisPnl({binanceSide,binanceQty,binanceEntry,binanceMark,okxSide,okxQty,okxEntry,okxMark}={}){
  if(!['LONG','SHORT'].includes(binanceSide)||!['LONG','SHORT'].includes(okxSide))
    throw new Error('CROSS_VENUE_V2_INVALID_BASIS_INPUT');
  const values=[binanceQty,binanceEntry,binanceMark,okxQty,okxEntry,okxMark].map(finiteNumber);
  if(values.some(x=>x===null))throw new Error('CROSS_VENUE_V2_INVALID_BASIS_INPUT');
  const [bq,be,bm,oq,oe,om]=values;
  if(bq<=0||oq<=0||be<=0||bm<=0||oe<=0||om<=0)throw new Error('CROSS_VENUE_V2_INVALID_BASIS_INPUT');
  const leg=(side,qty,entry,mark)=>(side==='LONG'?1:-1)*qty*(mark-entry);
  return leg(binanceSide,bq,be,bm)+leg(okxSide,oq,oe,om);
}

export function directionLegs(direction){
  if(direction===1)return{binance:'LONG',okx:'SHORT'};
  if(direction===-1)return{binance:'SHORT',okx:'LONG'};
  throw new Error('CROSS_VENUE_V2_INVALID_DIRECTION');
}

function strictTime(value,label){
  const n=finiteNumber(value);
  if(n===null||!Number.isSafeInteger(n)||n<=0)throw new Error(label);
  return n;
}

export function positionOpenAtDetection({entryFillTime,exitFillTime=null,detectionTime}={}){
  const entry=strictTime(entryFillTime,'CROSS_VENUE_V2_INVALID_ENTRY_TIME');
  const detection=strictTime(detectionTime,'CROSS_VENUE_V2_INVALID_DETECTION_TIME');
  let exit=null;
  if(exitFillTime!==null&&exitFillTime!==undefined)exit=strictTime(exitFillTime,'CROSS_VENUE_V2_INVALID_EXIT_TIME');
  if(exit!==null&&exit<entry)throw new Error('CROSS_VENUE_V2_EXIT_BEFORE_ENTRY');
  return entry<=detection&&(exit===null||exit>=detection);
}

export function degradationOutcome({positionOpenAtDetection:open}={}){
  if(typeof open!=='boolean')throw new Error('CROSS_VENUE_V2_INVALID_DEGRADATION_STATE');
  if(open)return Object.freeze({
    status:'INCONCLUSIVE',
    reason:'OPEN_POSITION_AT_DATA_DEGRADATION',
    terminal:true,
    mayAdvance:false,
    entryAllowed:false
  });
  return Object.freeze({
    status:'DATA_DEGRADED',
    reason:'FLAT_AT_DATA_DEGRADATION',
    terminal:false,
    mayAdvance:false,
    entryAllowed:false
  });
}

export function assertV2StageAdvanceAllowed(outcome){
  if(outcome?.status==='INCONCLUSIVE'||outcome?.terminal===true)
    throw new Error('CROSS_VENUE_V2_INCONCLUSIVE_TERMINAL');
  if(outcome?.mayAdvance!==true)
    throw new Error('CROSS_VENUE_V2_STAGE_ADVANCE_BLOCKED');
  return true;
}

export function reconcileCycleAccounting({fundingCashflows=[],basisPnlUsd,costsUsd,openingEquity,closingEquity,tolerance=1e-8}={}){
  if(!Array.isArray(fundingCashflows))throw new Error('CROSS_VENUE_V2_INVALID_ACCOUNTING_INPUT');
  const funding=fundingCashflows.map(finiteNumber);
  const basis=finiteNumber(basisPnlUsd),costs=finiteNumber(costsUsd),open=finiteNumber(openingEquity),close=finiteNumber(closingEquity),tol=finiteNumber(tolerance);
  if(funding.some(x=>x===null)||[basis,costs,open,close,tol].some(x=>x===null)||costs<0||open<0||close<0||tol<0)
    throw new Error('CROSS_VENUE_V2_INVALID_ACCOUNTING_INPUT');
  const fundingUsd=funding.reduce((a,b)=>a+b,0);
  const expectedDelta=fundingUsd+basis-costs;
  const actualDelta=close-open;
  const reconciliationError=actualDelta-expectedDelta;
  if(Math.abs(reconciliationError)>tol)throw new Error('CROSS_VENUE_V2_ACCOUNTING_RECONCILIATION');
  return{
    ok:true,
    fundingUsd,
    basisPnlUsd:basis,
    costsUsd:costs,
    expectedDelta,
    actualDelta,
    reconciliationError
  };
}

function canonicalTradePath(path=[]){
  if(!Array.isArray(path))throw new Error('CROSS_VENUE_V2_INVALID_TRADE_PATH');
  return path.map((x,i)=>{
    if(!x||typeof x!=='object')throw new Error('CROSS_VENUE_V2_INVALID_TRADE_PATH');
    if(!['BINANCE','OKX'].includes(x.venue)||!['LONG','SHORT'].includes(x.side))
      throw new Error('CROSS_VENUE_V2_INVALID_TRADE_PATH');
    const time=finiteNumber(x.time),qty=finiteNumber(x.qty),mark=finiteNumber(x.mark);
    if(time===null||!Number.isSafeInteger(time)||time<=0||qty===null||qty<=0||mark===null||mark<=0)
      throw new Error('CROSS_VENUE_V2_INVALID_TRADE_PATH');
    return{index:i,venue:x.venue,side:x.side,time,qty,mark};
  });
}

export function tradePathDigest(path=[]){
  const canonical=canonicalTradePath(path);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function scenarioPathIdentity(path=[],scenario='baseline',cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  if(!['baseline','stress'].includes(scenario))throw new Error('CROSS_VENUE_V2_INVALID_COST_SCENARIO');
  const costs=costBreakdown(scenario,cfg);
  return Object.freeze({
    scenario,
    tradePathDigest:tradePathDigest(path),
    slippageBpsPerFill:costs.slippageBpsPerFill
  });
}
