// Offline unvalidated signal primitives. No imports, I/O, trades or activation.
const FIVE_MINUTES = 300000;
const DAY = 86400000;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value,key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
const dense = (value,min,max) => Array.isArray(value) && value.length >= min && value.length <= max
  && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({length:value.length},(_,index) => Object.getOwnPropertyDescriptor(value,String(index)))
    .every(descriptor => descriptor && Object.hasOwn(descriptor,'value'));
const validAsOf = value => Number.isSafeInteger(value) && value >= 0;
function validClock(bars,step,asOfMs) {
  for (let index=0;index<bars.length;index++) {
    const time = bars[index].closeTimeMs;
    if (!Number.isSafeInteger(time) || time < step || time % step !== 0 || time > asOfMs
      || (index > 0 && time-bars[index-1].closeTimeMs !== step)) return false;
  }
  return asOfMs-bars[bars.length-1].closeTimeMs < step;
}

export function evaluateH5Signal(input) {
  const base = {valid:false,errors:[],executionAuthorized:false,requiresTradePlan:true,status:'INVALID',signal:null};
  const invalid = error => ({...base,errors:[error]});
  const none = () => ({...base,valid:true,status:'NONE'});
  if (!exact(input,['asOfMs','bars']) || !validAsOf(input.asOfMs)
    || !dense(input.bars,23,25)) return invalid('H5 requires asOfMs and 23..25 dense bars');
  const bars = input.bars;
  for (const bar of bars) {
    if (!exact(bar,['closeTimeMs','open','high','low','close','volume'])
      || ![bar.open,bar.high,bar.low,bar.close].every(positive) || !nonnegative(bar.volume)
      || bar.low > Math.min(bar.open,bar.close) || bar.high < Math.max(bar.open,bar.close)
      || bar.low > bar.high) return invalid('H5 has malformed OHLCV');
  }
  if (!validClock(bars,FIVE_MINUTES,input.asOfMs)) return invalid('H5 requires aligned contiguous closed fresh 5m bars');
  let rangeSum = 0;
  for (let index=7;index<=20;index++) {
    const bar=bars[index],previousClose=bars[index-1].close;
    const range=Math.max(bar.high-bar.low,Math.abs(bar.high-previousClose),Math.abs(bar.low-previousClose));
    rangeSum += range;
  }
  const priorATR14 = rangeSum/14;
  const volumes = bars.slice(1,21).map(bar=>bar.volume).sort((a,b)=>a-b);
  const priorMedianVolume = volumes[9]+(volumes[10]-volumes[9])/2;
  if (![priorATR14,priorMedianVolume,3*priorATR14,3*priorMedianVolume].every(Number.isFinite)) return invalid('H5 baseline arithmetic overflow');
  if (priorATR14 <= 0 || priorMedianVolume <= 0) return none();
  const shock=bars[21],body=shock.close-shock.open;
  if (Math.abs(body) < 3*priorATR14 || shock.volume < 3*priorMedianVolume) return none();
  const direction=body < 0 ? 'LONG' : 'SHORT';
  const shockMidpoint=shock.open+body/2;
  let firstReclaim=-1;
  for (let index=22;index<bars.length;index++) {
    if (direction === 'LONG' ? bars[index].close >= shockMidpoint : bars[index].close <= shockMidpoint) {
      firstReclaim=index;break;
    }
  }
  if (firstReclaim !== bars.length-1) return none();
  const stopPrice=direction === 'LONG' ? shock.low-0.25*priorATR14 : shock.high+0.25*priorATR14;
  if (!positive(stopPrice) || !positive(shockMidpoint)) return invalid('H5 derived price is nonpositive or nonfinite');
  return {...base,valid:true,status:'DRAFT_SIGNAL',signal:{familyId:'H5',direction,
    observedAtMs:bars[bars.length-1].closeTimeMs,shockCloseTimeMs:shock.closeTimeMs,
    priorATR14,priorMedianVolume,shockMidpoint,stopPrice,structuralTargetPrice:shock.open}};
}

export function evaluateH7Selection(input) {
  const base={valid:false,errors:[],executionAuthorized:false,requiresTradePlan:true,status:'INVALID',selection:[],cashWeight:1};
  const invalid=error=>({...base,errors:[error]});
  if (!exact(input,['asOfMs','assets']) || !validAsOf(input.asOfMs)
    || !dense(input.assets,1,50)) return invalid('H7 requires asOfMs and 1..50 assets');
  const symbols=new Set(),eligible=[];
  let endpoint=null;
  for (const asset of input.assets) {
    if (!exact(asset,['symbol','bars']) || typeof asset.symbol !== 'string'
      || !/^[A-Z][A-Z0-9]{0,19}$/.test(asset.symbol) || symbols.has(asset.symbol)
      || !dense(asset.bars,201,201)) return invalid('H7 needs unique bounded uppercase symbols and 201 dense bars');
    symbols.add(asset.symbol);
    for (const bar of asset.bars) {
      if (!exact(bar,['closeTimeMs','close']) || !positive(bar.close)) return invalid('H7 has malformed daily price');
    }
    if (!validClock(asset.bars,DAY,input.asOfMs)) return invalid('H7 requires aligned contiguous closed fresh daily bars');
    const last=asset.bars[200];
    if (endpoint !== null && last.closeTimeMs !== endpoint) return invalid('H7 assets must share one daily endpoint');
    endpoint=last.closeTimeMs;
    // Online arithmetic mean keeps a flat series exactly flat and avoids
    // overflowing a raw sum of otherwise finite positive prices.
    let sma200=asset.bars[1].close;
    for (let index=2;index<=200;index++) sma200 += (asset.bars[index].close-sma200)/index;
    const returns=[];
    for (let index=171;index<=200;index++) returns.push(Math.log(asset.bars[index].close)-Math.log(asset.bars[index-1].close));
    const mean=returns.reduce((sum,value)=>sum+value,0)/30;
    const variance=returns.reduce((sum,value)=>sum+(value-mean)**2,0)/30;
    const realizedVolatility=Math.sqrt(variance);
    if (!positive(sma200) || !nonnegative(realizedVolatility)) return invalid('H7 indicator arithmetic overflow or underflow');
    if (last.close > sma200) eligible.push({symbol:asset.symbol,weight:0.25,realizedVolatility,sma200,lastClose:last.close});
  }
  eligible.sort((a,b)=>a.realizedVolatility-b.realizedVolatility || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const selection=eligible.slice(0,3);
  return {...base,valid:true,status:'DRAFT_SELECTION',selection,cashWeight:1-0.25*selection.length};
}
