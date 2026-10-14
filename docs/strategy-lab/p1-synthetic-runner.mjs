// Bounded offline synthetic fixture adapter. Never a historical or trading runner.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {evaluateTrendPullback} from './trend-pullback.mjs';
import {simulateSpotStep} from './spot-simulation-step.mjs';
import {createSpotJournal, readSpotJournal, commitSpotJournalStep} from './spot-journal.mjs';

const flags = {executionAuthorized:false,researchOnly:true};
const SCHEMA = 'MERIDIAN_P1_SYNTHETIC_STEP_V1';
const UNIT = 'EUR_MICROS_PER_SYNTHETIC_LOT';
const DAY = 86400000;
const keys = (o,n) => o !== null && typeof o === 'object' &&
  Object.getPrototypeOf(o) === Object.prototype && Object.keys(o).length === n.length &&
  n.every(k=>Object.hasOwn(o,k));
const time = x => Number.isSafeInteger(x) && x >= 0;
const price = x => Number.isSafeInteger(x) && x > 0;
const amount = x => typeof x === 'string' && /^(?:0|[1-9][0-9]{0,29})(?![\s\S])/.test(x);
const symbol = x => typeof x === 'string' && /^SYNTH_[A-Z0-9_]{1,14}(?![\s\S])/.test(x);
const reject = code => ({valid:false,code,fill:null,sizing:null,...flags});
const fail = code => {throw new Error(code);};
function header(x) {
  if(x.schemaVersion !== SCHEMA || x.synthetic !== true || x.priceUnit !== UNIT ||
    !symbol(x.symbol) || typeof x.directory !== 'string' || !x.directory.startsWith('/'))
    fail('SYNTHETIC_HEADER_REQUIRED');
}
function snapshot(input,names) {
  if(!keys(input,names)) fail('INPUT_SCHEMA');
  const x=structuredClone(input);
  if(!isDeepStrictEqual(x,JSON.parse(JSON.stringify(x)))) fail('NON_JSON_INPUT');
  header(x);return x;
}
function policy(x) {
  if(!keys(x,['riskBudgetMicros','remainingExposureMicros','stressedExitPriceMicrosPerLot','feeBps']) ||
    !['riskBudgetMicros','remainingExposureMicros','stressedExitPriceMicrosPerLot'].every(k=>amount(x[k])) ||
    !Number.isInteger(x.feeBps) || x.feeBps < 0 || x.feeBps > 10000) fail('INVALID_POLICY');
}

export async function createSyntheticP1Account(input) {
  try {
    const x=snapshot(input,['schemaVersion','synthetic','priceUnit','directory','symbol','cashMicros']);
    if(!amount(x.cashMicros)) fail('INVALID_CASH');
    return await createSpotJournal({directory:x.directory,symbol:x.symbol,cashMicros:x.cashMicros});
  } catch(error) {return reject(error.message);}
}

/** Exactly one signal evaluation or quote; no automatic retry, recovery or loop. */
export async function advanceSyntheticP1(input) {
  try {
    // All caller-owned inputs, including version, are captured before the first await.
    const x=snapshot(input,['schemaVersion','synthetic','priceUnit','directory','symbol','expectedVersion','policy','step']);
    if(!Number.isSafeInteger(x.expectedVersion) || x.expectedVersion < 0) fail('INVALID_VERSION');
    policy(x.policy);
    let e,signal=null;
    if(x.step?.kind === 'SIGNAL') {
      const s=x.step;
      if(!keys(s,['kind','bars','asOfMs','receivedAtMs','expiresAtMs']) ||
        !Array.isArray(s.bars) || s.bars.length !== 201 ||
        ![s.asOfMs,s.receivedAtMs,s.expiresAtMs].every(time) ||
        s.asOfMs > s.receivedAtMs || s.expiresAtMs <= s.receivedAtMs ||
        s.receivedAtMs - s.bars[200]?.closeTimeMs >= DAY ||
        !s.bars.every(b=>['open','high','low','close'].every(k=>price(b?.[k]))))
        fail('INVALID_SYNTHETIC_SIGNAL');
    } else if(x.step?.kind === 'QUOTE') {
      const s=x.step;
      if(!keys(s,['kind','quoteAtMs','receivedAtMs','bid','ask']) ||
        ![s.quoteAtMs,s.receivedAtMs].every(time) || ![s.bid,s.ask].every(price))
        fail('INVALID_SYNTHETIC_QUOTE');
      const hash=createHash('sha256').update(JSON.stringify([x.symbol,s.quoteAtMs,s.receivedAtMs,s.bid,s.ask])).digest('hex');
      e={type:'QUOTE',id:`p1q:${hash.slice(0,60)}`,at:s.receivedAtMs,quoteAt:s.quoteAtMs,bid:s.bid,ask:s.ask};
    } else fail('STEP_KIND');
    const saved=await readSpotJournal({directory:x.directory});
    if(!saved.valid) return reject(saved.code);
    if(saved.book.symbol !== x.symbol) fail('WRONG_INSTRUMENT');
    if(saved.version !== x.expectedVersion) fail('VERSION_CONFLICT');
    if(x.step.kind === 'SIGNAL') {
      const s=x.step,lc=saved.book.lifecycle;
      signal=evaluateTrendPullback({bars:s.bars,asOfMs:s.asOfMs,
        position:lc.position ? {entryAtMs:lc.position.entryAt} : null});
      if(!signal.valid) fail(`P1:${signal.error}`);
      if(s.receivedAtMs <= lc.lastAt) fail('SIGNAL_RECEIPT_NOT_MONOTONIC');
      if(!['ENTER_LONG_CANDIDATE','EXIT_LONG'].includes(signal.action))
        return {valid:true,changed:false,version:saved.version,book:saved.book,signal,fill:null,sizing:null,...flags};
      // One P1 signal identity per instrument/daily close, independent of asOf,
      // receipt and revised fixture prices: resubmission cannot reopen old signals.
      const identity=`${x.symbol}:${s.bars[200].closeTimeMs}`;
      e={type:signal.action === 'EXIT_LONG' ? 'EXIT_SIGNAL' : 'ENTRY_SIGNAL',
        id:`p1e:${identity}`,signalId:`p1s:${identity}`,at:s.receivedAtMs,
        // Admission cannot use a quote that predates receipt of this signal.
        availableAt:Math.max(signal.signalAvailableAtMs,s.receivedAtMs),expiresAt:s.expiresAtMs};
      if(e.type === 'ENTRY_SIGNAL') {
        // Round down toward lower stop: never tighten the P1 stop via rounding.
        e.initialStop=Math.floor(signal.initialStop);
        if(!price(e.initialStop)) fail('ROUNDED_STOP_INVALID');
        if(BigInt(x.policy.stressedExitPriceMicrosPerLot) > BigInt(e.initialStop))
          fail('STRESSED_EXIT_ABOVE_ROUNDED_STOP');
      }
    }
    const envelope={symbol:x.symbol,event:e};
    const preview=simulateSpotStep(saved.book,envelope,x.policy);
    if(!preview.valid) fail(`STEP_REJECTED:${preview.errors.join(',')}`);
    // Authoritative CAS happens again under the journal lock. No preview is a fill.
    const committed=await commitSpotJournalStep({directory:x.directory,
      expectedVersion:x.expectedVersion,envelope,policy:x.policy});
    if(!committed.valid) return reject(committed.code);
    return {...committed,changed:true,signal,fill:preview.fill,sizing:preview.sizing};
  } catch(error) {return reject(error.message);}
}
