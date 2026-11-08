import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPECTED_SIGNAL_REPLAY_IDENTITY, main as signalReplayMain, replaySpotPaperSignals
} from "../scripts/spot-paper-pilot/signal-replay.mjs";
import {
  advanceStrategy, createStrategyState, sha256
} from "../scripts/spot-paper-pilot/core.mjs";
import { getSignalReplayProfile } from
  "../scripts/spot-paper-pilot/evidence-profiles.mjs";
import { readRunJournal } from "../scripts/spot-paper-pilot/journal.mjs";
import { runSpotPaperPilot } from "../scripts/spot-paper-pilot/runner.mjs";

const BASE = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;
const PRICE_100 = "100.00000000";
const PRICE_120 = "120.00000000";

function priceRow(timestamp, price) {
  return [timestamp / 1000, price, price, price, price, price, "1.00000000", 1];
}

function marketResponse(data, startedAt, receivedAt) {
  const raw = JSON.stringify(data);
  const digest = sha256(Buffer.from(raw, "utf8"));
  return {
    raw,
    reference: {
      path: `responses/${digest}.json`, sha256: digest,
      bytes: Buffer.byteLength(raw), requestStartedAt: startedAt, receivedAt
    }
  };
}

function ohlc(closes, startAt = BASE) {
  const rows = closes.map((close, index) =>
    priceRow(startAt + index * MINUTE, close));
  rows.push(priceRow(startAt + closes.length * MINUTE, closes.at(-1)));
  return { error: [], result: { XXBTZEUR: rows, last: rows.at(-1)[0] } };
}

function ticker() {
  return {
    error: [],
    result: { XXBTZEUR: {
      a: ["100.01000000", "1", "1.00000000"],
      b: ["100.00000000", "1", "1.00000000"]
    } }
  };
}

function identity(profileId) {
  const profile = getSignalReplayProfile(profileId);
  const profileFields = Object.fromEntries(Object.entries(profile)
    .filter(([key]) => key !== "profileId" && key !== "identity"));
  const dynamicIdentity = profile.identity.kind === "fixed" ?
    profile.identity : {
      workflowSha: "b".repeat(40),
      workflowRunId: "987654321",
      workflowRunNumber: 1,
      workflowRunAttempt: 1,
      runId: "spot-paper-987654321-1"
    };
  const dispatchFields = profileId === "BTC_EUR_PAPER_4H_V1" ? {
    repository: "Achi1984/meridian",
    workflowPath: ".github/workflows/spot-paper-pilot-four-hour-once.yml",
    ref: "refs/heads/main"
  } : {};
  return {
    ...profileFields,
    ...dynamicIdentity,
    ...dispatchFields,
    ...(profileId ? { profileId: profile.profileId } : {})
  };
}

