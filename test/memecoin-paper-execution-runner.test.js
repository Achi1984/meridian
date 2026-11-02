import assert from "node:assert/strict";
import test from "node:test";
import {createPaperExecutionRunner} from "../scripts/memecoin-paper/execution-runner.mjs";
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
  closeOnRiskSnapshot = false
} = {}) {
  const calls = [];
  let sequence = 0;
  const summary = {
    runId: RUN_ID,
    openPositions: [],
    reservedPositions: 0,
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

test("offline lifecycle fills from a later synthetic quote and exits on a later risk-only pass", async () => {
  const {calls, runner, summary} = makeRunner();
  const report = await runner.run();

  assert.equal(report.status, "FINISHED");
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

test("shutdown finish carries a still-fresh risk mark", async () => {
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
  assert.equal(finish.input.marks.length, 1);
  assert.ok(finish.input.marks[0].observedAt <= finish.input.now);
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
