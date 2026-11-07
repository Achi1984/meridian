import { lstat, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  advanceStrategy, createStrategyState, parseKrakenOhlc, parseKrakenTicker,
  sha256, SPOT_PAPER_PILOT_LIMITS
} from "./core.mjs";

export const EXPECTED_SIGNAL_REPLAY_IDENTITY = Object.freeze({
  acceptedSourceSha: "81edf0b5dc3d455c2c1e1906791d56c731bea0c9",
  workflowSha: "ddae14f01583196dfc9e9da906dcd03d41d58369",
  workflowRunId: "42395522899",
  workflowRunNumber: 1,
  workflowRunAttempt: 1,
  runId: "spot-paper-42395522899-1",
  model: "BTC_EUR_SMA5_SMA20_V1"
});

const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_RETAINED_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = SPOT_PAPER_PILOT_LIMITS.maxResponseBytes;
const MAX_CYCLES = 60;
const MAX_REQUESTS = 120;
const isInteger = Number.isSafeInteger;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const statusRank = { PASS: 0, UNKNOWN: 1, FAILED: 2 };

function worsenStatus(current, next) {
  return statusRank[next] > statusRank[current] ? next : current;
}

function canonicalErrorGapCycle(event) {
  if (event?.type !== "data_gap" || event.dataGap === "MISSED_DECISION_WINDOW") return null;
  const match = /^gap:([1-9]\d*):([1-9]\d*):(.+)$/.exec(event.id ?? "");
  if (!match) return null;
  const cycle = Number(match[1]);
  const requests = Number(match[2]);
  if (!isInteger(cycle) || cycle > MAX_CYCLES ||
      !isInteger(requests) || requests > MAX_REQUESTS || event.reason !== match[3] ||
      (event.cycle !== undefined && event.cycle !== cycle)) return null;
  return cycle;
}

function cycleForEvent(event) {
  if (event?.type === "data_gap" && event.dataGap !== "MISSED_DECISION_WINDOW") {
    return canonicalErrorGapCycle(event);
  }
  if (!isInteger(event?.cycle)) return null;
  return event.cycle;
}

function identityStatus(readback, provenance) {
  if (!readback || !provenance) return "UNKNOWN";
  const expected = EXPECTED_SIGNAL_REPLAY_IDENTITY;
  const valid = readback.runId === expected.runId &&
    readback.manifest?.model === expected.model &&
    readback.manifest?.mode === "paper" &&
    readback.manifest?.pair === SPOT_PAPER_PILOT_LIMITS.pair &&
    provenance.schemaVersion === "SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1" &&
    provenance.acceptedSourceSha === expected.acceptedSourceSha &&
    provenance.workflowSha === expected.workflowSha &&
    String(provenance.workflowRunId) === expected.workflowRunId &&
    provenance.workflowRunNumber === expected.workflowRunNumber &&
    provenance.workflowRunAttempt === expected.workflowRunAttempt &&
    provenance.runId === expected.runId &&
    provenance.model === expected.model;
  return valid ? "PASS" : "FAILED";
}

function rawBody(reference, responseBodies) {
  if (!reference || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? "") ||
      reference.path !== `responses/${reference.sha256}.json` ||
      !isInteger(reference.bytes) || reference.bytes < 1 ||
      reference.bytes > MAX_RESPONSE_BYTES ||
      !isInteger(reference.requestStartedAt) ||
      !isInteger(reference.receivedAt) ||
      reference.receivedAt < reference.requestStartedAt) {
    return { status: "FAILED", code: "INVALID_RAW_REFERENCE" };
  }
  const body = responseBodies instanceof Map ?
    responseBodies.get(reference.sha256) : responseBodies?.[reference.sha256];
  if (typeof body !== "string") return { status: "UNKNOWN", code: "MISSING_RAW_RESPONSE" };
  const bytes = Buffer.from(body, "utf8");
  if (bytes.byteLength !== reference.bytes || bytes.byteLength > MAX_RESPONSE_BYTES ||
      sha256(bytes) !== reference.sha256) {
    return { status: "FAILED", code: "RAW_RESPONSE_MISMATCH" };
  }
  return { status: "PASS", body };
}