function fixture() {
  const responseBodies = {};
  const events = [{ id: "run-start", type: "start" }];
  let state = createStrategyState();
  let cycle = 0;
  const addEvent = ({
    closes, startAt = BASE, type = "observation", dataGap = null,
    provisional = false, claimedSignals, fills = [], tickerRef = true
  }) => {
    cycle++;
    const ohlcAt = startAt + (closes.length + 1) * MINUTE;
    const ohlcResponse = marketResponse(ohlc(closes, startAt), ohlcAt - 100, ohlcAt);
    responseBodies[ohlcResponse.reference.sha256] = ohlcResponse.raw;
    const storedOhlc = {
      ...ohlcResponse.reference,
      latestClosedAt: startAt + (closes.length - 1) * MINUTE,
      ageMs: MINUTE
    };
    let advanced;
    try {
      advanced = advanceStrategy(state, parseCandles(closes, startAt));
    } catch {
      advanced = { state, signals: [] };
    }
    const signalKnownAt = ohlcAt + 10;
    const signals = claimedSignals ?? advanced.signals.map(signal => ({
      ...signal, signalKnownAt
    }));
    let storedTicker;
    if (tickerRef) {
      const tickerAt = signalKnownAt + 20;
      const tickerResponse = marketResponse(ticker(), signalKnownAt + 1, tickerAt);
      responseBodies[tickerResponse.reference.sha256] = tickerResponse.raw;
      storedTicker = {
        ...tickerResponse.reference,
        acquisitionAgeMs: 0
      };
    }
    const event = {
      id: `cycle:${cycle}`, type, dataGap, cycle, signalKnownAt,
      signals, fills
    };
    if (type === "data_gap" && dataGap !== "MISSED_DECISION_WINDOW") {
      event.acceptedOhlc = storedOhlc;
      if (storedTicker) event.acceptedTicker = storedTicker;
    } else {
      event.ohlc = storedOhlc;
      if (storedTicker) event.ticker = storedTicker;
    }
    events.push(event);
    if (!provisional) state = advanced.state;
    return { event, state, advanced, responseBodies };
  };
  return {
    responseBodies,
    addEvent,
    readback: () => {
      events.push({ id: "run-terminal", type: "terminal" });
      return {
        reconciliation: "TERMINAL_REPORT_AVAILABLE",
        runId: EXPECTED_SIGNAL_REPLAY_IDENTITY.runId,
        eventCount: events.length, resumed: false, executionImpact: false,
        manifest: {
          schemaVersion: "SPOT_PAPER_PILOT_MANIFEST_V1",
          model: EXPECTED_SIGNAL_REPLAY_IDENTITY.model,
          mode: "paper", pair: "BTC/EUR",
          limits: {
            maxCycles: 60, maxRequests: 120, maxDurationMs: 3_600_000,
            pollIntervalMs: 60_000, requestTimeoutMs: 5_000,
            maxBytes: 67_108_864, maxResponseBytes: 262_144
          }
        },
        checkpoint: {
          cycle, strategy: state,
          counters: { requests: cycle * 2, bytes: 0 }
        },
        events
      };
    },
    get state() { return state; }
  };
}

function parseCandles(closes, startAt) {
  return closes.map((close, index) => {
    const closeNano = String(BigInt(close.replace(".", "")));
    return {
      timestamp: startAt + index * MINUTE,
      openNano: closeNano, highNano: closeNano, lowNano: closeNano, closeNano
    };
  });
}

function run(fixtureData, provenance = identity(), bodies = fixtureData.responseBodies) {
  return replaySpotPaperSignals({
    readback: fixtureData.readback(), provenance, responseBodies: bodies
  });
}

function fourHourReplayEvidence(fixtureData) {
  const provenance = identity("BTC_EUR_PAPER_4H_V1");
  const expectedDispatch = {
    repository: "Achi1984/meridian",
    workflowPath: ".github/workflows/spot-paper-pilot-four-hour-once.yml",
    ref: "refs/heads/main",
    workflowSha: provenance.workflowSha,
    workflowRunId: provenance.workflowRunId,
    workflowRunNumber: provenance.workflowRunNumber,
    workflowRunAttempt: provenance.workflowRunAttempt
  };
  const readback = fixtureData.readback();
  readback.runId = provenance.runId;
  readback.manifest.limits = {
    maxCycles: 240, maxRequests: 480, maxDurationMs: 14_400_000,
    pollIntervalMs: 60_000, requestTimeoutMs: 5_000,
    maxBytes: 67_108_864, maxResponseBytes: 262_144
  };
  return {
    readback, provenance, responseBodies: fixtureData.responseBodies,
    expectedDispatch
  };
}

