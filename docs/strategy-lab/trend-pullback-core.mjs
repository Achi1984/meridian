// Numerical P1 core. No publication/receipt admission is performed here.
// This result is not time-admitted and cannot authorize execution.
const DAY = 86400000;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const keys = (x, names) => record(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const time = x => Number.isSafeInteger(x) && x >= 0;
const reject = error => ({valid:false,error,action:'NONE',executionAuthorized:false,researchOnly:true,timeAdmissionPerformed:false});
export function evaluateTrendPullbackCore(input) {
  if (!keys(input,['bars','decisionAtMs','position'])) return reject('INPUT_SCHEMA');
  const {bars,decisionAtMs,position} = input;
  if (!time(decisionAtMs) || !Array.isArray(bars) || bars.length !== 201) return reject('WINDOW');
  if (position !== null && (!keys(position,['entryAtMs']) || !time(position.entryAtMs) || position.entryAtMs > decisionAtMs)) return reject('POSITION');
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (!keys(b,['openTimeMs','closeTimeMs','open','high','low','close','volume'])) return reject('BAR_SCHEMA');
    if (!time(b.openTimeMs) || !time(b.closeTimeMs) || b.openTimeMs % DAY !== 0 || b.closeTimeMs-b.openTimeMs !== DAY || b.closeTimeMs > decisionAtMs) return reject('BAR_TIME');
    if (i && (b.openTimeMs !== bars[i-1].closeTimeMs)) return reject('BAR_SEQUENCE');
    if (![b.open,b.high,b.low,b.close].every(x=>typeof x==='number' && Number.isFinite(x) && x>0) || typeof b.volume !== 'number' || !Number.isFinite(b.volume) || b.volume<0 || b.high<Math.max(b.open,b.low,b.close) || b.low>Math.min(b.open,b.high,b.close)) return reject('OHLCV');
  }
  const last=bars[200];
  if (decisionAtMs-last.closeTimeMs >= DAY) return reject('STALE_WINDOW');
  if (position && position.entryAtMs < bars[0].closeTimeMs) return reject('POSITION_OUTSIDE_WINDOW');
  let sma=bars[1].close;
  for (let i=2;i<=200;i++) sma += (bars[i].close-sma)/i;
  const percentR = end => {
    const w=bars.slice(end-9,end+1), high=Math.max(...w.map(b=>b.high)),low=Math.min(...w.map(b=>b.low));
    return high===low ? null : -100*((high-bars[end].close)/(high-low));
  };
  const previousR=percentR(199),currentR=percentR(200);
  const atr=bars.slice(187).reduce((s,b,j)=>s+Math.max(b.high-b.low,Math.abs(b.high-bars[186+j].close),Math.abs(b.low-bars[186+j].close))/14,0);
  if (![sma,atr].every(Number.isFinite) || [previousR,currentR].some(x=>x!==null && !Number.isFinite(x))) return reject('NUMERIC_RANGE');
  const heldBars=position ? bars.filter(b=>b.closeTimeMs>position.entryAtMs).length : 0;
  const reasons=[];
  if (last.close<sma) reasons.push('TREND_EXIT');
  if (currentR!==null && currentR>=-20) reasons.push('OSCILLATOR_EXIT');
  if (position && heldBars>=10) reasons.push('TIME_EXIT');
  let action='NONE',initialStop=null;
  if (position) action=reasons.length ? 'EXIT_LONG' : 'HOLD_LONG';
  else if (!reasons.length && last.close>sma && previousR!==null && currentR!==null && previousR<=-80 && currentR>-80 && currentR<-20) {
    initialStop=last.low-0.5*atr;
    if (!Number.isFinite(initialStop) || initialStop<=0 || initialStop>=last.close) return reject('INVALID_STOP');
    action='ENTER_LONG_CANDIDATE';
  }
  return {valid:true,action,reasons,sma200:sma,previousR,currentR,atr14:atr,heldBars,initialStop,
    timeAdmissionPerformed:false,
    executionAuthorized:false,researchOnly:true};
}