function readOhlc(reference, responseBodies) {
  const raw = rawBody(reference, responseBodies);
  if (raw.status !== "PASS") return raw;
  try {
    const parsed = parseKrakenOhlc({
      raw: raw.body, sha256: reference.sha256,
      requestStartedAt: reference.requestStartedAt,
      receivedAt: reference.receivedAt, data: JSON.parse(raw.body)
    }, reference.receivedAt);
    if (reference.latestClosedAt !== undefined &&
        reference.latestClosedAt !== parsed.latestClosedAt) {
      return { status: "FAILED", code: "LATEST_CLOSED_CANDLE_MISMATCH" };
    }
    if (reference.ageMs !== undefined &&
        (!isInteger(reference.ageMs) || reference.ageMs < 0 ||
         reference.ageMs > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs)) {
      return { status: "FAILED", code: "STALE_CLOSED_CANDLE" };
    }
    return { status: "PASS", ...parsed };
  } catch {
    return { status: "FAILED", code: "INVALID_CLOSED_CANDLES" };
  }
}

function verifySignals(event, advanced, ohlc) {
  if (!Array.isArray(event.signals)) {
    return { status: "FAILED", code: "INVALID_SIGNAL_CLAIMS" };
  }
  const expected = advanced.signals.map(signal => ({
    ...signal, signalKnownAt: event.signalKnownAt
  }));
  if (expected.length && (!isInteger(event.signalKnownAt) ||
      event.signalKnownAt < ohlc.receivedAt)) {
    return { status: "FAILED", code: "INVALID_SIGNAL_TIMESTAMP" };
  }
  const claimed = event.signals;
  const expectedFields = ["id", "direction", "candleAt", "closeNano", "signalKnownAt"];
  const normalized = value => expectedFields.map(key => value?.[key]);
  if (claimed.length !== expected.length ||
      claimed.some((signal, index) => !same(normalized(signal), normalized(expected[index])))) {
    return { status: "FAILED", code: "SIGNAL_CLAIM_MISMATCH" };
  }
  return { status: "PASS", count: expected.length };
}

function eventHasReplayCandles(event) {
  return event.type === "observation" ||
    (event.type === "data_gap" && event.dataGap === "MISSED_DECISION_WINDOW") ||
    Boolean(event.acceptedOhlc);
}

function quoteAtFill(event, responseBodies) {
  const ticker = event.ticker ?? event.acceptedTicker;
  if (!ticker) return { status: "UNKNOWN", code: "MISSING_FILL_QUOTE" };
  const raw = rawBody(ticker, responseBodies);
  if (raw.status !== "PASS") return raw;
  if (!isInteger(ticker.acquisitionAgeMs) || ticker.acquisitionAgeMs < 0 ||
      ticker.acquisitionAgeMs > SPOT_PAPER_PILOT_LIMITS.maxQuoteAgeMs) {
    return { status: "FAILED", code: "STALE_FILL_QUOTE" };
  }
  try {
    const quote = parseKrakenTicker({
      raw: raw.body, sha256: ticker.sha256,
      requestStartedAt: ticker.requestStartedAt,
      receivedAt: ticker.receivedAt, data: JSON.parse(raw.body)
    }, ticker.receivedAt + ticker.acquisitionAgeMs);
    return { status: "PASS", quote, ticker };
  } catch {
    return { status: "FAILED", code: "INVALID_FILL_QUOTE" };
  }
}

