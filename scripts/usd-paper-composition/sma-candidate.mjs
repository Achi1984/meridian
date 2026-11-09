import {createHash} from "node:crypto";
import {
  advanceStrategy, createStrategyState
} from "../spot-paper-pilot/core.mjs";

export const USD_SMA_CANDIDATE = Object.freeze({
  schemaVersion: "USD_BTC_SMA_CANDIDATE_V1",
  status: "PROPOSED_UNAPPROVED",
  strategyVersion: "BTC_USD_SMA5_SMA20_CANDIDATE_V1",
  sourceVersion: "KRAKEN_NATIVE_BTC_USD_CLOSED_1M_V1",
  warmupClosedCandles: 21
});

const DIGEST = /^[a-f0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function safeTime(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${name}`);
  return value;
}

function validateCandleEvidence(evidence) {
  if (!evidence || evidence.schemaVersion !== "NATIVE_BTC_USD_CLOSED_CANDLES_V1" ||
      evidence.nativeInstrument !== "BTC/USD" || evidence.intervalMinutes !== 1 ||
      !DIGEST.test(evidence.responseDigest ?? "") || !Array.isArray(evidence.candles) ||
      evidence.candles.length < 1) {
    throw new Error("INVALID_USD_CANDLE_EVIDENCE");
  }
  const receivedAtMs = safeTime(evidence.receivedAtMs, "CANDLE_RECEIVED_AT");
  let previousAtMs = null;
  for (const candle of evidence.candles) {
    if (!candle || !Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0 ||
        candle.timestamp % 60_000 !== 0 ||
        candle.timestamp + 60_000 > receivedAtMs ||
        (previousAtMs !== null && candle.timestamp <= previousAtMs) ||
        typeof candle.close !== "string" || candle.close.length > 17 ||
        !DECIMAL.test(candle.close) ||
        typeof candle.closeNano !== "string" || !/^\d+$/.test(candle.closeNano) ||
        BigInt(candle.closeNano) !== closeAtoms(candle.close) ||
        BigInt(candle.closeNano) <= 0n ||
        BigInt(candle.closeNano) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("INVALID_USD_CLOSED_CANDLE");
    }
    previousAtMs = candle.timestamp;
  }
  return evidence.candles.map(({timestamp, closeNano}) => ({
    timestamp,
    closeNano
  }));
}

function closeAtoms(close) {
  const [whole, fraction = ""] = close.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

function strategySnapshot(state) {
  return Object.freeze({
    cutoffAt: state.cutoffAt,
    lastSeenAt: state.lastSeenAt,
    warmupComplete: state.warmupComplete,
    closes: Object.freeze(state.closes.map(candle => Object.freeze({
      timestamp: candle.timestamp,
      closeNano: candle.closeNano
    })))
  });
}

export function createProposedUsdSmaCandidate() {
  let state = createStrategyState();
  let previousEvidenceDigest = null;
  let pendingDecision = null;
  let pendingCandleEvidence = null;
  let evidenceRecords = 0;

  function decide(candleEvidence) {
    if (pendingDecision) throw new Error("USD_CANDIDATE_SAMPLE_NOT_RECORDED");
    const candles = validateCandleEvidence(candleEvidence);
    const advanced = advanceStrategy(state, candles);
    state = advanced.state;
    const signal = advanced.signals.at(-1) ?? null;
    pendingDecision = Object.freeze({
      schemaVersion: USD_SMA_CANDIDATE.schemaVersion,
      strategyVersion: USD_SMA_CANDIDATE.strategyVersion,
      sourceVersion: USD_SMA_CANDIDATE.sourceVersion,
      action: signal?.direction ?? "HOLD",
      signal: signal ? Object.freeze({...signal}) : null,
      newCandleCount: advanced.newCandleCount,
      missedDecisionWindow: advanced.missedDecisionWindow === true,
      warmupComplete: state.warmupComplete,
      cutoffAt: state.cutoffAt,
      lastSeenAt: state.lastSeenAt
    });
    pendingCandleEvidence = candleEvidence;
    return pendingDecision;
  }

  function recordSample(sample) {
    if (!pendingDecision || !pendingCandleEvidence ||
        sample?.candleEvidence !== pendingCandleEvidence ||
        sample.decision !== pendingDecision ||
        sample.schemaVersion !== "BTC_USD_CLOSED_CANDLE_CAUSAL_SAMPLE_V1") {
      throw new Error("USD_CANDIDATE_SAMPLE_MISMATCH");
    }
    const decisionAtMs = safeTime(sample.decisionAtMs, "DECISION_TIME");
    const tickerRequestStartedAtMs = safeTime(
      sample.tickerRequestStartedAtMs, "TICKER_REQUEST_STARTED_AT");
    const tickerReceivedAtMs = safeTime(sample.tickerReceivedAtMs, "TICKER_RECEIVED_AT");
    const observedAtMs = safeTime(sample.observation?.observedAtMs, "OBSERVATION_TIME");
    if (pendingCandleEvidence.receivedAtMs > decisionAtMs ||
        decisionAtMs > tickerRequestStartedAtMs ||
        tickerRequestStartedAtMs > tickerReceivedAtMs ||
        tickerReceivedAtMs > observedAtMs ||
        sample.observation.quote?.nativeInstrument !== "BTC/USD") {
      throw new Error("NONCAUSAL_STRATEGY_EVIDENCE");
    }
    const payload = {
      schemaVersion: "USD_BTC_SMA_CANDIDATE_EVIDENCE_V1",
      strategyVersion: USD_SMA_CANDIDATE.strategyVersion,
      sourceVersion: USD_SMA_CANDIDATE.sourceVersion,
      nativeInstrument: "BTC/USD",
      previousDigest: previousEvidenceDigest,
      candleEvidence: pendingCandleEvidence,
      decision: pendingDecision,
      strategyState: strategySnapshot(state),
      decisionAtMs,
      tickerRequestStartedAtMs,
      tickerReceivedAtMs,
      observedAtMs,
      observationId: sample.observation.id,
      quoteId: sample.observation.quote.id
    };
    const evidence = Object.freeze({...payload, digest: digest(payload)});
    previousEvidenceDigest = evidence.digest;
    evidenceRecords++;
    pendingDecision = null;
    pendingCandleEvidence = null;
    return evidence;
  }

  return Object.freeze({
    decide,
    recordSample,
    snapshot: () => strategySnapshot(state),
    evidenceRecords: () => evidenceRecords
  });
}

export function verifyProposedUsdSmaEvidence(evidence, expectedDigest) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("USD_STRATEGY_EVIDENCE_REQUIRED");
  }
  const {digest: recordedDigest, ...payload} = evidence;
  if (!DIGEST.test(recordedDigest ?? "") || digest(payload) !== recordedDigest ||
      (expectedDigest !== undefined && recordedDigest !== expectedDigest)) {
    throw new Error("USD_STRATEGY_EVIDENCE_TAMPERED");
  }
  if (payload.schemaVersion !== "USD_BTC_SMA_CANDIDATE_EVIDENCE_V1" ||
      payload.strategyVersion !== USD_SMA_CANDIDATE.strategyVersion ||
      payload.sourceVersion !== USD_SMA_CANDIDATE.sourceVersion ||
      payload.nativeInstrument !== "BTC/USD") {
    throw new Error("USD_STRATEGY_EVIDENCE_MISMATCH");
  }
  return Object.freeze({...payload, digest: recordedDigest});
}

export function requireRestartableUsdSmaCandidate(evidence, expectedDigest) {
  verifyProposedUsdSmaEvidence(evidence, expectedDigest);
  throw new Error("USD_CAMPAIGN_FEED_BUDGET_REVIEW_REQUIRED");
}
