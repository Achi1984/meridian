import {
  CROSS_VENUE_FUNDING_EDGE_V2_CONFIG,
  strictNum,
  fundingSpread,
  entryDecision,
  exitDecision,
  basisPnl,
  directionLegs
} from './cross-venue-funding-edge-v2.js';
import {
  usableFundingMap,
  confirmedUniqueMarkSet,
  commonFundingTimes
} from './cross-venue-funding-edge-v2-data-contract.js';

const HOUR=60*60*1000;
const VALID_SEGMENTS=new Set(['WARMUP','SPLIT']);

function fail(code){throw new Error(code)}
function finite(value,code){
  const n=strictNum(value);
  if(!Number.isFinite(n))fail(code);
  return n;
}
function strictTime(value,code='CROSS_VENUE_V2_ADAPTER_INVALID_TIME'){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail(code);
  return value;
}
function strictBoolean(value,code){
  if(typeof value!=='boolean')fail(code);
  return value;
}
function strictNormalized(normalized){
  if(!normalized||typeof normalized!=='object'||Array.isArray(normalized))
    fail('CROSS_VENUE_V2_ADAPTER_NORMALIZED_SOURCE_REQUIRED');
  for(const key of ['binanceFunding','okxFunding','binanceMarks','okxMarks']){
    if(!Array.isArray(normalized[key]))fail('CROSS_VENUE_V2_ADAPTER_NORMALIZED_SOURCE_REQUIRED');
  }
  return normalized;
}
function rowAt(map,time,code){
  const row=map.get(time);
  if(!row)fail(code);
  return row;
}

function markMap(rows){
  const usable=confirmedUniqueMarkSet(rows);
  const out=new Map();
  for(const row of rows){
    if(usable.has(row.openTime))out.set(row.openTime,row);
  }
  return out;
}

export function v2LegQuantity(mark,cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG){
  const m=finite(mark,'CROSS_VENUE_V2_ADAPTER_INVALID_MARK');
  const notional=finite(cfg?.notionalPerLeg,'CROSS_VENUE_V2_ADAPTER_INVALID_NOTIONAL');
  if(m<=0||notional<=0)fail('CROSS_VENUE_V2_ADAPTER_INVALID_NOTIONAL');
  return notional/m;
}

export function createCrossVenueV2StrategyAdapter({normalized,cfg=CROSS_VENUE_FUNDING_EDGE_V2_CONFIG}={}){
  const source=strictNormalized(normalized);
  const bFunding=usableFundingMap(source.binanceFunding);
  const oFunding=usableFundingMap(source.okxFunding);
  const bMarks=markMap(source.binanceMarks);
  const oMarks=markMap(source.okxMarks);
  const common=Object.freeze(commonFundingTimes(source.binanceFunding,source.okxFunding));
  const fundingStep=finite(cfg?.fundingIntervalMs,'CROSS_VENUE_V2_ADAPTER_INVALID_CONFIG');
  const maxHolding=finite(cfg?.maxHoldingHours,'CROSS_VENUE_V2_ADAPTER_INVALID_CONFIG');
  if(!Number.isSafeInteger(fundingStep)||fundingStep<=0||!Number.isFinite(maxHolding)||maxHolding<=0)
    fail('CROSS_VENUE_V2_ADAPTER_INVALID_CONFIG');

  function spreadsForTimes(times){
    return times.map(time=>{
      const b=rowAt(bFunding,time,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
      const o=rowAt(oFunding,time,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
      return fundingSpread(b.rate,o.rate);
    });
  }

  function entryAt({decisionTime,sourceInputsReady,segment}={}){
    const t=strictTime(decisionTime);
    strictBoolean(sourceInputsReady,'CROSS_VENUE_V2_ADAPTER_INVALID_INPUT_READY_FLAG');
    if(!VALID_SEGMENTS.has(segment))fail('CROSS_VENUE_V2_ADAPTER_INVALID_SEGMENT');
    if(segment==='WARMUP')return Object.freeze({
      entryActive:false,direction:null,reason:'WARMUP',signalCalculated:false
    });
    if(sourceInputsReady!==true)return Object.freeze({
      entryActive:false,direction:null,reason:'SOURCE_NOT_READY',signalCalculated:false
    });

    const times=[t-2*fundingStep,t-fundingStep,t];
    const decision=entryDecision(spreadsForTimes(times),cfg);
    if(decision.inconclusive===true)
      fail('CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const direction=decision.active===true?decision.projection?.direction:null;
    if(decision.active===true&&![1,-1].includes(direction))
      fail('CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    return Object.freeze({
      entryActive:decision.active===true,
      direction:direction??null,
      reason:String(decision.reason),
      signalCalculated:true
    });
  }

  function exitAt({entryDecisionTime,entryFillTime,hour}={}){
    const decisionTime=strictTime(entryDecisionTime);
    const fillTime=strictTime(entryFillTime);
    const h=strictTime(hour);
    if(fillTime!==decisionTime+HOUR||h<=fillTime||(h-fillTime)%HOUR!==0)
      fail('CROSS_VENUE_V2_ADAPTER_INVALID_EXIT_CLOCK');

    const entrySignal=entryAt({
      decisionTime,
      sourceInputsReady:true,
      segment:'SPLIT'
    });
    if(entrySignal.entryActive!==true||![1,-1].includes(entrySignal.direction))
      fail('CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const heldDirection=entrySignal.direction;
    const legs=directionLegs(heldDirection);

    const bEntry=rowAt(bMarks,fillTime,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const oEntry=rowAt(oMarks,fillTime,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const currentOpenTime=h-HOUR;
    const bCurrent=rowAt(bMarks,currentOpenTime,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const oCurrent=rowAt(oMarks,currentOpenTime,'CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');

    const binanceQty=v2LegQuantity(bEntry.open,cfg);
    const okxQty=v2LegQuantity(oEntry.open,cfg);
    const basis=basisPnl({
      binanceSide:legs.binance,
      binanceQty,
      binanceEntry:bEntry.open,
      binanceMark:bCurrent.close,
      okxSide:legs.okx,
      okxQty,
      okxEntry:oEntry.open,
      okxMark:oCurrent.close
    });

    const commonAtHour=common.filter(time=>time<=h);
    const lastThree=commonAtHour.slice(-3);
    if(lastThree.length!==3)fail('CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');
    const spreads=spreadsForTimes(lastThree);
    const remainingHours=(fillTime+maxHolding*HOUR-h)/HOUR;
    const decision=exitDecision({
      heldDirection,
      spreads,
      remainingHours,
      basisPnlUsd:basis,
      integrityOk:true
    },cfg);
    if(decision.inconclusive===true)
      fail('CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE');

    return Object.freeze({
      exit:decision.exit===true,
      reason:String(decision.reason),
      heldDirection,
      signalCalculated:true
    });
  }

  return Object.freeze({
    entryAt,
    exitAt,
    commonFundingTimes:()=>common.slice()
  });
}
