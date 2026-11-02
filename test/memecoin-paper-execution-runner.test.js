import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {canonicalCheckpointBytes, CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {PaperCheckpointSession} from "../scripts/memecoin-paper/checkpoint-session.mjs";
import {createPaperExecutionStep} from "../scripts/memecoin-paper/execution-step.mjs";
import {
  createPaperExecutionRunner,
  runOfflineDemo
} from "../scripts/memecoin-paper/execution-runner.mjs";
import {
  SYNTHETIC_SMART_WALLET_ALLOWLIST,
  SYNTHETIC_SOURCE,
  syntheticCandidate
} from "../scripts/memecoin-paper/synthetic-fixtures.mjs";
import {analyzeCandidate, filterCandidate} from "../scripts/memecoin-paper/stages.mjs";

const START = Date.parse("2026-11-02T12:00:00Z");
const RUN_ID = "runner-test";
const END = START + 8 * 60 * 60 * 1000;

function harness({
  authorizeUnknown = false,
  riskUnacknowledged = false,
  riskLedgerUnknown = false,
  closeOnRiskSnapshot = false,
  finishReject = false
} = {}) {
  const calls = [];
  let sequence = 0;
  const summary = {
    runId: RUN_ID,
    openPositions: [],
    eventCount: 0,
    costs: {}
  };
  const session = {
    metadata: {runId: RUN_ID, startedAt: START, deadlineAt: END, sequence: 0},
    snapshot: () => ({summary: structuredClone(summary), auditEvents: []})
  };
  const receipt = () => ({
    runId: RUN_ID,
    sequence: ++sequence,
    hash: String(sequence).padStart(64, "0"),
    resultDigest: String(sequence + 10_000).padStart(64, "0")
  });
  const executionStep = {
    async authorizeEntry(input) {
      calls.push({method: "authorizeEntry", input});
      if (authorizeUnknown) return {status: "UNKNOWN"};
      const filterResult = filterCandidate(input.candidate, {now: input.now, holdUntil: END});
      const scoreResult = analyzeCandidate(input.candidate, {
        now: input.now,
        filterResult,
        smartWalletAllowlist: input.smartWalletAllowlist
      });
      if (!filterResult.accepted || scoreResult.status !== "PASS") {
        return {status: "BLOCKED", filterResult, scoreResult};
      }
      return {
        status: "AUTHORIZED",
        authorizationId: "auth-test",
        authorizedAt: new Date(input.now).toISOString(),
        executionMode: "SIMULATED_ONLY",
        executionRealistic: false,
        receipt: receipt()
      };
    },
    async executeEntry(input) {
      calls.push({method: "executeEntry", input});
      summary.openPositions.push({mint: input.quote.mint});
      summary.reservedPositions = 0;
      summary.costs.entry = {feeCents: "2", spreadCents: "1", slippageCents: "1",
        priceImpactCents: "1", networkCents: "2"};
      return {status: "FILLED_PAPER", receipt: receipt()};
    },
    async observeExitQuote(input) {
      calls.push({method: "observeExitQuote", input});
      if (input.quote.priceMicros <= 9_400) {
        summary.openPositions = summary.openPositions.filter(position => position.mint !== input.quote.mint);
        return {status: "FILLED_PAPER", receipt: receipt()};
      }
      return {status: "MARKED", receipt: receipt()};
    },
    async riskSnapshot(input) {
      calls.push({method: "riskSnapshot", input});
      if (authorizeUnknown) return {status: "UNKNOWN"};
      if (riskUnacknowledged) return {status: "REJECT"};
      if (riskLedgerUnknown) return {status: "UNKNOWN", receipt: receipt()};
      if (closeOnRiskSnapshot) summary.openPositions = [];
      return {status: "PASS", receipt: receipt()};
    },
    async finishRun(input) {
      calls.push({method: "finishRun", input});
      if (finishReject) return {status: "REJECT", reason: "pre-dispatch capacity rejection"};
      return {status: "FINISHED", receipt: receipt()};
    }
  };
  return {calls, executionStep, session, summary};
}

function makeRunner({
  candidate = syntheticCandidate(START),
  sourcePoll,
  quote,
  clock,
  stopSource = () => false,
  limits,
  harnessOptions
} = {}) {
  const system = harness(harnessOptions);
  let defaultTime = START;
  let candidateSent = false;
  const runner = createPaperExecutionRunner({
    ...system,
    runId: RUN_ID,
    startedAt: START,
    endAt: END,
    executionMode: "SIMULATED_ONLY",
    provenance: SYNTHETIC_SOURCE,
    candidateSource: {
      poll: sourcePoll ?? (async () => {
        if (candidateSent) return {done: true};
        candidateSent = true;
        return {candidate};
      })
    },
    quoteSource: quote ?? (async ({purpose, candidate: selected, now}) => ({
      source: SYNTHETIC_SOURCE,
      fixtureOnly: true,
      chainId: selected.chainId,
      mint: selected.mint,
      pool: selected.pool,
      quote: selected.quote,
      decimals: selected.decimals,
      observedAt: now,
      priceMicros: purpose === "ENTRY" ? 10_000 : 9_000,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
    })),
    clock: clock ?? (() => (defaultTime += 1_000)),
    stopSource,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST,
    limits
  });
  return {...system, runner};
}

function quoteFixture(candidate, purpose, observedAt) {
  return {
    source: SYNTHETIC_SOURCE,
    fixtureOnly: true,
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote,
    decimals: candidate.decimals,
    observedAt,
    priceMicros: purpose === "ENTRY" ? 10_000 : 9_000,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
  };
}

async function makeRealRunner(t, {
  runId = RUN_ID,
  candidateSource = {poll: async () => ({done: true})},
  quoteSource = async () => null,
  clock = () => START + 1_000,
  stopSource = () => false,
  stepLimits,
  runnerLimits,
  wrapRunnerSession = session => session,
  wrapExecutionStep = executionStep => executionStep
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-runner-review-"));
  const store = await CheckpointStore.open(directory);
  const session = await PaperCheckpointSession.open({store, runId, startedAt: START});
  t.after(async () => {
    await session.close();
    await rm(directory, {recursive: true, force: true});
  });
  const executionStep = createPaperExecutionStep({
      session, store, runId, startedAt: START, endAt: END, limits: stepLimits
    });
  const runner = createPaperExecutionRunner({
    executionStep: wrapExecutionStep(executionStep),
    session: wrapRunnerSession(session),
    runId,
    startedAt: START,
    endAt: END,
    executionMode: "SIMULATED_ONLY",
    provenance: SYNTHETIC_SOURCE,
    candidateSource,
    quoteSource,
    clock,
    stopSource,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST,
    limits: runnerLimits
  });
  return {directory, runner, session, store};
}

test("offline lifecycle fills from a later synthetic quote and exits on a later risk-only pass", async () => {
  const {calls, runner, summary} = makeRunner();
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "SOURCES_EXHAUSTED");
  assert.equal(report.provenance, SYNTHETIC_SOURCE);
  assert.equal(report.realDataSourceCoverage, "NOT_ASSESSED");
  assert.equal(summary.openPositions.length, 0);
  assert.deepEqual(calls.map(call => call.method), [
    "riskSnapshot", "authorizeEntry", "executeEntry",
    "observeExitQuote", "riskSnapshot", "finishRun"
  ]);
  const authorization = calls.find(call => call.method === "authorizeEntry").input;
  const entry = calls.find(call => call.method === "executeEntry").input;
  assert.ok(entry.quote.observedAt > authorization.candidate.sampledAt);
  assert.ok(entry.quote.observedAt > Date.parse(new Date(authorization.now).toISOString()));
  assert.ok(Object.values(entry.quote.costs).some(amount => amount > 0));
  assert.ok(report.terminalReceipt);
  assert.equal(report.terminalReceipt.sequence, calls.length);
});

test("entry quote acquired during the source call is checked against response time", async () => {
  let clockTime = START;
  let requestTime;
  const {calls, runner} = makeRunner({
    clock: () => (clockTime += 1_000),
    quote: async ({purpose, candidate, now}) => {
      if (purpose === "ENTRY") {
        requestTime = now;
        clockTime = now + 1_000;
      }
      return quoteFixture(candidate, purpose, purpose === "ENTRY" ? now + 1_000 : now);
    }
  });
  const report = await runner.run();

  const authorization = calls.find(call => call.method === "authorizeEntry").input;
  const entry = calls.find(call => call.method === "executeEntry").input;
  assert.equal(report.status, "FINISHED");
  assert.ok(entry.quote.observedAt > requestTime);
  assert.ok(entry.quote.observedAt > authorization.now);
  assert.ok(entry.quote.observedAt <= entry.now);
});

test("exit quote acquired during the source call is checked against response time", async () => {
  let clockTime = START;
  let exitRequestTime;
  const {calls, runner, summary} = makeRunner({
    clock: () => (clockTime += 1_000),
    quote: async ({purpose, candidate, now}) => {
      if (purpose === "EXIT") {
        exitRequestTime = now;
        clockTime = now + 1_000;
        return quoteFixture(candidate, purpose, now + 1_000);
      }
      return quoteFixture(candidate, purpose, now);
    }
  });
  const report = await runner.run();

  const exit = calls.find(call => call.method === "observeExitQuote").input;
  assert.equal(report.status, "FINISHED");
  assert.equal(summary.openPositions.length, 0);
  assert.ok(exit.quote.observedAt > exitRequestTime);
  assert.ok(exit.quote.observedAt <= exit.now);
});

test("quotes genuinely ahead of their response clock are rejected for entry and exit", async () => {
  const entryRun = makeRunner({
    quote: async ({purpose, candidate, now}) =>
      quoteFixture(candidate, purpose, purpose === "ENTRY" ? now + 10_000 : now)
  });
  const entryReport = await entryRun.runner.run();
  assert.equal(entryReport.status, "FINISHED");
  assert.equal(entryRun.calls.some(call => call.method === "executeEntry"), false);
  assert.equal(entryReport.operationResults.find(item => item.method === "entryQuote")?.status, "BLOCKED");

  const exitRun = makeRunner({
    quote: async ({purpose, candidate, now}) =>
      quoteFixture(candidate, purpose, purpose === "EXIT" ? now + 10_000 : now)
  });
  const exitReport = await exitRun.runner.run();
  assert.equal(exitReport.status, "FINISHED");
  assert.equal(exitRun.calls.some(call => call.method === "observeExitQuote"), false);
  assert.equal(exitReport.summary.openPositions.length, 1);
});

test("offline demo durably reads back costs, stop exit, and terminal result", async () => {
  const report = await runOfflineDemo();
  let store;
  try {
    assert.equal(report.status, "FINISHED");
    assert.equal(report.reason, "SOURCES_EXHAUSTED");
    assert.equal(report.executionMode, "SIMULATED_ONLY");
    assert.equal(report.provenance, SYNTHETIC_SOURCE);
    assert.equal(report.realDataSourceCoverage, "NOT_ASSESSED");
    assert.ok(report.operationResults.some(item => item.status === "FILLED_PAPER"));
    assert.ok(report.operationResults.some(item => item.status === "CLOSED_PAPER"));
    assert.equal(report.summary.openPositions.length, 0);
    for (const kind of ["entry", "exit"]) {
      const costs = report.summary.costs[kind];
      assert.ok(costs);
      assert.ok(Object.values(costs).reduce((sum, amount) => sum + BigInt(amount), 0n) > 0n);
    }

    store = await CheckpointStore.open(report.checkpointDirectory);
    const readback = await store.readCheckpoint();
    assert.equal(readback.status, "OK");
    const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
    const finalRecord = checkpoint.records.at(-1);
    const receipt = report.terminalReceipt;
    assert.equal(readback.sequence, receipt.sequence);
    assert.equal(readback.hash, receipt.hash);
    assert.equal(checkpoint.sequence, receipt.sequence);
    assert.equal(finalRecord.method, "finishRun");
    assert.equal(finalRecord.commandId, report.terminalResult.commandId);
    assert.equal(finalRecord.resultDigest, report.terminalResult.receipt.resultDigest);
    assert.deepEqual(report.durableReadback, {
      status: "OK",
      sequence: readback.sequence,
      hash: readback.hash,
      method: finalRecord.method,
      commandId: finalRecord.commandId,
      resultDigest: finalRecord.resultDigest
    });
    const entryRecord = checkpoint.records.find(record => record.method === "executeEntry");
    const exitRecord = checkpoint.records.find(record => record.method === "observeExitQuote");
    for (const record of [entryRecord, exitRecord]) {
      assert.ok(record);
      assert.ok(Object.values(record.inputs.quote.costs)
        .reduce((sum, amount) => sum + BigInt(amount), 0n) > 0n);
    }
  } finally {
    await store?.close();
    await rm(report.checkpointDirectory, {recursive: true, force: true});
  }
});

test("missing hard-filter or analyst evidence blocks entry", async () => {
  for (const [group, key] of [["evidence", "lpProtection"], ["analystEvidence", "momentum15m"]]) {
    const candidate = syntheticCandidate(START);
    delete candidate[group][key];
    const {calls, runner} = makeRunner({candidate});
    const report = await runner.run();

    assert.equal(report.status, "FINISHED");
    assert.equal(calls.some(call => call.method === "executeEntry"), false);
    assert.deepEqual(calls.find(call => call.method === "authorizeEntry")?.input.candidate, candidate);
    assert.equal(report.operationResults.find(item => item.method === "authorizeEntry")?.status, "BLOCKED");
  }
});

test("an open position is risk-managed when the candidate source is exhausted", async () => {
  let polls = 0;
  const {calls, runner} = makeRunner({
    sourcePoll: async () => (++polls === 1 ? {candidate: syntheticCandidate(START)} : {done: true})
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(polls, 2);
  assert.ok(calls.findIndex(call => call.method === "observeExitQuote") >
    calls.findIndex(call => call.method === "executeEntry"));
  assert.equal(calls.filter(call => call.method === "observeExitQuote").length, 1);
});

test("checkpoint uncertainty latches and suppresses all later work", async () => {
  const {calls, runner} = makeRunner({harnessOptions: {authorizeUnknown: true}});
  const report = await runner.run();
  const replay = await runner.run();

  assert.equal(report.status, "UNKNOWN");
  assert.equal(replay.status, "UNKNOWN");
  assert.deepEqual(calls.map(call => call.method), ["riskSnapshot"]);
  assert.equal(report.terminalReceipt, null);
});

test("risk work without a durable acknowledgement blocks candidate authorization", async () => {
  const {calls, runner} = makeRunner({harnessOptions: {riskUnacknowledged: true}});
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "RISK_OPERATION_UNAVAILABLE");
  assert.deepEqual(calls.map(call => call.method), ["riskSnapshot", "finishRun"]);
});

test("only explicit pre-dispatch finish rejection stops without a terminal receipt", async () => {
  const {calls, runner} = makeRunner({
    stopSource: () => true,
    limits: {maxOperations: 2},
    harnessOptions: {finishReject: true}
  });
  const report = await runner.run();

  assert.equal(report.status, "STOPPED");
  assert.equal(report.terminalReceipt, null);
  assert.equal(report.counters.operations, 2);
  assert.deepEqual(calls.map(call => call.method), ["riskSnapshot", "finishRun"]);
});

test("committed ledger UNKNOWN propagates with its receipt and does not retry", async () => {
  const {calls, runner} = makeRunner({harnessOptions: {riskLedgerUnknown: true}});
  const report = await runner.run();

  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(calls.map(call => call.method), ["riskSnapshot", "finishRun"]);
  assert.deepEqual(report.receipts.map(item => item.sequence), [1, 2]);
  assert.equal(report.operationResults[0].status, "UNKNOWN");
});

test("deadline stops candidate and risk work and records only explicit finish", async () => {
  const {calls, runner} = makeRunner({clock: () => END});
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.deepEqual(calls.map(call => call.method), ["finishRun"]);
  assert.equal(calls[0].input.now, END);
});

test("shutdown evaluates current risk and then finishes explicitly", async () => {
  const {calls, runner} = makeRunner({stopSource: () => true});
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "SHUTDOWN");
  assert.deepEqual(calls.map(call => call.method), ["riskSnapshot", "finishRun"]);
});

test("shutdown finish omits terminal marks and reports open positions unvalued", async () => {
  let time = START;
  const {calls, runner} = makeRunner({
    quote: async ({candidate, now}) => ({
      source: SYNTHETIC_SOURCE,
      fixtureOnly: true,
      chainId: candidate.chainId,
      mint: candidate.mint,
      pool: candidate.pool,
      quote: candidate.quote,
      decimals: candidate.decimals,
      observedAt: now,
      priceMicros: 10_000,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
    }),
    clock: () => (time += 1_000),
    stopSource: ({tick}) => tick > 0
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  const finish = calls.find(call => call.method === "finishRun");
  assert.deepEqual(finish.input.marks, []);
  assert.deepEqual(report.missingTerminalValuationMints, [syntheticCandidate(START).mint]);
  assert.equal(report.summary.openPositions.length, 1);
});

test("finish drops marks for positions closed by the independent risk snapshot", async () => {
  const {calls, runner} = makeRunner({
    harnessOptions: {closeOnRiskSnapshot: true},
    quote: async ({candidate, now}) => ({
      source: SYNTHETIC_SOURCE,
      fixtureOnly: true,
      chainId: candidate.chainId,
      mint: candidate.mint,
      pool: candidate.pool,
      quote: candidate.quote,
      decimals: candidate.decimals,
      observedAt: now,
      priceMicros: 10_000,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
    })
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(calls.find(call => call.method === "finishRun").input.marks.length, 0);
});

test("risk work reaching the deadline prevents a candidate-source poll", async () => {
  let polls = 0;
  const times = [START + 1, START + 2, END, END];
  const {calls, runner} = makeRunner({
    clock: () => times.shift() ?? END,
    sourcePoll: async () => {
      polls += 1;
      return {candidate: syntheticCandidate(START)};
    }
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(polls, 0);
  assert.deepEqual(calls.map(call => call.method), ["finishRun"]);
});

test("candidate input byte budget is enforced before entry dispatch", async () => {
  let polls = 0;
  const {calls, runner} = makeRunner({
    sourcePoll: async () => {
      polls += 1;
      return {candidate: syntheticCandidate(START)};
    },
    limits: {maxInputBytes: 256}
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "INPUT_BUDGET");
  assert.equal(polls, 1);
  assert.equal(calls.some(call => call.method === "authorizeEntry"), false);
});

test("repeated 256 KiB strings are rejected by cumulative byte accounting", async () => {
  const repeated = "x".repeat(262_144);
  const {calls, runner} = makeRunner({
    sourcePoll: async () => ({candidate: syntheticCandidate(START), repeated: Array(4).fill(repeated)}),
    limits: {maxInputBytes: 128 * 1024}
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "INPUT_BUDGET");
  assert.equal(calls.some(call => call.method === "authorizeEntry"), false);
});

async function runRealDailyLossScenario(t, {futureRiskQuote = false} = {}) {
  const mints = [
    "So11111111111111111111111111111111111111112",
    `${"1".repeat(31)}2`,
    `${"1".repeat(31)}3`
  ];
  const candidates = mints.map(mint => {
    const candidate = syntheticCandidate(START, {mint});
    for (const evidence of [...Object.values(candidate.evidence), ...Object.values(candidate.analystEvidence)]) {
      evidence.binding.mint = mint;
    }
    return candidate;
  });
  let candidateIndex = 0;
  let clockTime = START;
  const quoteCounts = new Map();
  const riskExitQuotes = [];
  const {runner, store} = await makeRealRunner(t, {
    runId: "runner-daily-loss-review",
    candidateSource: {
      poll: async () => candidateIndex < candidates.length
        ? {candidate: candidates[candidateIndex++]}
        : {done: true}
    },
    quoteSource: async ({candidate, now, purpose}) => {
      const count = quoteCounts.get(candidate.mint) ?? 0;
      quoteCounts.set(candidate.mint, count + 1);
      const gap = purpose === "EXIT" && candidateIndex === candidates.length &&
        candidate.mint === mints[0] && count >= 2;
      const riskExit = purpose === "RISK_EXIT";
      if (riskExit) clockTime = now + 1_000;
      const observedAt = riskExit
        ? now + (futureRiskQuote && candidate.mint === mints[2] ? 3_000 : 1_000)
        : now;
      if (riskExit) riskExitQuotes.push({mint: candidate.mint, requestAt: now, observedAt});
      return {
        source: SYNTHETIC_SOURCE,
        fixtureOnly: true,
        chainId: candidate.chainId,
        mint: candidate.mint,
        pool: candidate.pool,
        quote: candidate.quote,
        decimals: candidate.decimals,
        observedAt,
        priceMicros: gap ? 1_000 : 10_000,
        mode: "HYPOTHETICAL",
        executable: true,
        costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
      };
    },
    clock: () => (clockTime += 1_000)
  });
  const report = await runner.run();
  return {report, store, mints, riskExitQuotes};
}

test("real checkpoint daily-loss exit validates fresh RISK_EXIT response time and durably closes survivors", async t => {
  const {report, store, mints, riskExitQuotes} = await runRealDailyLossScenario(t);
  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "DAILY_LOSS_LIMIT");
  assert.equal(report.summary.openPositions.length, 0);
  assert.equal(report.operationResults.filter(item => item.method === "executeEntry" &&
    item.status === "FILLED_PAPER").length, 3);
  assert.equal(report.operationResults.some(item => item.method === "observeExitQuote" &&
    item.status === "CLOSED_PAPER"), true);
  assert.ok(Object.values(report.summary.costs.entry)
    .reduce((sum, amount) => sum + BigInt(amount), 0n) > 0n);
  assert.ok(Object.values(report.summary.costs.exit)
    .reduce((sum, amount) => sum + BigInt(amount), 0n) > 0n);

  const readback = await store.readCheckpoint();
  assert.equal(readback.status, "OK");
  const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
  assert.equal(checkpoint.records.at(-1).method, "finishRun");
  assert.equal(readback.sequence, report.terminalReceipt.sequence);
  assert.equal(readback.hash, report.terminalReceipt.hash);
  assert.equal(riskExitQuotes.length, 2);
  for (const quote of riskExitQuotes) {
    assert.ok(quote.observedAt > quote.requestAt);
    assert.ok(quote.observedAt <= quote.requestAt + 2_000);
  }
  const lastObservations = new Map();
  for (const record of checkpoint.records.filter(item => item.method === "observeExitQuote")) {
    const quote = record.inputs.quote;
    lastObservations.set(quote.mint, Math.max(lastObservations.get(quote.mint) ?? 0, quote.observedAt));
  }
  const refreshedRisk = checkpoint.records.filter(item => item.method === "riskSnapshot")
    .findLast(record => record.inputs.marks.some(mark => mark.mint === mints[1] || mark.mint === mints[2]));
  assert.ok(refreshedRisk);
  for (const mint of mints.slice(1)) {
    const mark = refreshedRisk.inputs.marks.find(item => item.mint === mint);
    assert.ok(mark.observedAt > lastObservations.get(mint));
  }
});

test("real checkpoint daily-loss exit rejects a RISK_EXIT quote future of its response clock", async t => {
  const {report, store, mints, riskExitQuotes} = await runRealDailyLossScenario(t, {
    futureRiskQuote: true
  });
  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "DAILY_LOSS_LIMIT");
  assert.equal(report.summary.openPositions.length, 2);
  const futureQuote = riskExitQuotes.find(quote => quote.mint === mints[2]);
  assert.ok(futureQuote);
  assert.ok(futureQuote.observedAt > futureQuote.requestAt + 2_000);

  const readback = await store.readCheckpoint();
  assert.equal(readback.status, "OK");
  const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
  assert.equal(checkpoint.records.at(-1).method, "finishRun");
  const validQuote = riskExitQuotes.find(quote => quote.mint === mints[1]);
  const riskMarks = checkpoint.records.filter(item => item.method === "riskSnapshot")
    .flatMap(item => item.inputs.marks);
  assert.equal(riskMarks.some(mark =>
    mark.mint === mints[1] && mark.observedAt === validQuote.observedAt), false);
});

test("tight-budget shutdown durably finishes without fabricated terminal valuation", async t => {
  const runId = "runner-tight-shutdown-review";
  const candidate = syntheticCandidate(START);
  let clockTime = START;
  const quoteSource = async ({candidate: selected, now}) => ({
    source: SYNTHETIC_SOURCE,
    fixtureOnly: true,
    chainId: selected.chainId,
    mint: selected.mint,
    pool: selected.pool,
    quote: selected.quote,
    decimals: selected.decimals,
    observedAt: now,
    priceMicros: 10_000,
    mode: "HYPOTHETICAL",
    executable: true,
    costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
  });
  const runOptions = () => {
    let candidateSent = false;
    clockTime = START;
    return {
      runId,
      candidateSource: {
        poll: async () => candidateSent ? {done: true} : (candidateSent = true, {candidate})
      },
      clock: () => (clockTime += 1_000),
      stopSource: ({tick}) => tick >= 1,
      quoteSource
    };
  };
  const baseline = await makeRealRunner(t, runOptions());
  const baselineReport = await baseline.runner.run();
  assert.equal(baselineReport.status, "FINISHED");
  assert.equal(baselineReport.reason, "SHUTDOWN");
  const baselineReadback = await baseline.store.readCheckpoint();
  const baselineCheckpoint = JSON.parse(baselineReadback.bytes.toString("utf8"));
  const finalRecord = baselineCheckpoint.records.at(-1);
  assert.equal(finalRecord.method, "finishRun");
  assert.deepEqual(finalRecord.inputs.marks, []);
  const riskMarks = baselineCheckpoint.records.findLast(record =>
    record.method === "riskSnapshot" && record.inputs.marks.length)?.inputs.marks;
  assert.ok(riskMarks?.length);
  const markedFinishCheckpoint = {
    ...baselineCheckpoint,
    records: [
      ...baselineCheckpoint.records.slice(0, -1),
      {...finalRecord, inputs: {...finalRecord.inputs, marks: riskMarks}}
    ]
  };
  const maxBytes = canonicalCheckpointBytes(baselineCheckpoint).length + 64;
  assert.ok(maxBytes < canonicalCheckpointBytes(markedFinishCheckpoint).length);

  const finishAttempts = [];
  const constrained = await makeRealRunner(t, {
    ...runOptions(),
    stepLimits: {maxBytes, maxEvents: 5},
    runnerLimits: {maxOperations: 6},
    wrapExecutionStep: executionStep => ({
      ...executionStep,
      finishRun(input) {
        finishAttempts.push(structuredClone(input));
        return executionStep.finishRun(input);
      }
    })
  });
  const report = await constrained.runner.run();
  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "SHUTDOWN");
  assert.deepEqual(report.missingTerminalValuationMints, [candidate.mint]);
  assert.equal(report.summary.openPositions.length, 1);
  assert.equal(report.counters.operations, 6);
  assert.equal(finishAttempts.length, 1);
  assert.deepEqual(finishAttempts[0].marks, []);

  const readback = await constrained.store.readCheckpoint();
  assert.equal(readback.status, "OK");
  const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
  const finish = checkpoint.records.at(-1);
  assert.equal(finish.method, "finishRun");
  assert.deepEqual(finish.inputs.marks, []);
  assert.equal(readback.sequence, report.terminalReceipt.sequence);
  assert.equal(readback.hash, report.terminalReceipt.hash);
  assert.equal(checkpoint.records.filter(record => record.method === "finishRun").length, 1);
});

test("a corrupt post-commit terminal receipt latches UNKNOWN without retry", async t => {
  const finishAttempts = [];
  const {runner, store} = await makeRealRunner(t, {
    runId: "runner-corrupt-finish-review",
    wrapExecutionStep: executionStep => ({
      ...executionStep,
      async finishRun(input) {
        finishAttempts.push(structuredClone(input));
        const result = await executionStep.finishRun(input);
        return {...result, receipt: {...result.receipt, hash: "f".repeat(64)}};
      }
    })
  });
  const report = await runner.run();

  assert.equal(report.status, "UNKNOWN");
  assert.equal(report.terminalReceipt, null);
  assert.equal(finishAttempts.length, 1);
  assert.equal(report.counters.operations, 2);
  assert.deepEqual(report.receipts.map(receipt => receipt.sequence), [1]);
  const readback = await store.readCheckpoint();
  assert.equal(readback.status, "OK");
  assert.equal(JSON.parse(readback.bytes.toString("utf8")).records.at(-1).method, "finishRun");
});

test("real checkpoint UNKNOWN after an intermediate acknowledgement has no terminal receipt", async t => {
  let snapshots = 0;
  const {runner, store} = await makeRealRunner(t, {
    runId: "runner-unknown-review",
    wrapRunnerSession: session => ({
      metadata: session.metadata,
      snapshot() {
        snapshots += 1;
        if (snapshots === 2) throw new Error("session readback unavailable");
        return session.snapshot();
      }
    })
  });
  const report = await runner.run();

  assert.equal(report.status, "UNKNOWN");
  assert.deepEqual(report.receipts.map(receipt => receipt.sequence), [1]);
  assert.equal(report.terminalReceipt, null);
  const readback = await store.readCheckpoint();
  assert.equal(readback.status, "OK");
  assert.equal(JSON.parse(readback.bytes.toString("utf8")).records.at(-1).method, "riskSnapshot");
});

test("real checkpoint clock stop preserves intermediate acknowledgement but no terminal receipt", async t => {
  let clockReads = 0;
  const {runner, store} = await makeRealRunner(t, {
    runId: "runner-clock-stop-review",
    clock: () => (++clockReads <= 4 ? START + clockReads * 1_000 : Number.NaN)
  });
  const report = await runner.run();

  assert.equal(report.status, "STOPPED");
  assert.deepEqual(report.receipts.map(receipt => receipt.sequence), [1]);
  assert.equal(report.terminalReceipt, null);
  const readback = await store.readCheckpoint();
  assert.equal(readback.status, "OK");
  assert.equal(JSON.parse(readback.bytes.toString("utf8")).records.at(-1).method, "riskSnapshot");
});

test("shutdown requested during candidate polling blocks authorization", async () => {
  let stopping = false;
  const {calls, runner} = makeRunner({
    sourcePoll: async () => {
      stopping = true;
      return {candidate: syntheticCandidate(START)};
    },
    stopSource: () => stopping
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "SHUTDOWN");
  assert.equal(calls.some(call => call.method === "authorizeEntry"), false);
});

test("shutdown requested during quote acquisition blocks entry dispatch", async () => {
  let stopping = false;
  const {calls, runner} = makeRunner({
    quote: async ({purpose, candidate, now}) => {
      if (purpose === "ENTRY") stopping = true;
      return {
        source: SYNTHETIC_SOURCE,
        fixtureOnly: true,
        chainId: candidate.chainId,
        mint: candidate.mint,
        pool: candidate.pool,
        quote: candidate.quote,
        decimals: candidate.decimals,
        observedAt: now,
        priceMicros: purpose === "ENTRY" ? 10_000 : 9_000,
        mode: "HYPOTHETICAL",
        executable: true,
        costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1, networkCents: 2}
      };
    },
    stopSource: () => stopping
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "SHUTDOWN");
  assert.equal(calls.some(call => call.method === "executeEntry"), false);
});

test("incomplete synthetic quote costs block entry execution", async () => {
  const {calls, runner} = makeRunner({
    quote: async ({purpose, candidate, now}) => ({
      source: SYNTHETIC_SOURCE,
      fixtureOnly: true,
      chainId: candidate.chainId,
      mint: candidate.mint,
      pool: candidate.pool,
      quote: candidate.quote,
      decimals: candidate.decimals,
      observedAt: now,
      priceMicros: purpose === "ENTRY" ? 10_000 : 9_000,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {feeCents: 2, spreadCents: 1, slippageCents: 1, priceImpactCents: 1}
    })
  });
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(calls.some(call => call.method === "executeEntry"), false);
  assert.equal(report.operationResults.find(item => item.method === "entryQuote")?.status, "BLOCKED");
});

test("accessor-bearing source data is rejected without invoking accessors", async () => {
  let getterCalled = false;
  const response = {};
  Object.defineProperty(response, "candidate", {
    enumerable: true,
    get() {
      getterCalled = true;
      return syntheticCandidate(START);
    }
  });
  const {calls, runner} = makeRunner({sourcePoll: async () => response});
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
  assert.equal(report.reason, "INVALID_CANDIDATE_SOURCE_ITEM");
  assert.equal(getterCalled, false);
  assert.equal(calls.some(call => call.method === "authorizeEntry"), false);
});

test("run is idempotent and cannot replay a simulated fill", async () => {
  const {calls, runner} = makeRunner();
  const first = runner.run();
  const replay = runner.run();
  assert.equal(first, replay);
  const [result, repeated] = await Promise.all([first, replay]);

  assert.equal(result.status, "FINISHED");
  assert.equal(repeated.status, "FINISHED");
  assert.equal(calls.filter(call => call.method === "executeEntry").length, 1);
});

test("runtime mode and fixture provenance are explicit fail-closed requirements", () => {
  const system = harness();
  const config = {
    ...system,
    runId: RUN_ID,
    startedAt: START,
    endAt: END,
    executionMode: "SIMULATED_ONLY",
    provenance: SYNTHETIC_SOURCE,
    candidateSource: {poll: async () => ({done: true})},
    quoteSource: async () => null,
    clock: () => START,
    stopSource: () => false,
    smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST
  };
  assert.throws(() => createPaperExecutionRunner({...config, executionMode: "READ_ONLY_PAPER"}),
    /explicit synthetic PAPER mode/);
  assert.throws(() => createPaperExecutionRunner({...config, smartWalletAllowlist: undefined}),
    /explicit synthetic PAPER mode/);
  assert.throws(() => createPaperExecutionRunner({...config, provenance: "UNVERIFIED"}),
    /explicit synthetic PAPER mode/);
});
