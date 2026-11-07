import { createHash } from "node:crypto";

export const SPOT_PAPER_PILOT_VERSION = "BTC_EUR_SMA5_SMA20_V1";
export const SPOT_PAPER_PILOT_LIMITS = Object.freeze({
  pair: "BTC/EUR",
  krakenPair: "XBTEUR",
  intervalMinutes: 1,
  initialCashCents: 100_000,
  maxExposureCents: 10_000,
  maxSessionLossCents: 2_000,
  stopLossBps: 200,
  maxEntrySpreadBps: 50,
  feeBpsPerSide: 50,
  slippageBpsPerSide: 10,
  maxCycles: 480,
  maxRequests: 960,
  maxBytes: 64 * 1024 * 1024,
  maxResponseBytes: 256 * 1024,
  requestTimeoutMs: 5_000,
  maxQuoteAgeMs: 10_000,
  maxCandleAgeMs: 120_000,
  minPollIntervalMs: 60_000,
  maxDurationMs: 8 * 60 * 60 * 1000,
  warmupCandles: 21,
});

const PRICE_SCALE = 100_000_000n;
const NOTIONAL_DIVISOR = 100_000_000_000_000n;
const PAIR_KEYS = new Set(["XXBTZEUR", "XBTEUR"]);
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decimalNano(value, name) {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * PRICE_SCALE + BigInt(fraction.padEnd(8, "0"));
}

