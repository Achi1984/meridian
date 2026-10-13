import {transition} from './spot-lifecycle.mjs';
import {sizeSpotEntry} from './spot-risk-sizing.mjs';
import {applySpotFill} from './spot-ledger.mjs';

const flags = {executionAuthorized:false, researchOnly:true};
const INTEGER = /^(?:0|[1-9][0-9]{0,29})(?![\s\S])/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}(?![\s\S])/;
const ID = /^[A-Za-z0-9:_-]{1,64}(?![\s\S])/;
const LEDGER_ID = /^[\x00-\x7f]{1,64}(?![\s\S])/;
const keys = (o, names) => o !== null && typeof o === 'object' &&
  Object.getPrototypeOf(o) === Object.prototype && Object.keys(o).length === names.length &&
  names.every(k => Object.hasOwn(o,k));
const integer = v => typeof v === 'string' && INTEGER.test(v);
const price = v => Number.isSafeInteger(v) && v > 0;
const fail = s => {throw new Error(s);};

function validateAccount(book) {
  const a = book.account;
  if (!keys(a,['currency','cashMicros','positions','processedFillIds']) || a.currency !== 'EUR' ||
    !integer(a.cashMicros) || !Array.isArray(a.positions) || !Array.isArray(a.processedFillIds) ||
    a.processedFillIds.length > 10000) fail('INVALID_ACCOUNT');
  const seen = new Set();
  for (const id of a.processedFillIds) {
    if (typeof id !== 'string' || !LEDGER_ID.test(id) || seen.has(id)) fail('INVALID_FILL_HISTORY');
    seen.add(id);
  }
  const held = ['LONG','PENDING_EXIT'].includes(book.lifecycle?.phase);
  if (a.positions.length !== (held ? 1 : 0)) fail('POSITION_LIFECYCLE_MISMATCH');
  if (held) {
    const p = a.positions[0];
    if (!keys(p,['symbol','lots']) || p.symbol !== book.symbol ||
      !integer(p.lots) || p.lots === '0') fail('INVALID_DEDICATED_POSITION');
  }
}

function validatePrices(lifecycle, event) {
  const values = [];
  if (lifecycle?.position) values.push(lifecycle.position.initialStop,
    lifecycle.position.entryAsk, lifecycle.position.entryBid);
  if (lifecycle?.pending?.initialStop !== null && lifecycle?.pending)
    values.push(lifecycle.pending.initialStop);
  if (event?.type === 'ENTRY_SIGNAL') values.push(event.initialStop);
  if (event?.type === 'QUOTE') values.push(event.bid,event.ask);
  if (!values.every(price)) fail('PRICES_MUST_BE_SAFE_INTEGER_EUR_MICROS_PER_LOT');
}

/** Atomic return-value composition only; no persistence, locking or external effects. */
export function simulateSpotStep(book, envelope, policy) {
  const reject = error => ({valid:false, book, fill:null, sizing:null, errors:[error], ...flags});
  try {
    if (!keys(book,['symbol','lifecycle','account']) || typeof book.symbol !== 'string' ||
      !SYMBOL.test(book.symbol)) fail('INVALID_BOOK');
    if (!keys(envelope,['symbol','event']) || envelope.symbol !== book.symbol)
      fail('WRONG_INSTRUMENT_OR_ENVELOPE');
    const e = envelope.event;
    if (typeof e?.id !== 'string' || !ID.test(e.id)) fail('INVALID_BRIDGE_EVENT_ID');
    if (!keys(policy,['riskBudgetMicros','remainingExposureMicros',
      'stressedExitPriceMicrosPerLot','feeBps']) ||
      !['riskBudgetMicros','remainingExposureMicros','stressedExitPriceMicrosPerLot']
        .every(k => integer(policy[k])) ||
      !Number.isInteger(policy.feeBps) || policy.feeBps < 0 || policy.feeBps > 10000)
      fail('INVALID_POLICY');
    validateAccount(book);
    validatePrices(book.lifecycle,e);
    const next = transition(book.lifecycle,e);
    if (!next.valid) fail(`LIFECYCLE:${next.error}`);
    let account = structuredClone(book.account), fill = null, sizing = null;
    if (next.fill) {
      let lots, feeMicros;
      if (next.fill.side === 'BUY') {
        if (BigInt(policy.stressedExitPriceMicrosPerLot) > BigInt(next.state.position.initialStop))
          fail('STRESSED_EXIT_ABOVE_INITIAL_STOP');
        const sized = sizeSpotEntry({currency:'EUR',cashMicros:account.cashMicros,
          ...policy,entryPriceMicrosPerLot:String(next.fill.price)});
        if (!sized.valid) fail(`SIZING:${sized.errors.join(',')}`);
        if (!sized.candidate) fail('ZERO_FEASIBLE_LOTS');
        sizing = sized.sizing; lots = sizing.lots; feeMicros = sizing.entryFeeMicros;
      } else {
        lots = account.positions[0].lots;
        feeMicros = ((BigInt(lots) * BigInt(next.fill.price) * BigInt(policy.feeBps) + 9999n)
          / 10000n).toString();
      }
      fill = {id:e.id,symbol:book.symbol,side:next.fill.side,lots,
        priceMicrosPerLot:String(next.fill.price),feeMicros,
        signalAvailableAtMs:next.fill.signalAvailableAt,quoteAtMs:next.fill.quoteAt,
        quoteReceivedAtMs:next.fill.receivedAt,fillAtMs:next.fill.fillAt};
      const booked = applySpotFill({account,fill,maxQuoteAgeMs:1000});
      if (!booked.valid) fail(`LEDGER:${booked.errors.join(',')}`);
      account = booked.account;
    }
    const result = {symbol:book.symbol,lifecycle:next.state,account};
    validateAccount(result);
    return {valid:true,book:result,fill:fill ? {...fill,...flags} : null,
      sizing,errors:[],...flags};
  } catch (error) {return reject(error.message);}
}