async function runnerTickerFailureFixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), "spot-paper-signal-replay-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const now = { value: BASE + 21 * MINUTE + 1_000, monotonic: 0 };
  const responseBodies = new Map();
  let ohlcCycle = 0;
  let tickerCycle = 0;
  const acquire = (data, receivedAt, requestStartedAt = receivedAt - 20) => {
    const raw = JSON.stringify(data);
    const digest = sha256(Buffer.from(raw, "utf8"));
    responseBodies.set(digest, raw);
    return {
      data, raw, sha256: digest, bytes: Buffer.byteLength(raw),
      requestStartedAt, receivedAt
    };
  };
  const provider = {
    async fetchOhlc() {
      ohlcCycle++;
      const closes = ohlcCycle === 1 ? Array(21).fill(PRICE_100) :
        [...Array(21).fill(PRICE_100), PRICE_120];
      return acquire(ohlc(closes), now.value);
    },
    async fetchTicker() {
      tickerCycle++;
      if (tickerCycle === 2) throw new Error("FETCH_FAILED");
      return acquire(ticker(), now.value, now.value);
    },
    counters: () => ({ requests: ohlcCycle + tickerCycle, bytes: 0 })
  };
  await runSpotPaperPilot({
    dataRoot, runId: EXPECTED_SIGNAL_REPLAY_IDENTITY.runId, provider,
    mode: "paper", maxCycles: 3, maxDurationMs: 180_000,
    pollIntervalMs: MINUTE, requestTimeoutMs: 5_000,
    now: () => now.value, monotonicNow: () => now.monotonic,
    sleep: async duration => {
      now.value += duration;
      now.monotonic += duration;
    }
  });
  const journal = await readRunJournal({
    dataRoot, runId: EXPECTED_SIGNAL_REPLAY_IDENTITY.runId
  });
  const events = journal.events;
  const terminal = events.at(-1);
  const readback = {
    reconciliation: "TERMINAL_REPORT_AVAILABLE",
    runId: journal.runId, eventCount: events.length,
    resumed: false, executionImpact: false, manifest: journal.manifest,
    checkpoint: journal.checkpoint, events, report: terminal.report
  };
  return { readback, responseBodies };
}

test("replays and confirms a real SMA5/SMA20 upward crossover", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const crossing = data.addEvent({
    closes: [...Array(21).fill(PRICE_100), PRICE_120]
  });
  const result = run(data);
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  assert.equal(result.signalReplay, "PASS");
  assert.equal(result.replayedSignals, 1);
  assert.deepEqual(crossing.event.signals.map(signal => [
    signal.id, signal.direction, signal.candleAt, signal.closeNano
  ]), [[`ENTRY:${BASE + 21 * MINUTE}`, "ENTRY",
    BASE + 21 * MINUTE, "12000000000"]]);
});

test("rejects a fabricated ENTRY on the flat 21-candle startup cutoff", () => {
  const data = fixture();
  const closes = Array(21).fill(PRICE_100);
  const event = data.addEvent({
    closes,
    claimedSignals: [{
      id: `ENTRY:${BASE + 20 * MINUTE}`, direction: "ENTRY",
      candleAt: BASE + 20 * MINUTE, closeNano: "10000000000",
      signalKnownAt: BASE + 22 * MINUTE + 10
    }]
  });
  const result = run(data);
  assert.equal(event.event.signals.length, 1);
  assert.equal(result.outcome, "FAILED");
  assert.ok(result.discrepancies.includes("SIGNAL_CLAIM_MISMATCH"));
});

test("reports conflicting closed candles and skipped decision bars", () => {
  const conflict = fixture();
  conflict.addEvent({ closes: Array(21).fill(PRICE_100) });
  const changed = [...Array(21).fill(PRICE_100), PRICE_120];
  const changedEvent = conflict.addEvent({ closes: changed });
  const rawRef = changedEvent.event.ohlc;
  const changedRaw = JSON.parse(conflict.responseBodies[rawRef.sha256]);
  changedRaw.result.XXBTZEUR[20] = priceRow(BASE + 20 * MINUTE, "101.00000000");
  const altered = marketResponse(changedRaw, rawRef.requestStartedAt, rawRef.receivedAt);
  conflict.responseBodies[altered.reference.sha256] = altered.raw;
  changedEvent.event.ohlc = {
    ...rawRef, ...altered.reference,
    latestClosedAt: rawRef.latestClosedAt, ageMs: rawRef.ageMs
  };
  const conflictResult = run(conflict);
  assert.equal(conflictResult.outcome, "FAILED");
  assert.ok(conflictResult.discrepancies.includes("CONFLICTING_CLOSED_CANDLE"));

  const gap = fixture();
  gap.addEvent({ closes: Array(21).fill(PRICE_100) });
  gap.addEvent({
    closes: [PRICE_100], startAt: BASE + 22 * MINUTE,
    type: "data_gap", dataGap: "MISSED_DECISION_WINDOW"
  });
  const gapResult = run(gap);
  assert.equal(gapResult.outcome, "FAILED");
  assert.ok(gapResult.discrepancies.includes("CLOSED_CANDLE_GAP"));
});