function time(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name}`);
  return value;
}

function pairPayload(result, allowedKeys, name, allowLast = false) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(`INVALID_${name}_RESULT`);
  }
  const keys = Object.keys(result);
  const pairKeys = keys.filter(key => key !== "last");
  if ((!allowLast && keys.length !== 1) ||
      (allowLast && keys.some(key => key !== "last" && !allowedKeys.has(key))) ||
      pairKeys.length !== 1 || !allowedKeys.has(pairKeys[0])) {
    throw new Error(`UNEXPECTED_${name}_PAIR`);
  }
  return result[pairKeys[0]];
}

function responseResult(response, name) {
  if (!response || !Array.isArray(response.error) ||
      response.error.some(item => typeof item !== "string")) {
    throw new Error(`INVALID_${name}_SCHEMA`);
  }
  if (response.error.length) throw new Error(`${name}_API_ERROR:${response.error.join(",")}`);
  if (!response.result || typeof response.result !== "object") {
    throw new Error(`INVALID_${name}_SCHEMA`);
  }
  return response.result;
}

function parseCandle(row, receivedAt) {
  if (!Array.isArray(row) || row.length !== 8) throw new Error("INVALID_OHLC_ROW");
  const timestamp = time(row[0], "OHLC_TIMESTAMP") * 1000;
  if (!Number.isSafeInteger(timestamp) || timestamp > receivedAt || timestamp % 60_000 !== 0) {
    throw new Error("INVALID_OHLC_TIMESTAMP");
  }
  const openNano = decimalNano(row[1], "OHLC_OPEN");
  const highNano = decimalNano(row[2], "OHLC_HIGH");
  const lowNano = decimalNano(row[3], "OHLC_LOW");
  const closeNano = decimalNano(row[4], "OHLC_CLOSE");
  const vwapNano = decimalNano(row[5], "OHLC_VWAP");
  const volumeNano = decimalNano(row[6], "OHLC_VOLUME");
  if (openNano <= 0n || highNano <= 0n || lowNano <= 0n || closeNano <= 0n ||
      (volumeNano > 0n && (vwapNano <= 0n || vwapNano < lowNano || vwapNano > highNano)) ||
      (volumeNano === 0n && vwapNano !== 0n && (vwapNano < lowNano || vwapNano > highNano)) ||
      highNano < openNano || highNano < closeNano || highNano < lowNano ||
      lowNano > openNano || lowNano > closeNano || volumeNano < 0n ||
      !Number.isSafeInteger(row[7]) || row[7] < 0) {
    throw new Error("INVALID_OHLC_VALUES");
  }
  return { timestamp, openNano: String(openNano), highNano: String(highNano),
    lowNano: String(lowNano), closeNano: String(closeNano) };
}

export function parseKrakenOhlc(acquired, nowMs) {
  const receivedAt = time(acquired?.receivedAt, "OHLC_RECEIVED_AT");
  const now = time(nowMs, "CLOCK");
  if (now < receivedAt) throw new Error("CLOCK_MOVED_BACKWARDS");
  const result = responseResult(acquired.data, "OHLC");
  time(result.last, "OHLC_LAST");
  const rows = pairPayload(result, PAIR_KEYS, "OHLC", true);
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("INSUFFICIENT_OHLC_ROWS");
  const candles = rows.map(row => parseCandle(row, receivedAt));
  if (result.last !== candles.at(-1).timestamp / 1000) throw new Error("INVALID_OHLC_LAST");
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].timestamp <= candles[i - 1].timestamp) throw new Error("OHLC_OUT_OF_ORDER");
    if (candles[i].timestamp - candles[i - 1].timestamp !== 60_000) {
      throw new Error("OHLC_GAP");
    }
  }
  const closed = candles.slice(0, -1);
  if (closed.some(candle => candle.timestamp + 60_000 > receivedAt)) {
    throw new Error("OHLC_CANDLE_NOT_CLOSED");
  }
  const latest = closed.at(-1);
  const ageMs = now - (latest.timestamp + 60_000);
  if (ageMs < 0 || ageMs > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
    throw new Error("STALE_OHLC");
  }
  return { candles: closed, latestClosedAt: latest.timestamp, ageMs,
    raw: acquired.raw, sha256: acquired.sha256, requestStartedAt: acquired.requestStartedAt,
    receivedAt };
}

export function parseKrakenTicker(acquired, nowMs) {
  const receivedAt = time(acquired?.receivedAt, "TICKER_RECEIVED_AT");
  const startedAt = time(acquired?.requestStartedAt, "TICKER_REQUEST_STARTED_AT");
  const now = time(nowMs, "CLOCK");
  if (receivedAt < startedAt || now < receivedAt) throw new Error("CLOCK_MOVED_BACKWARDS");
  const ageMs = now - receivedAt;
  if (ageMs > SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs) throw new Error("STALE_TICKER");
  const result = responseResult(acquired.data, "TICKER");
  const ticker = pairPayload(result, PAIR_KEYS, "TICKER");
  if (!ticker || typeof ticker !== "object" || !Array.isArray(ticker.a) ||
      !Array.isArray(ticker.b) || ticker.a.length !== 3 || ticker.b.length !== 3 ||
      typeof ticker.a[1] !== "string" || !/^\d+$/.test(ticker.a[1]) ||
      typeof ticker.b[1] !== "string" || !/^\d+$/.test(ticker.b[1])) {
    throw new Error("INVALID_TICKER_SCHEMA");
  }
  if (decimalNano(ticker.a[2], "TICKER_ASK_VOLUME") < 0n ||
      decimalNano(ticker.b[2], "TICKER_BID_VOLUME") < 0n) {
    throw new Error("INVALID_TICKER_SCHEMA");
  }
  const askNano = decimalNano(ticker.a[0], "TICKER_ASK");
  const bidNano = decimalNano(ticker.b[0], "TICKER_BID");
  if (bidNano <= 0n || askNano <= 0n || askNano < bidNano) {
    throw new Error("INVALID_TICKER_BOOK");
  }
  const spreadNumerator = (askNano - bidNano) * 20_000n;
  const spreadDenominator = askNano + bidNano;
  const spreadBps = Number((spreadNumerator + spreadDenominator - 1n) / spreadDenominator);
  return { bidNano: String(bidNano), askNano: String(askNano), spreadBps,
    requestStartedAt: startedAt, receivedAt, ageMs, raw: acquired.raw, sha256: acquired.sha256 };
}

export function createStrategyState() {
  return { cutoffAt: null, lastSeenAt: null, warmupComplete: false, closes: [] };
}

function averagesCrossed(closes) {
  if (closes.length < 21) return null;
  const nanos = closes.map(candle => BigInt(candle.closeNano));
  const end = nanos.length - 1;
  const sum = (start, length) =>
    nanos.slice(start, start + length).reduce((total, value) => total + value, 0n);
  const previousFast = sum(end - 5, 5) * 4n;
  const currentFast = sum(end - 4, 5) * 4n;
  const previousSlow = sum(end - 20, 20);
  const currentSlow = sum(end - 19, 20);
  if (previousFast <= previousSlow && currentFast > currentSlow) return "ENTRY";
  if (previousFast >= previousSlow && currentFast < currentSlow) return "EXIT";
  return null;
}

export function advanceStrategy(previous, candles) {
  const state = { ...previous, closes: [...previous.closes] };
  if (!candles.length) throw new Error("NO_CLOSED_CANDLES");
  if (state.lastSeenAt === null) {
    state.cutoffAt = candles.at(-1).timestamp;
    state.lastSeenAt = state.cutoffAt;
    state.closes = candles.slice(-SPOT_PAPER_PILOT_LIMITS.warmupCandles);
    state.warmupComplete = state.closes.length >= SPOT_PAPER_PILOT_LIMITS.warmupCandles;
    return { state, signals: [], newCandleCount: 0 };
  }
  const byTime = new Map(candles.map(candle => [candle.timestamp, candle]));
  const prior = byTime.get(state.lastSeenAt);
  if (prior && prior.closeNano !== state.closes.at(-1)?.closeNano) {
    throw new Error("CONFLICTING_CLOSED_CANDLE");
  }
  const next = candles.filter(candle => candle.timestamp > state.lastSeenAt);
  if (!next.length) return { state, signals: [], newCandleCount: 0 };
  if (next[0].timestamp !== state.lastSeenAt + 60_000 ||
      next.some((candle, index) => index > 0 && candle.timestamp !== next[index - 1].timestamp + 60_000)) {
    throw new Error("CLOSED_CANDLE_GAP");
  }
  if (next.length > 1) {
    state.lastSeenAt = next.at(-1).timestamp;
    state.closes = [...state.closes, ...next].slice(-SPOT_PAPER_PILOT_LIMITS.warmupCandles);
    state.warmupComplete = state.closes.length >= SPOT_PAPER_PILOT_LIMITS.warmupCandles;
    return { state, signals: [], newCandleCount: next.length, missedDecisionWindow: true };
  }
  const wasWarm = state.warmupComplete;
  state.closes = [...state.closes, next[0]].slice(-SPOT_PAPER_PILOT_LIMITS.warmupCandles);
  state.lastSeenAt = next[0].timestamp;
  state.warmupComplete = state.closes.length >= SPOT_PAPER_PILOT_LIMITS.warmupCandles;
  const direction = wasWarm ? averagesCrossed(state.closes) : null;
  const signals = direction ? [{ id: `${direction}:${next[0].timestamp}`,
    direction, candleAt: next[0].timestamp, closeNano: next[0].closeNano }] : [];
  return { state, signals, newCandleCount: 1 };
}

function roundHalfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (2n * denominator);
}

function notionalCents(quantitySat, priceNano) {
  return Number(roundHalfUp(BigInt(quantitySat) * BigInt(priceNano), NOTIONAL_DIVISOR));
}

function feeCents(notional) {
  return Number(roundHalfUp(BigInt(notional) * BigInt(SPOT_PAPER_PILOT_LIMITS.feeBpsPerSide), 10_000n));
}

function adjustedPrice(priceNano, bps) {
  return String(roundHalfUp(BigInt(priceNano) * BigInt(10_000 + bps), 10_000n));
}

function quantityForBudget(maxSpendCents, priceNano) {
  let low = 0;
  const maximum = BigInt(maxSpendCents) * NOTIONAL_DIVISOR / BigInt(priceNano);
  let high = Number(maximum > BigInt(Number.MAX_SAFE_INTEGER) ?
    BigInt(Number.MAX_SAFE_INTEGER) : maximum);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const gross = notionalCents(middle, priceNano);
    if (gross + feeCents(gross) <= maxSpendCents) low = middle;
    else high = middle - 1;
  }
  return low;
}

function markPosition(position, quote) {
  const exitPriceNano = adjustedPrice(quote.bidNano, -SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide);
  const grossCents = notionalCents(position.quantitySat, exitPriceNano);
  const exitFeeCents = feeCents(grossCents);
  return { exitPriceNano, grossCents, exitFeeCents,
    unrealizedPnlCents: grossCents - exitFeeCents - position.entryCostCents };
}

export function createLedger() {
  return { initialCashCents: SPOT_PAPER_PILOT_LIMITS.initialCashCents,
    cashCents: SPOT_PAPER_PILOT_LIMITS.initialCashCents,
    realizedPnlCents: 0, feesCents: 0, position: null, lastMark: null, fills: [] };
}

export function applyPaperObservation(previous, { signal = null, quote, nowMs, stopped = false } = {}) {
  const ledger = structuredClone(previous);
  const fills = [];
  let stopReason = null;
  const mark = ledger.position ? markPosition(ledger.position, quote) : null;
  if (mark) {
    ledger.lastMark = { bidNano: quote.bidNano, exitPriceNano: mark.exitPriceNano,
      receivedAt: quote.receivedAt, ageMs: nowMs - quote.receivedAt,
        unrealizedPnlCents: mark.unrealizedPnlCents,
        netExitCents: mark.grossCents - mark.exitFeeCents };
  }
  const sessionPnl = ledger.realizedPnlCents + (mark?.unrealizedPnlCents ?? 0);
  const lossLimitReached = sessionPnl <= -SPOT_PAPER_PILOT_LIMITS.maxSessionLossCents;
  if (ledger.position && mark &&
      BigInt(quote.bidNano) <= BigInt(ledger.position.stopPriceNano)) {
    stopReason = "SAMPLED_2PCT_BID_STOP";
    const fill = { id: `exit:${ledger.position.entrySignalId}:stop`, side: "SELL",
      quantitySat: ledger.position.quantitySat, priceNano: mark.exitPriceNano,
      grossCents: mark.grossCents, feeCents: mark.exitFeeCents, reason: stopReason,
      signalAt: nowMs, quoteReceivedAt: quote.receivedAt };
    ledger.cashCents += mark.grossCents - mark.exitFeeCents;
    ledger.realizedPnlCents += mark.unrealizedPnlCents;
    ledger.feesCents += mark.exitFeeCents;
    ledger.position = null;
    ledger.lastMark = null;
    ledger.fills.push(fill);
    fills.push(fill);
  } else if (ledger.position && signal?.direction === "EXIT") {
    const fill = { id: `exit:${signal.id}`, side: "SELL",
      quantitySat: ledger.position.quantitySat, priceNano: mark.exitPriceNano,
      grossCents: mark.grossCents, feeCents: mark.exitFeeCents, reason: "SMA20_DOWN_CROSS",
      signalAt: signal.candleAt, quoteReceivedAt: quote.receivedAt };
    ledger.cashCents += mark.grossCents - mark.exitFeeCents;
    ledger.realizedPnlCents += mark.unrealizedPnlCents;
    ledger.feesCents += mark.exitFeeCents;
    ledger.position = null;
    ledger.lastMark = null;
    ledger.fills.push(fill);
    fills.push(fill);
  } else if (!ledger.position && !stopped && !lossLimitReached &&
      signal?.direction === "ENTRY" && quote.spreadBps <= SPOT_PAPER_PILOT_LIMITS.maxEntrySpreadBps) {
    const entryPriceNano = adjustedPrice(quote.askNano, SPOT_PAPER_PILOT_LIMITS.slippageBpsPerSide);
    const quantitySat = quantityForBudget(
      Math.min(ledger.cashCents, SPOT_PAPER_PILOT_LIMITS.maxExposureCents), entryPriceNano);
    const grossCents = notionalCents(quantitySat, entryPriceNano);
    const entryFeeCents = feeCents(grossCents);
    if (quantitySat > 0 && grossCents + entryFeeCents <= ledger.cashCents &&
        grossCents + entryFeeCents <= SPOT_PAPER_PILOT_LIMITS.maxExposureCents) {
      const fill = { id: `entry:${signal.id}`, side: "BUY", quantitySat,
        priceNano: entryPriceNano, grossCents, feeCents: entryFeeCents,
        reason: "SMA5_UP_CROSS", signalAt: signal.candleAt, quoteReceivedAt: quote.receivedAt };
      ledger.cashCents -= grossCents + entryFeeCents;
      ledger.feesCents += entryFeeCents;
      ledger.position = { quantitySat, entryPriceNano, entryGrossCents: grossCents,
        entryFeeCents, entryCostCents: grossCents + entryFeeCents,
        entrySignalId: signal.id,
        stopPriceNano: String(roundHalfUp(BigInt(entryPriceNano) *
          BigInt(10_000 - SPOT_PAPER_PILOT_LIMITS.stopLossBps), 10_000n)) };
      const entryMark = markPosition(ledger.position, quote);
      ledger.lastMark = { bidNano: quote.bidNano, exitPriceNano: entryMark.exitPriceNano,
        receivedAt: quote.receivedAt, ageMs: nowMs - quote.receivedAt,
        unrealizedPnlCents: entryMark.unrealizedPnlCents,
        netExitCents: entryMark.grossCents - entryMark.exitFeeCents };
      ledger.fills.push(fill);
      fills.push(fill);
    }
  }
  if (lossLimitReached && !stopReason) stopReason = "SESSION_LOSS_LIMIT";
  return { ledger, fills, stopReason, lossLimitReached };
}

export function buildReport({ runId, mode, state, ledger, events, stopReason, startedAt, endedAt }) {
  const observations = events.filter(event => event.type === "observation").length;
  const dataGaps = events.filter(event => event.type === "data_gap").length;
  const signals = events.flatMap(event => event.signals ?? []);
  const unrealized = ledger.lastMark?.unrealizedPnlCents ?? 0;
  const lastMark = ledger.lastMark ? { ...ledger.lastMark,
    ageMs: endedAt === null ? null : endedAt - ledger.lastMark.receivedAt } : null;
  return {
    schemaVersion: "SPOT_PAPER_PILOT_REPORT_V1",
    model: SPOT_PAPER_PILOT_VERSION,
    runId, mode, pair: SPOT_PAPER_PILOT_LIMITS.pair,
    operationalStatus: stopReason === "CYCLE_LIMIT" || stopReason === "DURATION_LIMIT" ?
      "COMPLETED_BOUNDED" : stopReason === "SIGNAL" ? "STOPPED" : "STOPPED_WITH_LIMITATION",
    profitability: "NOT_ASSESSED",
    executionImpact: false, liveTrading: false, autoPromotion: false,
    startedAt, endedAt, stopReason, observations, dataGaps,
    signals, fills: ledger.fills, feesCents: ledger.feesCents,
    cashCents: ledger.cashCents, position: ledger.position,
    positionStatus: ledger.position ? "OPEN_UNRESOLVED_AT_TERMINAL" : "FLAT",
    realizedPnlCents: ledger.realizedPnlCents, unrealizedPnlCents: unrealized,
    equityCents: ledger.cashCents + (lastMark?.netExitCents ?? 0),
    lastMark,
    limitations: [
      "Experimental operations baseline only; no alpha or profitability claim.",
      "Modeled 50 bps fee and 10 bps adverse slippage per side are assumptions, not Kraken fee evidence.",
      "The sampled 2% stop is not a guaranteed loss bound; unresolved positions remain open at terminal.",
      "Ticker acquisition age is measured from request/receipt; Kraken ticker has no exchange event timestamp.",
      "No authenticated endpoints, credentials, orders, wallets, or live execution are used."
    ],
    warmupComplete: state.warmupComplete, decisionCutoffAt: state.cutoffAt
  };
}
