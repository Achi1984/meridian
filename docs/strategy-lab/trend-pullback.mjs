import {evaluateTrendPullbackCore} from './trend-pullback-core.mjs';
// P1: pure, offline daily signal. Never an order, fill or performance evaluator.
const DAY = 86400000;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const keys = (x, names) => record(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const time = x => Number.isSafeInteger(x) && x >= 0;
const reject = error => ({valid:false,error,action:'NONE',executionAuthorized:false,researchOnly:true});
export function evaluateTrendPullback(input) {
  if (!keys(input,['bars','asOfMs','position'])) return reject('INPUT_SCHEMA');
  const {bars,asOfMs,position} = input;
  if (!time(asOfMs) || !Array.isArray(bars) || bars.length !== 201) return reject('WINDOW');
  if (position !== null && (!keys(position,['entryAtMs']) || !time(position.entryAtMs) || position.entryAtMs > asOfMs)) return reject('POSITION');
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (!keys(b,['openTimeMs','closeTimeMs','open','high','low','close','volume','availableAtMs'])) return reject('BAR_SCHEMA');
    if (!time(b.openTimeMs) || !time(b.closeTimeMs) || !time(b.availableAtMs) || b.openTimeMs % DAY !== 0 || b.closeTimeMs-b.openTimeMs !== DAY || b.availableAtMs < b.closeTimeMs || b.availableAtMs > asOfMs) return reject('BAR_TIME');
    if (i && (b.openTimeMs !== bars[i-1].closeTimeMs || b.availableAtMs < bars[i-1].availableAtMs)) return reject('BAR_SEQUENCE');
    if (![b.open,b.high,b.low,b.close].every(x=>typeof x==='number' && Number.isFinite(x) && x>0) || typeof b.volume !== 'number' || !Number.isFinite(b.volume) || b.volume<0 || b.high<Math.max(b.open,b.low,b.close) || b.low>Math.min(b.open,b.high,b.close)) return reject('OHLCV');
  }
  const last=bars[200];
  if (asOfMs-last.closeTimeMs >= DAY) return reject('STALE_WINDOW');
  if (position && position.entryAtMs < bars[0].closeTimeMs) return reject('POSITION_OUTSIDE_WINDOW');
  const rawBars=bars.map(({availableAtMs,...raw})=>raw);
  const {timeAdmissionPerformed,...signal}=evaluateTrendPullbackCore({bars:rawBars,decisionAtMs:asOfMs,position});
  if (!signal.valid) return signal;
  return {...signal,signalAvailableAtMs:Math.max(asOfMs,...bars.map(b=>b.availableAtMs))};
}
