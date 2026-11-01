import test from "node:test";
import assert from "node:assert/strict";
import {
  createPilotIntegration,
  SYNTHETIC_TEST_ONLY
} from "../scripts/memecoin-paper/pilot-integration.mjs";
import {
  createCheckpoint,
  createPilotFixture,
  createReportInput,
  SYNTHETIC_DIGEST,
  SYNTHETIC_HASH,
  SYNTHETIC_RUN_ID,
  SYNTHETIC_START
} from "./fixtures/memecoin-paper-pilot-integration/generate.mjs";

function makeControlFactory() {
  let callbacks;
  let budget;
  let stopping = false;
  let abortController;
  let cached;
  const control = {
    async start() {
      if (cached) return cached;
      abortController = new AbortController();
      const counts = {requests: 0, events: 0, cycles: 0, completedSteps: 0};
      let acknowledgement = {status: "NOT_ATTEMPTED"};
      let positionEvidence = {status: "UNKNOWN", unresolvedPositions: null, lastKnown: null};
      let status = "FINISHED";
      for (let cycleIndex = 0; cycleIndex < budget.cycles && !stopping; cycleIndex += 1) {
        counts.cycles += 1;
        let acquisition;
        try {
          acquisition = await callbacks.acquire({
            cycleIndex,
            remainingRequests: budget.requests - counts.requests,
            remainingEvents: budget.events - counts.events,
            deadlineAtMonotonicMs: 1_000,
            signal: abortController.signal
          });
        } catch {
          status = "UNKNOWN";
          break;
        }
        counts.requests += acquisition.requestsUsed;
        for (let eventIndex = 0; eventIndex < acquisition.events.length; eventIndex += 1) {
          if (stopping) {
            status = "UNKNOWN";
            break;
          }
          const event = acquisition.events[eventIndex];
          counts.events += 1;
          if (positionEvidence.status === "SUPPLIED") {
            positionEvidence = {
              status: "UNKNOWN",
              unresolvedPositions: null,
              lastKnown: {...positionEvidence.lastKnown, status: "STALE"}
            };
          }
          try {
            const result = await callbacks.step({
              cycleIndex,
              eventIndex,
              event,
              signal: abortController.signal
            });
            counts.completedSteps += 1;
            if (Array.isArray(result?.unresolvedPositions)) {
              const prior = positionEvidence.lastKnown;
              positionEvidence = {
                status: "SUPPLIED",
                unresolvedPositions: result.unresolvedPositions,
                lastKnown: {status: "LAST_KNOWN", sourceStep: counts.completedSteps,
                  prior: prior?.status === "STALE" ? prior : undefined}
              };
            } else if (positionEvidence.lastKnown) {
              positionEvidence = {
                status: "UNKNOWN",
                unresolvedPositions: null,
                lastKnown: {...positionEvidence.lastKnown, status: "STALE"}
              };
            }
          } catch {
            status = "UNKNOWN";
            break;
          }
        }
        if (stopping || status === "UNKNOWN") {
          status = "UNKNOWN";
          break;
        }
        try {
          acknowledgement = await callbacks.checkpoint({
            cycleIndex,
            eventCount: counts.events,
            completedSteps: counts.completedSteps,
            unresolvedPositions: positionEvidence.status === "SUPPLIED"
              ? positionEvidence.unresolvedPositions : null,
            positionEvidenceStatus: positionEvidence.status,
            lastKnownPositionEvidence: positionEvidence.lastKnown,
            signal: abortController.signal
          });
        } catch {
          acknowledgement = {status: "UNKNOWN"};
        }
        if (acknowledgement.status !== "ACKNOWLEDGED") {
          status = "UNKNOWN";
          break;
        }
        if (acquisition.done || counts.requests >= budget.requests ||
            counts.events >= budget.events) break;
      }
      if (stopping) status = "UNKNOWN";
      const summary = {
        status,
        state: status,
        mode: SYNTHETIC_TEST_ONLY,
        executionStarted: false,
        counts,
        checkpointAcknowledgement: acknowledgement,
        positionEvidence,
        reportStatus: "NOT_EMITTED"
      };
      let reportStatus = "EMITTED";
      try {
        await callbacks.report({summary, signal: abortController.signal});
      } catch {
        reportStatus = "FAILED";
      }
      cached = {...summary, reportStatus};
      return cached;
    },
    stop() {
      if (stopping) return false;
      stopping = true;
      abortController?.abort("OPERATOR_STOP");
      return true;
    },
    snapshot() {
      return cached ?? {state: "CREATED"};
    }
  };
  const factory = options => {
    callbacks = options.callbacks;
    budget = options.budgets;
    return control;
  };
  factory.control = control;
  return factory;
}