test("replays a pinned-runner ticker error gap provisionally before the next observation", async t => {
  const { readback, responseBodies } = await runnerTickerFailureFixture(t);
  const [warmup, failedTicker, accepted] = readback.events.slice(1, -1);
  assert.equal(failedTicker.id, "gap:2:4:FETCH_FAILED");
  assert.equal("cycle" in failedTicker, false);
  assert.equal("fills" in failedTicker, false);
  assert.ok(failedTicker.acceptedOhlc);
  assert.equal(failedTicker.signals[0].direction, "ENTRY");
  assert.deepEqual(warmup.signals, []);
  assert.equal(accepted.cycle, 3);
  const result = replaySpotPaperSignals({
    readback, provenance: identity(), responseBodies
  });
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  assert.equal(result.replayedSignals, 2);

  const wrongCycle = structuredClone(readback);
  wrongCycle.events[2].id = "gap:3:4:FETCH_FAILED";
  const invalidGap = replaySpotPaperSignals({
    readback: wrongCycle, provenance: identity(), responseBodies
  });
  assert.equal(invalidGap.outcome, "UNKNOWN");
  assert.ok(invalidGap.discrepancies.includes("INCOMPLETE_OR_UNBOUNDED_JOURNAL"));
});

test("passes valid zero-entry evidence and keeps sampled stops separate", () => {
  const empty = fixture();
  empty.addEvent({ closes: Array(21).fill(PRICE_100) });
  const emptyResult = run(empty);
  assert.equal(emptyResult.outcome, "PASS");
  assert.equal(emptyResult.replayedSignals, 0);

  const stopped = fixture();
  const baseline = stopped.addEvent({ closes: Array(21).fill(PRICE_100) });
  const tickerRef = baseline.event.ticker;
  baseline.event.fills = [{
    id: "exit:sampled-stop", side: "SELL", reason: "SAMPLED_2PCT_BID_STOP",
    signalAt: tickerRef.receivedAt, quoteReceivedAt: tickerRef.receivedAt
  }];
  const stopResult = run(stopped);
  assert.equal(stopResult.outcome, "PASS", JSON.stringify(stopResult));
  assert.equal(stopResult.replayedSignals, 0);
  assert.equal(stopResult.sampledStopCount, 1);
});

test("distinguishes missing raw, identity, and timestamp evidence", () => {
  const missing = fixture();
  const missingEvent = missing.addEvent({ closes: Array(21).fill(PRICE_100) }).event;
  const missingHash = missingEvent.ohlc.sha256;
  const missingBodies = { ...missing.responseBodies };
  delete missingBodies[missingHash];
  assert.equal(run(missing, identity(), missingBodies).outcome, "UNKNOWN");

  const wrongIdentity = fixture();
  wrongIdentity.addEvent({ closes: Array(21).fill(PRICE_100) });
  assert.equal(run(wrongIdentity, {
    ...identity(), workflowRunId: "42395522898"
  }).outcome, "FAILED");

  const wrongTimestamp = fixture();
  const event = wrongTimestamp.addEvent({ closes: Array(21).fill(PRICE_100) }).event;
  event.ohlc.latestClosedAt += MINUTE;
  assert.equal(run(wrongTimestamp).outcome, "FAILED");
});

