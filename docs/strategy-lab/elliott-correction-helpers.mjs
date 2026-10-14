// Offline arithmetic and timing helpers; not an Elliott strategy or fill engine.
const FLAGS=Object.freeze({researchOnly:true,executionAuthorized:false,empiricalRunAuthorized:false,
  historicalAvailabilityVerified:false,revisionHistoryVerified:false,receiptAuthenticated:false});
const DAY=86400000,H4=14400000,PPM=1000000;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,names)=>record(x)&&Object.keys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k));
const time=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const cost=x=>x===null||nonnegative(x);
const fail=error=>({valid:false,error,...FLAGS});
const ok=details=>({valid:true,...details,...FLAGS});
const duration=x=>x==='4H'?H4:x==='1D'?DAY:null;
const dense=a=>Array.isArray(a)&&a.length<=10000&&Object.keys(a).length===a.length&&Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).every(Boolean);
function rawBars(bars,timeframe,asOfMs){
  const step=duration(timeframe);
  if(step===null||!time(asOfMs))return 'TIME_CONTRACT';
  if(!dense(bars)||bars.length<1||bars.length>10000)return 'BARS_LENGTH';
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(!exact(b,['openTimeMs','closeTimeMs','open','high','low','close','volume']))return 'BAR_SCHEMA';
    if(!time(b.openTimeMs)||!time(b.closeTimeMs)||b.openTimeMs%step!==0||b.closeTimeMs-b.openTimeMs!==step)return 'BAR_TIME';
    if(b.closeTimeMs>asOfMs)return 'FUTURE_OR_INCOMPLETE_BAR';
    if(i&&b.openTimeMs!==bars[i-1].closeTimeMs)return 'BAR_SEQUENCE';
    if(![b.open,b.high,b.low,b.close].every(positive)||!nonnegative(b.volume)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))return 'OHLCV';
  }
  return null;
}
export function validateClosedBars(input){
  if(!exact(input,['schemaVersion','timeframe','asOfMs','bars'])||input.schemaVersion!=='ELLIOTT_CLOSED_BARS_V1')return fail('INPUT_SCHEMA');
  const error=rawBars(input.bars,input.timeframe,input.asOfMs);if(error)return fail(error);
  return ok({barCount:input.bars.length,timeframe:input.timeframe,publicationAdmitted:false});
}
export function aggregateUtcDay(input){
  if(!exact(input,['schemaVersion','asOfMs','bars'])||input.schemaVersion!=='ELLIOTT_UTC_DAY_V1')return fail('INPUT_SCHEMA');
  const error=rawBars(input.bars,'4H',input.asOfMs);if(error)return fail(error);
  const b=input.bars;
  if(b.length!==6||b[0].openTimeMs%DAY!==0||b[5].closeTimeMs-b[0].openTimeMs!==DAY)return fail('EXACT_UTC_DAY_REQUIRED');
  const volume=b.reduce((s,x)=>s+x.volume,0);if(!Number.isFinite(volume))return fail('NUMERIC_RANGE');
  return ok({bar:{openTimeMs:b[0].openTimeMs,closeTimeMs:b[5].closeTimeMs,open:b[0].open,high:Math.max(...b.map(x=>x.high)),low:Math.min(...b.map(x=>x.low)),close:b[5].close,volume},publicationAdmitted:false});
}
export function pivotConfirmationTime(input){
  if(!exact(input,['schemaVersion','timeframe','asOfMs','bars','pivotIndex','leftBars','rightBars'])||input.schemaVersion!=='ELLIOTT_PIVOT_TIME_V1')return fail('INPUT_SCHEMA');
  const error=rawBars(input.bars,input.timeframe,input.asOfMs);if(error)return fail(error);
  const {pivotIndex,leftBars,rightBars,bars}=input;
  if(!Number.isSafeInteger(pivotIndex)||!Number.isSafeInteger(leftBars)||!Number.isSafeInteger(rightBars)||leftBars<1||rightBars<1||leftBars>bars.length||rightBars>bars.length||pivotIndex<leftBars||pivotIndex>=bars.length-rightBars)return fail('PIVOT_WINDOW');
  return ok({geometricConfirmationAtMs:bars[pivotIndex+rightBars].closeTimeMs,confirmationIndex:pivotIndex+rightBars,pricePatternValidated:false,publicationAdmitted:false});
}
export function admitObservationTime(input){
  if(!record(input)||input.schemaVersion!=='ELLIOTT_OBSERVATION_ADMISSION_V1')return fail('INPUT_SCHEMA');
  const actual=input.mode==='ACTUAL_RECEIPT',assumed=input.mode==='ASSUMED_PUBLICATION';
  if(!actual&&!assumed)return fail('UNSUPPORTED_MODE');
  const names=['schemaVersion','mode','geometricConfirmationAtMs','decisionAtMs'];
  names.push(...(actual?['receivedAtMs']:['publicationDelayMs','archiveRetrievedAtMs','assumptionId']));
  if(!exact(input,names))return fail('INPUT_SCHEMA');
  const {geometricConfirmationAtMs:g,decisionAtMs:d}=input;
  if(!time(g)||!time(d))return fail('TIME_CONTRACT');
  if(actual){
    if(!time(input.receivedAtMs)||input.receivedAtMs<g)return fail('RECEIPT_TIME');
    if(d<input.receivedAtMs)return fail('NOT_YET_RECEIVED');
    return ok({mode:input.mode,geometricConfirmationAtMs:g,decisionAtMs:d,receivedAtMs:input.receivedAtMs,eligibleUnderSuppliedReceipt:true});
  }
  if(!time(input.publicationDelayMs)||!time(input.archiveRetrievedAtMs)||input.archiveRetrievedAtMs<g)return fail('ASSUMPTION_TIME');
  if(typeof input.assumptionId!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(input.assumptionId)||input.assumptionId.includes('\n'))return fail('ASSUMPTION_ID');
  const assumedPublicationAtMs=g+input.publicationDelayMs;if(!time(assumedPublicationAtMs))return fail('TIME_OVERFLOW');
  if(d<assumedPublicationAtMs)return fail('NOT_YET_ASSUMED_PUBLISHED');
  return ok({mode:input.mode,geometricConfirmationAtMs:g,decisionAtMs:d,assumptionId:input.assumptionId,publicationDelayMs:input.publicationDelayMs,archiveRetrievedAtMs:input.archiveRetrievedAtMs,assumedPublicationAtMs,eligibleUnderAssumption:true});
}
function risk(side,entry,stop){
  if(!['LONG','SHORT'].includes(side)||!positive(entry)||!positive(stop))return null;
  const d=(side==='LONG'?1:-1)*(entry-stop);return positive(d)?d:null;
}
export function admitTargetGeometry(input){
  if(!exact(input,['schemaVersion','side','entryPrice','originalStopPrice','targets'])||input.schemaVersion!=='ELLIOTT_TARGET_GEOMETRY_V1')return fail('INPUT_SCHEMA');
  const D=risk(input.side,input.entryPrice,input.originalStopPrice);if(D===null)return fail('INVALID_INITIAL_RISK');
  if(!dense(input.targets)||input.targets.length<1||input.targets.length>10)return fail('INVALID_TARGET_GEOMETRY');
  const sign=input.side==='LONG'?1:-1;let previous=input.entryPrice;
  for(const target of input.targets){if(!positive(target)||!Number.isFinite(sign*(target-previous))||sign*(target-previous)<=0)return fail('INVALID_TARGET_GEOMETRY');previous=target;}
  return ok({originalRiskPerUnit:D,targets:[...input.targets],fillEstablished:false});
}
export function accountExplicitFills(input){
  if(!exact(input,['schemaVersion','quoteCurrency','side','entryPrice','originalStopPrice','initialQuantity','entryCostQuote','exits'])||input.schemaVersion!=='ELLIOTT_EXPLICIT_FILL_ACCOUNTING_V1')return fail('INPUT_SCHEMA');
  if(typeof input.quoteCurrency!=='string'||!/^[A-Z][A-Z0-9_]{0,15}$/.test(input.quoteCurrency)||input.quoteCurrency.includes('\n'))return fail('QUOTE_CURRENCY');
  const D=risk(input.side,input.entryPrice,input.originalStopPrice);
  if(D===null||!positive(input.initialQuantity))return fail('INVALID_INITIAL_RISK');
  const normalization=input.initialQuantity*D;if(!positive(normalization))return fail('NUMERIC_RANGE');
  if(!cost(input.entryCostQuote))return fail('INVALID_COST');
  if(!dense(input.exits)||input.exits.length>1000)return fail('EXIT_LIST');
  const sign=input.side==='LONG'?1:-1,ids=new Set();let total=0,grossR=0,knownCosts=input.entryCostQuote??0,unknown=input.entryCostQuote===null;
  for(const e of input.exits){
    if(!exact(e,['eventId','portionPpm','fillPrice','costQuote']))return fail('EXIT_SCHEMA');
    if(typeof e.eventId!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(e.eventId)||e.eventId.includes('\n'))return fail('EVENT_ID');
    if(ids.has(e.eventId))return fail('DUPLICATE_EVENT');ids.add(e.eventId);
    if(!Number.isSafeInteger(e.portionPpm)||e.portionPpm<1||e.portionPpm>PPM)return fail('EXIT_PORTION');
    total+=e.portionPpm;if(total>PPM)return fail('OVER_EXIT');
    if(!positive(e.fillPrice))return fail('FILL_PRICE');
    if(!cost(e.costQuote))return fail('INVALID_COST');
    const contribution=(e.portionPpm/PPM)*(sign*(e.fillPrice-input.entryPrice)/D);
    if(!Number.isFinite(contribution))return fail('NUMERIC_RANGE');grossR+=contribution;
    if(e.costQuote===null)unknown=true;else knownCosts+=e.costQuote;
    if(!Number.isFinite(grossR)||!Number.isFinite(knownCosts))return fail('NUMERIC_RANGE');
  }
  const costR=knownCosts/normalization,netR=unknown?null:grossR-costR;
  if(!Number.isFinite(costR)||(!unknown&&!Number.isFinite(netR)))return fail('NUMERIC_RANGE');
  return ok({quoteCurrency:input.quoteCurrency,originalRiskPerUnit:D,initialRiskQuote:normalization,
    exitedPortionPpm:total,remainingPortionPpm:PPM-total,closed:total===PPM,
    grossRealizedR:grossR,netRealizedR:netR,knownCostQuote:knownCosts,
    costStatus:unknown?'COSTS_UNRESOLVED':knownCosts===0?'SYNTHETIC_ZERO_COSTS':'EXPLICIT_QUOTE_COSTS',
    fillProvenanceVerified:false,durableExactlyOnceVerified:false});
}
