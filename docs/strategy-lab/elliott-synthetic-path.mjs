// Bounded synthetic already-open path proxy; no entry, signal or receipt engine.
import {validateClosedBars, admitTargetGeometry, accountExplicitFills} from './elliott-correction-helpers.mjs';
const SCHEMA='ELLIOTT_ALREADY_OPEN_PATH_DRAFT_V1';
const FLAGS=Object.freeze({researchOnly:true,executionAuthorized:false,empiricalRunAuthorized:false,
  historicalAvailabilityVerified:false,revisionHistoryVerified:false,receiptAuthenticated:false});
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x))&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const dense=(a,max)=>Array.isArray(a)&&a.length<=max&&Reflect.ownKeys(a).length===a.length+1&&
  Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).every(Boolean);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const time=x=>Number.isSafeInteger(x)&&x>=0;
const fail=error=>({valid:false,error,...FLAGS});
const costKeys=['entryCostQuote','target1CostQuote','target2CostQuote','fullStopCostQuote','residualStopCostQuote'];
const barKeys=['openTimeMs','closeTimeMs','open','high','low','close','volume'];

export function replayAlreadyOpenSyntheticPath(input){
  if(!exact(input,['schemaVersion','fixtureId','timeframe','asOfMs','mode','initialPosition','quoteCurrency','stopSlippagePrice','costs','bars'])||
    input.schemaVersion!==SCHEMA||typeof input.fixtureId!=='string'||!/^[A-Za-z0-9_.-]{1,40}$/.test(input.fixtureId)||input.fixtureId.includes('\n')||
    !exact(input.initialPosition,['side','entryAtMs','entryPrice','originalStopPrice','initialQuantity','targets'])||!exact(input.costs,costKeys))return fail('INPUT_SCHEMA');
  if(!['NEXT_BAR_BREAK_EVEN','NO_RELOCATION'].includes(input.mode))return fail('UNSUPPORTED_MODE');
  if(typeof input.quoteCurrency!=='string'||!/^[A-Z][A-Z0-9_]{0,15}$/.test(input.quoteCurrency)||input.quoteCurrency.includes('\n'))return fail('QUOTE_CURRENCY');
  if(!['4H','1D'].includes(input.timeframe)||!time(input.asOfMs))return fail('TIME_CONTRACT');
  if(!dense(input.bars,256)||input.bars.length<1)return fail('BARS_LENGTH');
  // Per-bar validation preserves the helper's first-error order while rejecting symbol keys too.
  for(let i=0;i<input.bars.length;i++){
    const b=input.bars[i];
    if(!exact(b,barKeys))return fail('BAR_SCHEMA');
    const result=validateClosedBars({schemaVersion:'ELLIOTT_CLOSED_BARS_V1',timeframe:input.timeframe,asOfMs:input.asOfMs,bars:[b]});
    // Sequence precedes OHLC in the full helper contract.
    if(!result.valid&&result.error!=='OHLCV')return fail(result.error);
    if(i&&b.openTimeMs!==input.bars[i-1].closeTimeMs)return fail('BAR_SEQUENCE');
    if(!result.valid)return fail(result.error);
  }
  const p=input.initialPosition;
  if(!time(p.entryAtMs)||p.entryAtMs>=input.bars[0].openTimeMs)return fail('INITIAL_POSITION_TIME');
  if(!positive(p.initialQuantity))return fail('INVALID_INITIAL_RISK');
  const geometry=admitTargetGeometry({schemaVersion:'ELLIOTT_TARGET_GEOMETRY_V1',side:p.side,entryPrice:p.entryPrice,originalStopPrice:p.originalStopPrice,targets:p.targets});
  if(!geometry.valid)return fail(geometry.error);
  if(!dense(p.targets,2)||p.targets.length!==2)return fail('INVALID_TARGET_GEOMETRY');
  if(!nonnegative(input.stopSlippagePrice))return fail('INVALID_SLIPPAGE');
  for(const key of costKeys)if(input.costs[key]!==null&&!nonnegative(input.costs[key]))return fail('INVALID_COST');
  const D=geometry.originalRiskPerUnit;
  if(!positive(p.initialQuantity*D))return fail('NUMERIC_RANGE');
  const state={originalRiskDistance:D,effectiveStopPrice:p.originalStopPrice,remainingPortionPpm:1000000,
    target1Filled:false,target2Filled:false,pendingBreakEvenAtMs:null,closed:false};
  const events=[],sign=p.side==='LONG'?1:-1;
  const stopTouched=price=>sign*(price-state.effectiveStopPrice)<=0;
  const targetTouched=(price,index)=>sign*(price-p.targets[index])>=0;
  function emit(kind,index,bar,phase,price,portion,costQuote,ambiguity='NONE'){
    events.push({eventId:`${input.fixtureId}.${index}.${kind}`,kind,barIndex:index,
      barOpenTimeMs:bar.openTimeMs,barCloseTimeMs:bar.closeTimeMs,phase,
      modeledFillTimeMs:phase==='OPEN'?bar.openTimeMs:null,portionPpm:portion,fillPrice:price,costQuote,ambiguity});
    state.remainingPortionPpm-=portion;
    state.closed=state.remainingPortionPpm===0;
    if(state.closed)state.pendingBreakEvenAtMs=null;
  }
  function stop(index,bar,phase,base,ambiguity){
    const price=base-sign*input.stopSlippagePrice;
    if(!positive(price))return false;
    const portion=state.remainingPortionPpm;
    emit('STOP',index,bar,phase,price,portion,input.costs[portion===1000000?'fullStopCostQuote':'residualStopCostQuote'],ambiguity);
    return true;
  }
  function targets(index,bar,phase,probe){
    for(let t=0;t<2;t++){
      const key=t===0?'target1Filled':'target2Filled';
      if(!state[key]&&targetTouched(probe,t)){
        emit(t===0?'TP1':'TP2',index,bar,phase,p.targets[t],500000,input.costs[t===0?'target1CostQuote':'target2CostQuote']);
        state[key]=true;
        if(t===0&&!state.closed&&input.mode==='NEXT_BAR_BREAK_EVEN')state.pendingBreakEvenAtMs=bar.closeTimeMs;
      }
    }
  }
  for(let i=0;i<input.bars.length;i++){
    if(state.closed)break;
    const b=input.bars[i];
    if(state.pendingBreakEvenAtMs===b.openTimeMs){state.effectiveStopPrice=p.entryPrice;state.pendingBreakEvenAtMs=null;}
    if(stopTouched(b.open)){
      if(!stop(i,b,'OPEN',b.open,'NONE'))return fail('FILL_PRICE');
      continue;
    }
    targets(i,b,'OPEN',b.open);
    if(state.closed)continue;
    const adverse=sign===1?b.low:b.high,favorable=sign===1?b.high:b.low;
    if(stopTouched(adverse)){
      const conflict=(!state.target1Filled&&targetTouched(favorable,0))||(!state.target2Filled&&targetTouched(favorable,1));
      if(!stop(i,b,'RANGE_PROXY',state.effectiveStopPrice,conflict?'AMBIGUOUS_STOP_FIRST':'NONE'))return fail('FILL_PRICE');
      continue;
    }
    targets(i,b,'RANGE_PROXY',favorable);
  }
  const result=accountExplicitFills({schemaVersion:'ELLIOTT_EXPLICIT_FILL_ACCOUNTING_V1',quoteCurrency:input.quoteCurrency,
    side:p.side,entryPrice:p.entryPrice,originalStopPrice:p.originalStopPrice,initialQuantity:p.initialQuantity,
    entryCostQuote:input.costs.entryCostQuote,exits:events.map(({eventId,portionPpm,fillPrice,costQuote})=>({eventId,portionPpm,fillPrice,costQuote}))});
  if(!result.valid)return fail(result.error);
  const accounting={};
  for(const key of ['grossRealizedR','netRealizedR','knownCostQuote','costStatus','exitedPortionPpm','remainingPortionPpm','closed'])accounting[key]=result[key];
  return {valid:true,schemaVersion:SCHEMA,fixtureId:input.fixtureId,mode:input.mode,finalState:state,events,accounting,...FLAGS};
}