test("four-hour allowlisted replay binds fresh identity and rejects source, mode, and cap mismatches", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const evidence = fourHourReplayEvidence(data);
  const result = replaySpotPaperSignals({ ...evidence, profileId: "BTC_EUR_PAPER_4H_V1" });
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  assert.equal(result.profileId, "BTC_EUR_PAPER_4H_V1");

  for (const change of [
    provenance => { provenance.runId = "spot-paper-987654322-1"; },
    provenance => { provenance.acceptedSourceSha = "0".repeat(40); },
    provenance => { provenance.mode = "observe"; }
  ]) {
    const altered = structuredClone(evidence);
    change(altered.provenance);
    assert.equal(replaySpotPaperSignals({
      ...altered, profileId: "BTC_EUR_PAPER_4H_V1"
    }).outcome, "FAILED");
  }

  const exceeded = structuredClone(evidence);
  exceeded.readback.manifest.limits.maxCycles = 241;
  const capResult = replaySpotPaperSignals({
    ...exceeded, profileId: "BTC_EUR_PAPER_4H_V1"
  });
  assert.equal(capResult.outcome, "UNKNOWN");
  assert.ok(capResult.discrepancies.includes("INCOMPLETE_OR_UNBOUNDED_JOURNAL"));

  const missing = { ...evidence, responseBodies: { ...evidence.responseBodies } };
  delete missing.responseBodies[evidence.readback.events[1].ohlc.sha256];
  assert.equal(replaySpotPaperSignals({
    ...missing, profileId: "BTC_EUR_PAPER_4H_V1"
  }).outcome, "UNKNOWN");

  const failureData = fixture();
  failureData.addEvent({ closes: Array(21).fill(PRICE_100) });
  failureData.addEvent({ closes: [...Array(21).fill(PRICE_100), PRICE_120] });
  const failedAndMissing = fourHourReplayEvidence(failureData);
  failedAndMissing.readback.events[2].signals[0].direction = "EXIT";
  delete failedAndMissing.responseBodies[failedAndMissing.readback.events[1].ohlc.sha256];
  assert.equal(replaySpotPaperSignals({
    ...failedAndMissing, profileId: "BTC_EUR_PAPER_4H_V1"
  }).outcome, "FAILED");
  assert.throws(() => replaySpotPaperSignals({
    ...evidence, profileId: "caller-controlled-profile"
  }), /UNKNOWN_SIGNAL_REPLAY_PROFILE/);

  const missingExpectation = { ...evidence, expectedDispatch: undefined };
  assert.equal(replaySpotPaperSignals({
    ...missingExpectation, profileId: "BTC_EUR_PAPER_4H_V1"
  }).outcome, "UNKNOWN");

  const coordinatedTampering = structuredClone(evidence);
  coordinatedTampering.provenance.workflowSha = "c".repeat(40);
  coordinatedTampering.provenance.workflowRunId = "987654322";
  coordinatedTampering.provenance.runId = "spot-paper-987654322-1";
  coordinatedTampering.readback.runId = "spot-paper-987654322-1";
  const rejectedCoordinatedTampering = replaySpotPaperSignals({
    ...coordinatedTampering, profileId: "BTC_EUR_PAPER_4H_V1"
  });
  assert.equal(rejectedCoordinatedTampering.outcome, "FAILED");
  assert.equal(rejectedCoordinatedTampering.identity, "FAILED");
});

test("known signal failure remains FAILED when another referenced response is missing", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const crossing = data.addEvent({
    closes: [...Array(21).fill(PRICE_100), PRICE_120]
  }).event;
  crossing.signals[0].direction = "EXIT";
  const readback = data.readback();
  const missingHash = readback.events[1].ohlc.sha256;
  const bodies = { ...data.responseBodies };
  delete bodies[missingHash];
  readback.checkpoint.strategy.lastSeenAt += MINUTE;
  const result = replaySpotPaperSignals({
    readback, provenance: identity(), responseBodies: bodies
  });
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.signalReplay, "FAILED");
  assert.ok(result.discrepancies.includes("MISSING_RAW_RESPONSE"));
  assert.ok(result.discrepancies.includes("SIGNAL_CLAIM_MISMATCH"));
});