function verifyFills(event, responseBodies, signalStatus) {
  if (!Array.isArray(event.fills)) return { status: "FAILED", code: "INVALID_FILL_CLAIMS" };
  let sampledStops = 0;
  for (const fill of event.fills) {
    const stop = fill?.side === "SELL" && fill.reason === "SAMPLED_2PCT_BID_STOP";
    if (stop) sampledStops++;
    const quoteResult = quoteAtFill(event, responseBodies);
    if (quoteResult.status !== "PASS") return quoteResult;
    const { ticker } = quoteResult;
    if (fill.quoteReceivedAt !== ticker.receivedAt) {
      return { status: "FAILED", code: "FILL_QUOTE_TIMESTAMP_MISMATCH" };
    }
    const ageAtEffect = event.ohlc?.ageMs + ticker.receivedAt -
      event.ohlc?.receivedAt + ticker.acquisitionAgeMs;
    if (!isInteger(event.ohlc?.ageMs) || !isInteger(ageAtEffect) || ageAtEffect < 0 ||
        ageAtEffect > SPOT_PAPER_PILOT_LIMITS.maxCandleAgeMs) {
      return { status: "FAILED", code: "STALE_FILL_CANDLE" };
    }
    if (!stop && (signalStatus !== "PASS" ||
        !isInteger(event.signalKnownAt) ||
        ticker.requestStartedAt < event.signalKnownAt)) {
      return { status: "FAILED", code: "PRE_SIGNAL_FILL_QUOTE" };
    }
    if (!stop && !event.signals.some(signal =>
      fill.id === `${fill.side === "BUY" ? "entry" : "exit"}:${signal.id}` &&
      fill.signalAt === signal.candleAt &&
      signal.direction === (fill.side === "BUY" ? "ENTRY" : "EXIT"))) {
      return { status: "FAILED", code: "FILL_WITHOUT_MATCHING_SMA_SIGNAL" };
    }
    if (stop && (!isInteger(fill.signalAt) || fill.signalAt < ticker.receivedAt)) {
      return { status: "FAILED", code: "INVALID_SAMPLED_STOP_TIME" };
    }
  }
  return { status: "PASS", sampledStops };
}

function stateMatches(left, right) {
  return Boolean(left && right && left.cutoffAt === right.cutoffAt &&
    left.lastSeenAt === right.lastSeenAt &&
    left.warmupComplete === right.warmupComplete &&
    same(left.closes, right.closes));
}