function makeEnvironment({
  providerResults,
  candidateCount = 1,
  filterStatus = "PASS",
  step,
  readbackStatus = "OK",
  reportInput,
  runId = SYNTHETIC_RUN_ID,
  sequence = 1,
  hash = SYNTHETIC_HASH,
  budgets
} = {}) {
  const fixture = createPilotFixture({candidateCount});
  const receipt = {
    runId,
    sequence,
    commandId: "synthetic-command-1",
    method: "executeEntry",
    resultDigest: SYNTHETIC_DIGEST
  };
  const checkpoint = createCheckpoint({runId, sequence, hash, receipt});
  const state = {
    metadata: checkpoint.metadata,
    readback: {...checkpoint.readback, status: readbackStatus}
  };
  const counters = {providerCalls: 0, readbackCalls: 0, steps: 0, reportCalls: 0};
  const projectedInputs = [];
  const controlFactory = makeControlFactory();
  const options = {
    mode: SYNTHETIC_TEST_ONLY,
    createPilotRunControl: controlFactory,
    acquireProviderEvidence: async () => {
      counters.providerCalls += 1;
      if (providerResults) return providerResults[counters.providerCalls - 1] ?? fixture.providerResult;
      return fixture.providerResult;
    },
    providerOptions: {
      manifest: fixture.manifest,
      enabled: false,
      candidates: fixture.requested,
      transport: async () => { throw new Error("offline fixture transport must not run"); },
      clock: () => SYNTHETIC_START + 1_000,
      freshnessPolicy: {maxAgeMs: 300_000}
    },
    filterCandidate: async candidate => ({
      status: filterStatus,
      accepted: filterStatus === "PASS",
      identity: {
        chainId: candidate.chainId,
        mint: candidate.mint,
        pool: candidate.pool,
        quote: candidate.quote
      }
    }),
    step: async input => {
      counters.steps += 1;
      if (step) return step(input, {fixture, state, receipt, reportInput, counters});
      const currentReceipt = {...receipt};
      const currentInput = reportInput ?? createReportInput({
        runId,
        sequence,
        hash,
        receipt: currentReceipt
      });
      return {
        unresolvedPositions: [],
        receipt: currentReceipt,
        operatorReportInput: currentInput
      };
    },
    checkpointStore: {
      async readCheckpoint() {
        counters.readbackCalls += 1;
        return state.readback;
      }
    },
    checkpointSession: {
      get metadata() { return state.metadata; },
      snapshot() {
        return {summary: {runId}, auditEvents: []};
      }
    },
    projectOperatorReport: async input => {
      counters.reportCalls += 1;
      projectedInputs.push(input);
      return {schema: "SYNTHETIC_OPERATOR_REPORT"};
    },
    runId: SYNTHETIC_RUN_ID,
    startedAt: SYNTHETIC_START,
    holdUntil: SYNTHETIC_START + 28_800_000,
    clock: () => 0,
    scheduler: {setTimeout: () => 1, clearTimeout: () => {}},
    budgets: {
      requests: 3,
      events: 10,
      cycles: 1,
      durationMs: 60_000,
      pollIntervalMs: 30_000,
      callbackSettlementMs: 1_000,
      ...budgets
    }
  };
  return {fixture, options, state, counters, projectedInputs, controlFactory};
}

test("disabled by default and invokes no injected callback", async () => {
  const disabled = createPilotIntegration();
  assert.deepEqual(await disabled.start(), {
    status: "DISABLED",
    mode: "DISABLED",
    executionStarted: false,
    reason: "SYNTHETIC_TEST_ONLY mode was not explicitly selected"
  });
  assert.equal(disabled.stop(), false);
  let factoryCalls = 0;
  const withInjectedFactory = createPilotIntegration({
    createPilotRunControl: () => { factoryCalls += 1; }
  });
  await withInjectedFactory.start();
  assert.equal(factoryCalls, 0);
  assert.throws(() => createPilotIntegration({mode: "REAL"}), /only explicit SYNTHETIC_TEST_ONLY/);
});