test("CLI writes an UNKNOWN report when a retained raw response file is missing", async t => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const root = await mkdtemp(join(tmpdir(), "spot-paper-signal-replay-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const readbackPath = join(root, "readback.json");
  const provenancePath = join(root, "pilot-manifest.json");
  const runDirectory = join(root, "run");
  const outputPath = join(root, "replay.json");
  await mkdir(runDirectory);
  await writeFile(readbackPath, JSON.stringify(data.readback()));
  await writeFile(provenancePath, JSON.stringify(identity()));
  const previousExitCode = process.exitCode;
  try {
    await signalReplayMain([readbackPath, provenancePath, runDirectory, outputPath]);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(output.outcome, "UNKNOWN");
    assert.ok(output.discrepancies.includes("MISSING_RAW_RESPONSE"));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("CLI selects the allowlisted four-hour profile for retained evidence", async t => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const evidence = fourHourReplayEvidence(data);
  const root = await mkdtemp(join(tmpdir(), "spot-paper-signal-replay-4h-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const readbackPath = join(root, "readback.json");
  const provenancePath = join(root, "pilot-manifest.json");
  const runDirectory = join(root, "run");
  const responseDirectory = join(runDirectory, "responses");
  const outputPath = join(root, "replay.json");
  const missingContextOutputPath = join(root, "replay-missing-context.json");
  await mkdir(responseDirectory, { recursive: true });
  await writeFile(readbackPath, JSON.stringify(evidence.readback));
  await writeFile(provenancePath, JSON.stringify(evidence.provenance));
  for (const [hash, raw] of Object.entries(evidence.responseBodies)) {
    await writeFile(join(responseDirectory, `${hash}.json`), raw);
  }
  const previousExitCode = process.exitCode;
  try {
    await signalReplayMain([
      readbackPath, provenancePath, runDirectory, missingContextOutputPath,
      "BTC_EUR_PAPER_4H_V1"
    ], {});
    assert.equal(JSON.parse(await readFile(missingContextOutputPath, "utf8")).outcome,
      "UNKNOWN");
    process.exitCode = previousExitCode;
    const expectedEnvironment = Object.fromEntries(
      Object.entries(evidence.expectedDispatch).map(([field, value]) => [
        `MERIDIAN_EXPECTED_DISPATCH_${field.replace(/^workflowRunId$/, "runId")
          .replace(/^workflowRunNumber$/, "runNumber")
          .replace(/^workflowRunAttempt$/, "runAttempt").replace(/[A-Z]/g,
          letter => `_${letter}`).toUpperCase()}`, String(value)
      ]));
    await signalReplayMain([
      readbackPath, provenancePath, runDirectory, outputPath, "BTC_EUR_PAPER_4H_V1"
    ], expectedEnvironment);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(output.outcome, "PASS");
    assert.equal(output.profileId, "BTC_EUR_PAPER_4H_V1");
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("rejects stale and pre-signal fill quotes", () => {
  const data = fixture();
  data.addEvent({ closes: Array(21).fill(PRICE_100) });
  const event = data.addEvent({
    closes: [...Array(21).fill(PRICE_100), PRICE_120]
  }).event;
  event.fills = [{
    id: `entry:${event.signals[0].id}`, side: "BUY",
    signalAt: event.signals[0].candleAt,
    quoteReceivedAt: event.ticker.receivedAt
  }];
  event.ticker.requestStartedAt = event.signalKnownAt - 1;
  const result = run(data);
  assert.equal(result.outcome, "FAILED");
  assert.ok(result.discrepancies.includes("PRE_SIGNAL_FILL_QUOTE"));
});