export function replaySpotPaperSignals({ readback, provenance, responseBodies } = {}) {
  const discrepancies = [];
  const identity = identityStatus(readback, provenance);
  if (identity !== "PASS") {
    return {
      outcome: identity,
      identity,
      signalReplay: identity === "PASS" ? "PASS" : "NOT_ASSESSED",
      fillCausality: "NOT_ASSESSED",
      startupCutoff: "NOT_ASSESSED",
      supportedClaim: "No replay claim; evidence identity is not verified.",
      replayedSignals: 0,
      sampledStopCount: 0,
      discrepancies: [identity === "UNKNOWN" ? "MISSING_IDENTITY" : "IDENTITY_MISMATCH"]
    };
  }

  const events = readback.events;
  const cycleEvents = Array.isArray(events) ? events.slice(1, -1) : [];
  const shapeValid = readback.reconciliation === "TERMINAL_REPORT_AVAILABLE" &&
    readback.resumed === false && readback.executionImpact === false &&
    readback.eventCount === events?.length && Array.isArray(events) &&
    events.length >= 2 && events.length <= MAX_CYCLES + 2 &&
    events.every(event => event && typeof event === "object" && !Array.isArray(event)) &&
    events[0]?.id === "run-start" && events.at(-1)?.id === "run-terminal" &&
    events.filter(event => event.id === "run-terminal").length === 1 &&
    isInteger(readback.checkpoint?.cycle) &&
    readback.checkpoint.cycle >= 0 && readback.checkpoint.cycle <= MAX_CYCLES &&
    cycleEvents.length === readback.checkpoint.cycle &&
    cycleEvents.every((event, index) => cycleForEvent(event) === index + 1);
  if (!shapeValid) {
    return {
      outcome: "UNKNOWN", identity, signalReplay: "UNKNOWN",
      fillCausality: "UNKNOWN", startupCutoff: "UNKNOWN",
      supportedClaim: "No replay claim; retained journal is incomplete or outside bounds.",
      replayedSignals: 0, sampledStopCount: 0,
      discrepancies: ["INCOMPLETE_OR_UNBOUNDED_JOURNAL"]
    };
  }
  const bodies = responseBodies ?? {};
  const references = new Map();
  for (const event of events) {
    for (const reference of [event.ohlc, event.ticker,
      event.acceptedOhlc, event.acceptedTicker]) {
      if (reference?.sha256) references.set(reference.sha256, reference);
    }
  }
  if (references.size > MAX_CYCLES * 4) {
    return {
      outcome: "UNKNOWN", identity, signalReplay: "UNKNOWN",
      fillCausality: "UNKNOWN", startupCutoff: "UNKNOWN",
      supportedClaim: "No replay claim; retained response set exceeds bounds.",
      replayedSignals: 0, sampledStopCount: 0,
      discrepancies: ["RESPONSE_REFERENCE_LIMIT_EXCEEDED"]
    };
  }
  let totalBytes = 0;
  for (const [hash, reference] of references) {
    const raw = rawBody(reference, bodies);
    if (raw.status === "PASS") totalBytes += Buffer.byteLength(raw.body, "utf8");
    else discrepancies.push(raw.code);
  }
  if (totalBytes > MAX_RETAINED_RESPONSE_BYTES) {
    discrepancies.push("RESPONSE_BYTE_LIMIT_EXCEEDED");
  }
  if (discrepancies.some(code => code === "INVALID_RAW_REFERENCE" ||
      code === "RAW_RESPONSE_MISMATCH" || code === "RESPONSE_BYTE_LIMIT_EXCEEDED")) {
    return {
      outcome: "FAILED", identity, signalReplay: "FAILED",
      fillCausality: "UNKNOWN", startupCutoff: "UNKNOWN",
      supportedClaim: "No replay claim; retained response integrity or bounds failed.",
      replayedSignals: 0, sampledStopCount: 0,
      discrepancies: [...new Set(discrepancies)]
    };
  }

  let state = createStrategyState();
  let startupCutoff = "UNKNOWN";
  let replayedSignals = 0;
  let sampledStopCount = 0;
  let lastCycle = 0;
  let signalStatus = "PASS";
  let fillStatus = "PASS";
  let unknownEvidence = discrepancies.length > 0;
  for (const event of events) {
    const cycle = cycleForEvent(event);
    if (cycle === null) continue;
    if (cycle !== lastCycle + 1) {
      discrepancies.push("CYCLE_ORDER_MISMATCH");
      signalStatus = worsenStatus(signalStatus, "FAILED");
      break;
    }
    lastCycle = cycle;
    const runnerErrorGap = event.type === "data_gap" &&
      event.dataGap !== "MISSED_DECISION_WINDOW";
    const replayEvent = runnerErrorGap && event.fills === undefined ?
      { ...event, fills: [] } : event;
    if (!eventHasReplayCandles(event)) {
      if (event.signals?.length) {
        discrepancies.push("SIGNALS_WITHOUT_CLOSED_CANDLES");
        signalStatus = worsenStatus(signalStatus, "FAILED");
      }
      if (event.fills?.length) {
        discrepancies.push("FILLS_WITHOUT_MARKET_EVIDENCE");
        fillStatus = worsenStatus(fillStatus, "FAILED");
      }
      continue;
    }
    const ohlcReference = event.ohlc ?? event.acceptedOhlc;
    const ohlc = readOhlc(ohlcReference, bodies);
    if (ohlc.status !== "PASS") {
      discrepancies.push(ohlc.code);
      if (ohlc.status === "UNKNOWN") {
        unknownEvidence = true;
        signalStatus = worsenStatus(signalStatus, "UNKNOWN");
      } else signalStatus = worsenStatus(signalStatus, "FAILED");
      continue;
    }
    const provisional = event.type === "data_gap" &&
      event.dataGap !== "MISSED_DECISION_WINDOW";
    let advanced;
    try {
      advanced = advanceStrategy(state, ohlc.candles);
    } catch (error) {
      discrepancies.push(error.message === "CONFLICTING_CLOSED_CANDLE" ?
        error.message : error.message === "CLOSED_CANDLE_GAP" ?
          error.message : "STRATEGY_REPLAY_FAILED");
      signalStatus = worsenStatus(signalStatus, "FAILED");
      continue;
    }
    if (startupCutoff === "UNKNOWN" && state.cutoffAt === null) {
      startupCutoff = advanced.state.cutoffAt === ohlc.latestClosedAt &&
        advanced.signals.length === 0 ? "PASS" : "FAILED";
      if (startupCutoff === "FAILED") discrepancies.push("INVALID_STARTUP_CUTOFF");
    }
    const signalCheck = verifySignals(replayEvent, advanced, ohlc);
    if (signalCheck.status !== "PASS") {
      discrepancies.push(signalCheck.code);
      signalStatus = worsenStatus(signalStatus, signalCheck.status);
    } else {
      replayedSignals += signalCheck.count;
    }
    const fillCheck = verifyFills(replayEvent, bodies, signalCheck.status);
    if (fillCheck.status !== "PASS") {
      discrepancies.push(fillCheck.code);
      if (fillCheck.status === "UNKNOWN") unknownEvidence = true;
      fillStatus = worsenStatus(fillStatus, fillCheck.status);
    } else {
      sampledStopCount += fillCheck.sampledStops;
    }
    if (!provisional) state = advanced.state;
  }

  if (!stateMatches(state, readback.checkpoint.strategy)) {
    discrepancies.push("FINAL_STRATEGY_STATE_MISMATCH");
    signalStatus = worsenStatus(signalStatus, unknownEvidence ? "UNKNOWN" : "FAILED");
  }
  if (startupCutoff === "UNKNOWN") {
    discrepancies.push("STARTUP_CUTOFF_UNAVAILABLE");
    unknownEvidence = true;
  }
  if (discrepancies.includes("MISSING_RAW_RESPONSE")) unknownEvidence = true;
  const outcome = signalStatus === "FAILED" || fillStatus === "FAILED" ||
    startupCutoff === "FAILED" ? "FAILED" : unknownEvidence ? "UNKNOWN" : "PASS";
  return {
    outcome,
    identity,
    signalReplay: signalStatus,
    fillCausality: fillStatus,
    startupCutoff,
    supportedClaim: outcome === "PASS" ?
      `Replayed ${replayedSignals} claimed SMA signal(s) against retained closed candles; this does not assess profitability.` :
      "No complete replay claim; see discrepancies. Profitability is not assessed.",
    replayedSignals,
    sampledStopCount,
    discrepancies: [...new Set(discrepancies)]
  };
}

