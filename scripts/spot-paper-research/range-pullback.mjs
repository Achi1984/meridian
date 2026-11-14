export const SPOT_PAPER_RANGE_PULLBACK_ID = "BTC_EUR_RANGE_PULLBACK_ATR_RSI_V1";
export const RANGE_PULLBACK_COOLDOWN_MS = 600_000;

const MINUTE = 60_000;
const MAX_HISTORY = 160;
const integer = value => Number.isSafeInteger(value) ||
  (typeof value === "string" && /^-?\d+$/.test(value));
const validCandle = candle => candle && Number.isSafeInteger(candle.timestamp) &&
  candle.timestamp >= 0 && integer(candle.openNano) && integer(candle.highNano) &&
  integer(candle.lowNano) && integer(candle.closeNano) &&
  BigInt(candle.highNano) >= BigInt(candle.lowNano) &&
  BigInt(candle.highNano) >= BigInt(candle.openNano) &&
  BigInt(candle.highNano) >= BigInt(candle.closeNano) &&
  BigInt(candle.lowNano) <= BigInt(candle.openNano) &&
  BigInt(candle.lowNano) <= BigInt(candle.closeNano);

function mean(values) {
  return values.reduce((sum, value) => sum + BigInt(value), 0n) / BigInt(values.length);
}

function indicators(candles) {
  if (candles.length < 70) return null;
  const closes = candles.map(candle => BigInt(candle.closeNano));
  const last = closes.length - 1;
  const sma20 = mean(closes.slice(last - 19, last + 1));
  const sma60 = mean(closes.slice(last - 59, last + 1));
  const oldSma60 = mean(closes.slice(last - 69, last - 9));
  let trSum = 0n;
  let gain = 0n;
  let loss = 0n;
  for (let index = last - 13; index <= last; index++) {
    const candle = candles[index];
    const previous = BigInt(candles[index - 1].closeNano);
    const high = BigInt(candle.highNano);
    const low = BigInt(candle.lowNano);
    const tr = [high - low, high > previous ? high - previous : previous - high,
      low > previous ? low - previous : previous - low].reduce((a, b) => a > b ? a : b);
    trSum += tr;
    const delta = BigInt(candle.closeNano) - previous;
    if (delta > 0n) gain += delta;
    else loss -= delta;
  }
  const atr14 = trSum / 14n;
  const avgGain = gain / 14n;
  const avgLoss = loss / 14n;
  const rsiNumerator = avgLoss === 0n ? 100n : avgGain * 100n;
  const rsiDenominator = avgLoss === 0n ? 1n : avgGain + avgLoss;
  return { sma20, sma60, oldSma60, atr14, rsiNumerator, rsiDenominator };
}

export function createRangePullbackState() {
  return { candles: [], held: false, entryAt: null, entryPriceNano: null,
    entryAtrNano: null, cooldownUntil: 0, lastSignalAt: null };
}

export function advanceRangePullback(previous, incoming, { decisionAt, held = previous?.held } = {}) {
  if (!previous || !Array.isArray(previous.candles) || previous.candles.length > MAX_HISTORY ||
      !integer(decisionAt) || decisionAt < 0 || typeof held !== "boolean" ||
      !integer(previous.cooldownUntil) || previous.cooldownUntil < 0 ||
      !Array.isArray(incoming) || incoming.some(candle => !validCandle(candle))) {
    throw new Error("INVALID_RANGE_PULLBACK_STATE");
  }
  const state = structuredClone(previous);
  const signals = [];
  let missedDecisionWindow = false;
  for (const candle of incoming) {
    const last = state.candles.at(-1);
    if (last && candle.timestamp <= last.timestamp) continue;
    if (last && candle.timestamp !== last.timestamp + MINUTE) {
      state.candles = [];
      state.held = held;
      state.entryAt = null;
      state.entryPriceNano = null;
      state.entryAtrNano = null;
      missedDecisionWindow = true;
    }
    state.candles.push(candle);
    if (state.candles.length > MAX_HISTORY) state.candles.shift();
    const data = indicators(state.candles);
    if (!data) continue;
    const close = BigInt(candle.closeNano);
    const priorClose = BigInt(state.candles.at(-2).closeNano);
    if (state.held) {
      const target = close >= data.sma20;
      const stop = state.entryPriceNano !== null && state.entryAtrNano !== null &&
        close <= state.entryPriceNano - 2n * state.entryAtrNano;
      const timeStop = state.entryAt !== null && candle.timestamp - state.entryAt >= 120 * MINUTE;
      if (target || stop || timeStop) {
        const strategyReason = target ? "MEAN_REVERSION_TARGET" : stop ? "ATR_STOP" : "TIME_STOP";
        signals.push({ id: `${SPOT_PAPER_RANGE_PULLBACK_ID}:EXIT:${candle.timestamp}`,
          direction: "EXIT", candleAt: candle.timestamp, closeNano: candle.closeNano,
          decisionAt, strategyReason });
        state.held = false;
        state.entryAt = null;
        state.entryPriceNano = null;
        state.entryAtrNano = null;
        state.cooldownUntil = decisionAt + RANGE_PULLBACK_COOLDOWN_MS;
      }
      continue;
    }
    if (decisionAt < state.cooldownUntil) continue;
    const range = (data.sma20 > data.sma60 ? data.sma20 - data.sma60 : data.sma60 - data.sma20) * 2n <= data.atr14 * 3n;
    const slope = (data.sma60 > data.oldSma60 ? data.sma60 - data.oldSma60 : data.oldSma60 - data.sma60) * 2n <= data.atr14;
    const pullback = close * 100n <= data.sma20 * 100n - data.atr14 * 150n;
    const oversold = data.rsiNumerator <= 35n * data.rsiDenominator;
    if (range && slope && pullback && oversold && close > priorClose) {
      signals.push({ id: `${SPOT_PAPER_RANGE_PULLBACK_ID}:ENTRY:${candle.timestamp}`,
        direction: "ENTRY", candleAt: candle.timestamp, closeNano: candle.closeNano,
        decisionAt, strategyReason: "RANGE_PULLBACK_ATR_RSI" });
      state.held = true;
      state.entryAt = candle.timestamp;
      state.entryPriceNano = candle.closeNano;
      state.entryAtrNano = Number(data.atr14);
    }
  }
  state.lastSignalAt = signals.at(-1)?.candleAt ?? state.lastSignalAt;
  return { state, signals, newCandleCount: incoming.filter(c => state.candles.some(x => x.timestamp === c.timestamp)).length,
    missedDecisionWindow };
}