test("bounded synthetic lifecycle filters acquisition output and reports only a bound durable result", async () => {
  const env = makeEnvironment();
  const integration = createPilotIntegration(env.options);
  const result = await integration.start();
  assert.equal(result.summary.status, "FINISHED");
  assert.deepEqual(result.providerAccounting, {
    requests: 1,
    bytes: 42,
    requestEvents: 1,
    candidates: 1,
    byProvider: {dex: 1, rpc: 0}
  });
  assert.equal(env.counters.steps, 1);
  assert.equal(env.counters.readbackCalls, 1);
  assert.equal(env.counters.reportCalls, 1);
  assert.equal(integration.providerAuditCount(), 1);
  assert.equal(env.projectedInputs[0].reportType, "SYNTHETIC_CHECKPOINT_ORCHESTRATION_ONLY");
  assert.notEqual(env.projectedInputs[0], result.summary);
  assert.equal(result.operatorReport.status, "PROJECTED");
  assert.equal(result.operatorReport.durableReceipt.sequence, 1);
  assert.notEqual(result.operatorReport, result.summary.checkpointAcknowledgement);
});

test("UNKNOWN hard evidence yields no step or entry callback", async () => {
  const env = makeEnvironment({filterStatus: "UNKNOWN", sequence: 0});
  const result = await createPilotIntegration(env.options).start();
  assert.equal(env.counters.steps, 0);
  assert.equal(env.counters.reportCalls, 1);
  assert.equal(result.summary.checkpointAcknowledgement.status, "ACKNOWLEDGED");
  assert.equal(result.operatorReport.status, "PROJECTED");
  assert.equal(env.projectedInputs[0].results.length, 0);
});

test("provider request, provider, byte, event, and candidate budgets accumulate across cycles", async () => {
  const env = makeEnvironment({
    budgets: {requests: 3, events: 10, cycles: 3}
  });
  env.options.providerOptions.manifest.pollBudget.maxRequestsPerProvider = 2;
  env.options.providerOptions.manifest.pollBudget.maxRequestsPerRun = 3;
  env.options.providerOptions.manifest.pollBudget.maxBytesPerRun = 300;
  env.options.providerOptions.manifest.pollBudget.maxEvents = 10;
  env.options.providerOptions.manifest.pollBudget.maxCandidates = 10;
  const emptyCandidates = {
    ...env.fixture.providerResult,
    candidates: [],
    counters: {requests: 1, bytes: 20, events: 1, reservedBytes: 0, byProvider: {dex: 1, rpc: 0}}
  };
  env.options.acquireProviderEvidence = async () => {
    env.counters.providerCalls += 1;
    return emptyCandidates;
  };
  const result = await createPilotIntegration(env.options).start();
  assert.equal(env.counters.providerCalls, 2);
  assert.deepEqual(result.providerAccounting, {
    requests: 2,
    bytes: 40,
    requestEvents: 2,
    candidates: 0,
    byProvider: {dex: 2, rpc: 0}
  });
});

test("lost checkpoint acknowledgement is UNKNOWN and never retried", async () => {
  const env = makeEnvironment({readbackStatus: "UNKNOWN"});
  const result = await createPilotIntegration(env.options).start();
  assert.equal(result.summary.status, "UNKNOWN");
  assert.equal(result.summary.checkpointAcknowledgement.status, "UNKNOWN");
  assert.equal(env.counters.steps, 1);
  assert.equal(env.counters.readbackCalls, 1);
  assert.equal(env.counters.reportCalls, 0);
  assert.equal(result.operatorReport.status, "BLOCKED");
});

test("controller stop is forwarded and an unsettled step is not checkpointed or retried", async () => {
  const env = makeEnvironment();
  let entered;
  let release;
  const stepEntered = new Promise(resolve => { entered = resolve; });
  const stepWait = new Promise(resolve => { release = resolve; });
  env.options.step = async () => {
    env.counters.steps += 1;
    entered();
    await stepWait;
    return {unresolvedPositions: []};
  };
  const integration = createPilotIntegration(env.options);
  const started = integration.start();
  await stepEntered;
  assert.equal(integration.stop(), true);
  release();
  const result = await started;
  assert.equal(result.summary.status, "UNKNOWN");
  assert.equal(env.counters.steps, 1);
  assert.equal(env.counters.readbackCalls, 0);
  assert.equal(env.counters.reportCalls, 0);
});

test("step settlement timeout is terminal and does not retry or checkpoint", async () => {
  const env = makeEnvironment();
  env.options.step = async () => {
    env.counters.steps += 1;
    const error = new Error("synthetic callback settlement timeout");
    error.code = "CALLBACK_SETTLEMENT_TIMEOUT";
    throw error;
  };
  const result = await createPilotIntegration(env.options).start();
  assert.equal(result.summary.status, "UNKNOWN");
  assert.equal(env.counters.steps, 1);
  assert.equal(env.counters.readbackCalls, 0);
  assert.equal(env.counters.reportCalls, 0);
});