async function boundedRead(path, maxBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    throw new Error("INPUT_FILE_INVALID_OR_TOO_LARGE");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes) throw new Error("INPUT_FILE_INVALID_OR_TOO_LARGE");
  return bytes.toString("utf8");
}

export async function main(argv = process.argv.slice(2)) {
  const [readbackPath, provenancePath, runDirectory, outputPath] = argv;
  if (!readbackPath || !provenancePath || !runDirectory || !outputPath) {
    throw new Error("Usage: signal-replay.mjs <readback.json> <pilot-manifest.json> <run-directory> <replay.json>");
  }
  const readback = JSON.parse(await boundedRead(readbackPath, MAX_JOURNAL_BYTES));
  const provenance = JSON.parse(await boundedRead(provenancePath, MAX_MANIFEST_BYTES));
  const responseBodies = new Map();
  const references = new Map();
  for (const event of readback?.events ?? []) {
    for (const reference of [event.ohlc, event.ticker,
      event.acceptedOhlc, event.acceptedTicker]) {
      if (reference?.sha256 && !references.has(reference.sha256)) {
        references.set(reference.sha256, reference);
      }
    }
  }
  if (references.size > MAX_CYCLES * 4) throw new Error("RESPONSE_REFERENCE_LIMIT_EXCEEDED");
  let totalBytes = 0;
  for (const [hash, reference] of references) {
    if (!/^[a-f0-9]{64}$/.test(hash) ||
        reference.path !== `responses/${hash}.json` ||
        !isInteger(reference.bytes) || reference.bytes < 1 ||
        reference.bytes > MAX_RESPONSE_BYTES) throw new Error("INVALID_RAW_REFERENCE");
    let raw;
    try {
      raw = await boundedRead(join(runDirectory, reference.path), MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      continue;
    }
    const bytes = Buffer.from(raw, "utf8");
    totalBytes += bytes.byteLength;
    if (bytes.byteLength !== reference.bytes || sha256(bytes) !== hash ||
        totalBytes > MAX_RETAINED_RESPONSE_BYTES) {
      throw new Error("RAW_RESPONSE_MISMATCH_OR_LIMIT");
    }
    responseBodies.set(hash, raw);
  }
  const result = replaySpotPaperSignals({ readback, provenance, responseBodies });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.outcome !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
