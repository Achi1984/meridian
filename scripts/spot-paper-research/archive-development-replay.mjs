// Offline development diagnostic. Run on the local archive adapter's JSON output.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceStrategy, createStrategyState, createLedger, applyPaperObservation,
  SPOT_PAPER_PILOT_LIMITS as limits } from '../spot-paper-pilot/core.mjs';
import { advanceRangePullback, createRangePullbackState, RANGE_PULLBACK_COOLDOWN_MS } from './range-pullback.mjs';
import { advanceEntryConfirmation, createEntryConfirmationState, recordEntryConfirmationSell } from './entry-confirmation.mjs';

function units(price) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(price);
  assert.ok(match, 'invalid archive decimal');
  const [, whole, fraction = '', exponent = '0'] = match;
  const shift = 8 + Number(exponent) - fraction.length;
  assert.ok(Math.abs(shift) <= 24);
  const digits = BigInt(whole + fraction);
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  assert.equal(digits % divisor, 0n);
  return digits / divisor;
}

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(data.schema, 'tardis-kraken-btc-eur-development-v1');
assert.ok(['2026-08-01','2026-09-01','2026-10-01'].includes(data.day));
const first = Date.parse(data.day + 'T06:30:00Z') * 1000;
assert.equal(data.bars.length, 570);
assert.equal(data.decisions.length, 480);
const candles = data.bars.map((b, i) => {
  assert.ok(b, "Missing closed minute bar at " + new Date(first / 1000 + i * 60000).toISOString());
  assert.equal(b.start_us, first + i * 60e6);
  assert.ok(b.last_receive_us < b.start_us + 60e6 && b.last_exchange_us <= b.last_receive_us);
  return { timestamp: b.start_us / 1000, openNano: String(units(b.open)), closeNano: String(units(b.close)),
    lowNano: String(units(b.low)), highNano: String(units(b.high)) };
});

function replay(name, advance, initial) {
  let state = initial(), ledger = createLedger(), stopped = false;
  let missedSignals = 0, trips = 0, peak = ledger.cashCents, drawdown = 0, equity = peak;
  const gaps = [], fills = [], sizeRejections = [];
  let pendingStop = false;
  // Seed through 07:58; the 07:59 bar first becomes available at 08:00.
  state = advance(state, candles.slice(0, 89), { decisionAt: first / 1000 + 89 * 60000, held: false }).state;
  for (const [i, slot] of data.decisions.entries()) {
    const end = i + 89;
    assert.equal(slot.last_closed_bar, end);
    assert.equal(slot.decision_us, first + (end + 1) * 60e6);
    const decisionAt = slot.decision_us / 1000;
    const advanced = stopped ? {state, signals: []} : advance(state, [candles[end]], {decisionAt, held: !!ledger.position});
    state = advanced.state;
    const signal = advanced.signals.at(-1);
    const q = slot.quote;
    if (!q) {
      assert.equal(slot.quote_status, 'no_eligible_update');
      gaps.push(decisionAt);
      if (signal) missedSignals++;
      equity = ledger.position ? null : ledger.cashCents;
      continue;
    }
    assert.equal(slot.quote_status, 'eligible');
    assert.ok(q.receive_us >= slot.decision_us && q.receive_us <= slot.decision_us + 5e6);
    assert.ok(q.exchange_us <= q.receive_us && q.receive_us - q.exchange_us <= 5e6);
    const bid = units(q.bid_price), ask = units(q.ask_price);
    assert.ok(ask >= bid && bid > 0n);
    const at = Math.ceil(q.receive_us / 1000);
    const quote = {bidNano: String(bid), askNano: String(ask), receivedAt: at,
      spreadBps: Number(((ask-bid)*20000n + ask+bid-1n)/(ask+bid))};
    // A previously stopped arm is valuation-only, including when inventory remains.
    const before = stopped ? structuredClone(ledger) : ledger;
    if (stopped && before.position) before.position.stopPriceNano = '0';
    const attempted = pendingStop ? {direction:'EXIT', id:'pending-stop', candleAt:decisionAt} : signal;
    let result = applyPaperObservation(before, {signal:attempted, quote, nowMs:at, stopped});
    const proposed = result.fills[0];
    if (proposed && BigInt(proposed.quantitySat) > units(proposed.side === 'BUY' ? q.ask_amount : q.bid_amount)) {
      sizeRejections.push({at, side:proposed.side, reason:proposed.reason});
      pendingStop ||= proposed.reason === 'SAMPLED_2PCT_BID_STOP';
      // Revalue the unchanged inventory; no order, fee, or fill-dependent state transition.
      const valuation = structuredClone(before);
      if (valuation.position) valuation.position.stopPriceNano = '0';
      result = applyPaperObservation(valuation, {quote, nowMs:at, stopped:true});
      if (valuation.position) result.ledger.position.stopPriceNano = before.position.stopPriceNano;
      if (pendingStop) result.stopReason = null;
    }
    if (stopped) ledger.lastMark = result.ledger.lastMark;
    else ledger = result.ledger;
    for (const fill of result.fills) {
      assert.ok(!stopped);
      const buying = fill.side === 'BUY';
      assert.ok(BigInt(fill.quantitySat) <= units(buying ? q.ask_amount : q.bid_amount));
      fills.push({at, side:fill.side, feeCents:fill.feeCents});
      if (pendingStop && !buying) {
        pendingStop = false;
        result.stopReason = 'SAMPLED_2PCT_BID_STOP';
      }
      if (!buying) trips++;
      if (name === 'CONFIRM2' && !buying) state = recordEntryConfirmationSell(state, at);
      if (name === 'Range Pullback') Object.assign(state, buying ?
        {held:true, entryAt:at, entryPriceNano:fill.priceNano, entryAtrNano:signal.entryAtrNano} :
        {held:false, entryAt:null, entryPriceNano:null, entryAtrNano:null, cooldownUntil:at+RANGE_PULLBACK_COOLDOWN_MS});
    }
    stopped ||= !!result.stopReason;
    equity = ledger.cashCents + (ledger.position ? ledger.lastMark.netExitCents : 0);
    if (ledger.position && BigInt(ledger.position.quantitySat) > units(q.bid_amount)) {
      equity = null;
      continue;
    }
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak-equity);
  }
  const pnl = equity === null ? null : equity-ledger.initialCashCents;
  if (pnl !== null) assert.equal(pnl, ledger.realizedPnlCents + (ledger.position ? ledger.lastMark.unrealizedPnlCents : 0));
  return {name, pnlCents:pnl, trips, open:!!ledger.position, sampledDrawdownCents:drawdown, missedSignals,
    gaps:gaps.length, sizeRejections, feesCents:ledger.feesCents, fills};
}
console.log(JSON.stringify({day:data.day, continuity:data.continuity, executionModel:"FULL_SIZE_OR_SKIP", feeBps:limits.feeBpsPerSide,
  slippageBps:limits.slippageBpsPerSide, cashPnlCents:0, arms:[
    replay('Range Pullback', advanceRangePullback, createRangePullbackState),
    replay('CONFIRM2', advanceEntryConfirmation, createEntryConfirmationState),
    replay('SMA5/20', advanceStrategy, createStrategyState)]}));