test("latest step without current position evidence keeps prior positions stale", async () => {
  const env = makeEnvironment({candidateCount: 2, budgets: {events: 2}});
  env.fixture.providerResult.candidates = env.fixture.candidates;
  env.fixture.providerResult.counters = {
    requests: 1, bytes: 42, events: 1, reservedBytes: 0, byProvider: {dex: 1, rpc: 0}
  };
  env.options.acquireProviderEvidence = async () => env.fixture.providerResult;
  env.options.step = async () => {
    env.counters.steps += 1;
    if (env.counters.steps === 1) {
      return {
        unresolvedPositions: [{mint: "synthetic-mint-001", status: "OPEN"}],
        receipt: {
          runId: SYNTHETIC_RUN_ID,
          sequence: 1,
          commandId: "synthetic-command-1",
          method: "executeEntry",
          resultDigest: SYNTHETIC_DIGEST
        },
        operatorReportInput: createReportInput()
      };
    }
    return {};
  };
  const result = await createPilotIntegration(env.options).start();
  assert.equal(env.counters.steps, 2);
  assert.equal(result.summary.positionEvidence.status, "UNKNOWN");
  assert.equal(result.summary.positionEvidence.unresolvedPositions, null);
  assert.equal(result.summary.positionEvidence.lastKnown.status, "STALE");
  assert.equal(result.summary.checkpointAcknowledgement.status, "UNKNOWN");
});

test("mixed provider identity, receipt hash, run, or sequence cannot produce a report", async () => {
  const mismatch = makeEnvironment();
  mismatch.options.acquireProviderEvidence = async () => ({
    ...mismatch.fixture.providerResult,
    candidates: [{
      candidate: {...mismatch.fixture.candidates[0].candidate, pool: "synthetic-other-pool"},
      identityStatus: "UNKNOWN"
    }]
  });
  const providerResult = await createPilotIntegration(mismatch.options).start();
  assert.equal(providerResult.summary.status, "UNKNOWN");
  assert.equal(mismatch.counters.steps, 0);
  assert.equal(mismatch.counters.reportCalls, 0);

  const crossed = makeEnvironment({
    reportInput: createReportInput({runId: "another-run"}),
    hash: "c".repeat(64)
  });
  const receipt = {
    runId: SYNTHETIC_RUN_ID,
    sequence: 1,
    commandId: "synthetic-command-1",
    method: "executeEntry",
    resultDigest: SYNTHETIC_DIGEST
  };
  const crossedCheckpoint = createCheckpoint({receipt, hash: "d".repeat(64)});
  crossed.state.readback = crossedCheckpoint.readback;
  crossed.state.metadata = crossedCheckpoint.metadata;
  const crossedResult = await createPilotIntegration(crossed.options).start();
  assert.equal(crossedResult.summary.checkpointAcknowledgement.status, "UNKNOWN");
  assert.equal(crossed.counters.reportCalls, 0);

  const badSequence = makeEnvironment({
    reportInput: createReportInput({sequence: 2})
  });
  const sequenceResult = await createPilotIntegration(badSequence.options).start();
  assert.equal(sequenceResult.summary.checkpointAcknowledgement.status, "UNKNOWN");
  assert.equal(badSequence.counters.reportCalls, 0);

  const badRun = makeEnvironment({runId: "another-run"});
  assert.throws(() => createPilotIntegration(badRun.options), /checkpoint session identity/);
});

test("provider audit events are not forwarded as ledger-step events", async () => {
  const env = makeEnvironment();
  let stepEvent;
  env.options.step = async ({event}) => {
    stepEvent = event;
    return {
      unresolvedPositions: [],
      receipt: {
        runId: SYNTHETIC_RUN_ID,
        sequence: 1,
        commandId: "synthetic-command-1",
        method: "executeEntry",
        resultDigest: SYNTHETIC_DIGEST
      },
      operatorReportInput: createReportInput()
    };
  };
  await createPilotIntegration(env.options).start();
  assert.equal(stepEvent.kind, "FILTERED_CANDIDATE");
  assert.equal(stepEvent.eventId, undefined);
  assert.equal(stepEvent.candidate.source, "SYNTHETIC_TEST_ONLY");
});
