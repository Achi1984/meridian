import assert from "node:assert/strict";
import test from "node:test";
import {
  createPilotRunControl,
  SYNTHETIC_TEST_ONLY
} from "../scripts/memecoin-paper/pilot-run-control.mjs";
import {
  createFakeCallbacks,
  createFakeRuntime,
  createTrackedSignal,
  deferred,
  flushMicrotasks
} from "./fixtures/memecoin-paper-pilot-run-control/fakes.mjs";

const DEFAULT_BUDGETS = Object.freeze({
  requests: 1,
  events: 1,
  cycles: 1,
  durationMs: 100,
  pollIntervalMs: 1,
  callbackSettlementMs: 5
});

function setup({runtime = createFakeRuntime(), overrides = {}, budgets = {}, signal} = {}) {
  const fake = createFakeCallbacks(overrides);
  const control = createPilotRunControl({
    mode: SYNTHETIC_TEST_ONLY,
    callbacks: fake.callbacks,
    clock: runtime.clock,
    scheduler: runtime.scheduler,
    signal,
    budgets: {...DEFAULT_BUDGETS, ...budgets}
  });
  return {...fake, control, runtime};
}

test("the default-disabled invocation performs no callbacks and owns no timers", async () => {
  const fake = createFakeCallbacks({
    acquire: () => assert.fail("disabled control must not acquire"),
    step: () => assert.fail("disabled control must not step"),
    checkpoint: () => assert.fail("disabled control must not checkpoint"),
    report: () => assert.fail("disabled control must not report")
  });
  const control = createPilotRunControl({callbacks: fake.callbacks});
  assert.deepEqual(await control.start(), {
    status: "DISABLED",
    state: "CREATED",
    mode: "DISABLED",
    executionStarted: false,
    reason: "SYNTHETIC_TEST_ONLY mode was not explicitly selected"
  });
  assert.equal(control.stop(), false);
  assert.deepEqual(fake.calls, []);
});

test("only explicit synthetic mode is accepted; boolean real-mode claims are not", () => {
  const fake = createFakeCallbacks();
  const runtime = createFakeRuntime();
  const common = {
    callbacks: fake.callbacks,
    clock: runtime.clock,
    scheduler: runtime.scheduler,
    budgets: DEFAULT_BUDGETS
  };
  assert.throws(() => createPilotRunControl({...common, mode: "REAL"}), /unsupported/);
  assert.throws(() => createPilotRunControl({...common, mode: true}), /unsupported/);
  assert.throws(() => createPilotRunControl({
    ...common,
    mode: SYNTHETIC_TEST_ONLY,
    realRunAuthorized: true
  }), /unknown pilot run control option/);
  assert.deepEqual(fake.calls, []);
});

test("an acknowledged one-cycle budget ends once and preserves supplied unresolved positions", async () => {
  const {control, calls, runtime} = setup();
  const run = control.start();
  assert.equal(control.start(), run);
  const summary = await run;
  assert.equal(summary.status, "FINISHED");
  assert.equal(summary.state, "FINISHED");
  assert.equal(summary.reason, "BUDGET_EXHAUSTED");
  assert.deepEqual(summary.counts, {requests: 1, events: 1, cycles: 1, completedSteps: 1});
  assert.deepEqual(summary.checkpointAcknowledgement, {
    status: "ACKNOWLEDGED",
    sequence: 1,
    hash: "1".padStart(64, "0")
  });
  assert.deepEqual(summary.positionEvidence, {
    status: "UNKNOWN",
    unresolvedPositions: null,
    sourceStep: null,
    lastKnown: {
      status: "STALE",
      reason: "STOP_REQUESTED:BUDGET_EXHAUSTED",
      sourceStep: 1,
      unresolvedPositions: [{source: "synthetic callback evidence", eventId: "event-0"}]
    }
  });
  assert.equal(calls.filter(call => call.name === "report").length, 1);
  assert.equal(calls.find(call => call.name === "report").input.summary.status, "FINISHED");
  assert.equal(runtime.pendingTimers(), 0);
  assert.ok(calls.filter(call => call.name !== "report").every(call =>
    call.name !== "step" || call.input.event.synthetic === true));
});

test("position evidence from an earlier step is stale when the latest step omits it", async () => {
  for (const earlier of [[], [{id: "synthetic-open-position"}]]) {
    const {control, calls} = setup({
      budgets: {events: 2},
      overrides: {
        acquire() {
          return {
            events: [
              {synthetic: true, id: "with-evidence"},
              {synthetic: true, id: "without-evidence"}
            ],
            requestsUsed: 1
          };
        },
        step(input) {
          return input.eventIndex === 0 ? {unresolvedPositions: earlier} : undefined;
        }
      }
    });
    const summary = await control.start();
    const checkpoint = calls.find(call => call.name === "checkpoint").input;
    const report = calls.find(call => call.name === "report").input.summary;
    assert.equal(checkpoint.positionEvidenceStatus, "UNKNOWN");
    assert.equal(checkpoint.unresolvedPositions, null);
    assert.equal(checkpoint.positionEvidenceSourceStep, null);
    assert.deepEqual(checkpoint.lastKnownPositionEvidence, {
      status: "STALE",
      reason: "LATEST_STEP_DID_NOT_SUPPLY_POSITION_EVIDENCE",
      sourceStep: 1,
      unresolvedPositions: earlier
    });
    assert.equal(summary.positionEvidence.status, "UNKNOWN");
    assert.equal(summary.positionEvidence.unresolvedPositions, null);
    assert.deepEqual(report.positionEvidence, summary.positionEvidence);
  }
});

test("invalid latest-step evidence cannot retain earlier empty or nonempty evidence as current", async () => {
  for (const earlier of [[], [{id: "synthetic-open-position"}]]) {
    const {control, calls} = setup({
      budgets: {events: 2},
      overrides: {
        acquire() {
          return {
            events: [
              {synthetic: true, id: "valid"},
              {synthetic: true, id: "invalid"}
            ],
            requestsUsed: 1
          };
        },
        step(input) {
          return input.eventIndex === 0
            ? {unresolvedPositions: earlier}
            : {unresolvedPositions: "not-an-array"};
        }
      }
    });
    const summary = await control.start();
    const checkpoint = calls.find(call => call.name === "checkpoint").input;
    assert.equal(checkpoint.positionEvidenceStatus, "UNKNOWN");
    assert.equal(checkpoint.unresolvedPositions, null);
    assert.equal(checkpoint.positionEvidenceSourceStep, null);
    assert.equal(checkpoint.lastKnownPositionEvidence.status, "STALE");
    assert.equal(checkpoint.lastKnownPositionEvidence.reason, "LATEST_STEP_POSITION_EVIDENCE_INVALID");
    assert.deepEqual(checkpoint.lastKnownPositionEvidence.unresolvedPositions, earlier);
    assert.equal(summary.positionEvidence.status, "UNKNOWN");
  }
});

test("the exact monotonic deadline and a late acquisition both prevent a new step", async () => {
  for (const elapsed of [DEFAULT_BUDGETS.durationMs, DEFAULT_BUDGETS.durationMs + 1]) {
    const runtime = createFakeRuntime();
    const {control, calls} = setup({
      runtime,
      overrides: {
        acquire(input, {calls: recorded}) {
          runtime.setNow(1_000 + elapsed);
          recorded.push({name: "acquire-result", cycleIndex: input.cycleIndex});
          return {events: [{synthetic: true, id: "at-deadline"}], requestsUsed: 1};
        }
      }
    });
    const summary = await control.start();
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.reason, "DEADLINE");
    assert.equal(calls.filter(call => call.name === "step").length, 0);
    assert.equal(calls.filter(call => call.name === "checkpoint").length, 0);
    assert.equal(summary.checkpointAcknowledgement.status, "NOT_ATTEMPTED");
    assert.equal(runtime.pendingTimers(), 0);
  }
});

test("an operator stop before the first cycle starts no callback and is idempotent", async () => {
  const {control, calls, runtime} = setup();
  const run = control.start();
  assert.equal(control.snapshot().state, "RUNNING");
  assert.equal(control.stop(), true);
  assert.equal(control.snapshot().state, "STOPPING");
  assert.equal(control.stop(), false);
  const summary = await run;
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "OPERATOR_STOP");
  assert.equal(calls.filter(call => call.name === "acquire").length, 0);
  assert.equal(calls.filter(call => call.name === "report").length, 1);
  assert.equal(runtime.pendingTimers(), 0);
});

test("an operator stop before start is remembered without starting work", async () => {
  const {control, calls, runtime} = setup();
  assert.equal(control.stop(), true);
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "OPERATOR_STOP");
  assert.equal(calls.filter(call => call.name === "acquire").length, 0);
  assert.equal(runtime.pendingTimers(), 0);
});

test("stop aborts active acquisition and bounds settlement when its callback ignores abort", async () => {
  const runtime = createFakeRuntime();
  const barrier = deferred();
  let observedSignal;
  const {control, calls} = setup({
    runtime,
    overrides: {
      acquire(input) {
        observedSignal = input.signal;
        return barrier.promise;
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "acquire").length, 1);
  assert.equal(observedSignal.aborted, false);
  assert.equal(control.stop(), true);
  assert.equal(observedSignal.aborted, true);
  await runtime.advance(DEFAULT_BUDGETS.callbackSettlementMs);
  const summary = await run;
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.callbackCompletion.acquire, "UNSETTLED");
  assert.equal(calls.filter(call => call.name === "step").length, 0);
  barrier.resolve({events: [{synthetic: true, id: "late"}], requestsUsed: 1});
  await flushMicrotasks();
  assert.equal(control.snapshot().state, "UNKNOWN");
  assert.equal(runtime.pendingTimers(), 0);
});

test("the injected deadline timer aborts active work and settles it within its bound", async () => {
  const runtime = createFakeRuntime();
  const barrier = deferred();
  let observedSignal;
  const {control, calls} = setup({
    runtime,
    overrides: {
      acquire(input) {
        observedSignal = input.signal;
        return barrier.promise;
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  await runtime.advance(DEFAULT_BUDGETS.durationMs);
  assert.equal(observedSignal.aborted, true);
  await runtime.advance(DEFAULT_BUDGETS.callbackSettlementMs);
  const summary = await run;
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "DEADLINE");
  assert.equal(summary.requestAccountingStatus, "UNKNOWN");
  assert.equal(calls.filter(call => call.name === "step").length, 0);
  barrier.resolve({events: [], requestsUsed: 0});
  await flushMicrotasks();
  assert.equal(control.snapshot().state, "UNKNOWN");
  assert.equal(runtime.pendingTimers(), 0);
});

test("parent cancellation aborts an active step, does not checkpoint, and removes its listener", async () => {
  const runtime = createFakeRuntime();
  const signal = createTrackedSignal();
  const barrier = deferred();
  let observedSignal;
  const {control, calls} = setup({
    runtime,
    signal,
    overrides: {
      step(input) {
        observedSignal = input.signal;
        return barrier.promise;
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "step").length, 1);
  signal.abort();
  assert.equal(observedSignal.aborted, true);
  await runtime.advance(DEFAULT_BUDGETS.callbackSettlementMs);
  const summary = await run;
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "PARENT_ABORT");
  assert.equal(summary.checkpointAcknowledgement.status, "NOT_ATTEMPTED");
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 0);
  assert.equal(signal.listenerCount(), 0);
  barrier.resolve({unresolvedPositions: [{id: "late-synthetic-position"}]});
  await flushMicrotasks();
  assert.equal(control.snapshot().state, "UNKNOWN");
  assert.equal(runtime.pendingTimers(), 0);
});

test("failed latest step marks prior position evidence stale and reports it as non-current", async () => {
  for (const previous of [[], [{id: "synthetic-position"}]]) {
    const {control, calls} = setup({
      budgets: {events: 2},
      overrides: {
        acquire() {
          return {
            events: [{synthetic: true, id: "valid"}, {synthetic: true, id: "failure"}],
            requestsUsed: 1
          };
        },
        step(input) {
          if (input.eventIndex === 0) return {unresolvedPositions: previous};
          throw new Error("synthetic latest step failure");
        }
      }
    });
    const summary = await control.start();
    const report = calls.find(call => call.name === "report").input.summary;
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.positionEvidence.status, "UNKNOWN");
    assert.equal(summary.positionEvidence.unresolvedPositions, null);
    assert.equal(summary.positionEvidence.lastKnown.status, "STALE");
    assert.equal(summary.positionEvidence.lastKnown.reason, "LATEST_STEP_FAILED");
    assert.deepEqual(summary.positionEvidence.lastKnown.unresolvedPositions, previous);
    assert.deepEqual(report.positionEvidence, summary.positionEvidence);
    assert.equal(calls.filter(call => call.name === "checkpoint").length, 0);
  }
});

test("unsettled step and operator stop leave previous position evidence stale", async () => {
  for (const previous of [[], [{id: "synthetic-position"}]]) {
    const runtime = createFakeRuntime();
    const barrier = deferred();
    const {control, calls} = setup({
      runtime,
      budgets: {events: 2},
      overrides: {
        acquire() {
          return {
            events: [{synthetic: true, id: "valid"}, {synthetic: true, id: "unsettled"}],
            requestsUsed: 1
          };
        },
        step(input) {
          return input.eventIndex === 0
            ? {unresolvedPositions: previous}
            : barrier.promise;
        },
        report() {
          throw new Error("synthetic report failed after unsettled step");
        }
      }
    });
    const run = control.start();
    await flushMicrotasks();
    assert.equal(calls.filter(call => call.name === "step").length, 2);
    assert.equal(control.stop(), true);
    await runtime.advance(DEFAULT_BUDGETS.callbackSettlementMs);
    const summary = await run;
    const report = calls.find(call => call.name === "report").input.summary;
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.reason, "OPERATOR_STOP");
    assert.equal(summary.positionEvidence.status, "UNKNOWN");
    assert.equal(summary.positionEvidence.unresolvedPositions, null);
    assert.equal(summary.positionEvidence.lastKnown.status, "STALE");
    assert.equal(summary.positionEvidence.lastKnown.reason, "LATEST_STEP_UNSETTLED");
    assert.deepEqual(summary.positionEvidence.lastKnown.unresolvedPositions, previous);
    assert.deepEqual(report.positionEvidence, summary.positionEvidence);
    assert.equal(summary.reportStatus, "FAILED");
    assert.equal(calls.filter(call => call.name === "checkpoint").length, 0);
    barrier.reject(new Error("synthetic late step failure"));
    await flushMicrotasks();
    assert.deepEqual(control.snapshot().callbackCompletion.step, "UNSETTLED");
    assert.equal(control.snapshot().state, "UNKNOWN");
    assert.equal(runtime.pendingTimers(), 0);
  }
});

test("operator stop between cycles stales evidence from the last acknowledged checkpoint", async () => {
  const {control, calls, runtime} = setup({
    budgets: {requests: 2, events: 2, cycles: 2},
    overrides: {
      acquire() {
        return {
          events: [{synthetic: true, id: "first-cycle"}],
          requestsUsed: 1,
          done: false
        };
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 1);
  const checkpoint = calls.find(call => call.name === "checkpoint").input;
  assert.equal(calls.find(call => call.name === "checkpoint").input.positionEvidenceStatus, "SUPPLIED");
  assert.equal(checkpoint.positionEvidenceSourceStep, 1);
  assert.deepEqual(checkpoint.unresolvedPositions, [
    {source: "synthetic callback evidence", eventId: "first-cycle"}
  ]);
  assert.deepEqual(checkpoint.lastKnownPositionEvidence, {
    status: "LAST_KNOWN",
    reason: null,
    sourceStep: 1,
    unresolvedPositions: [{source: "synthetic callback evidence", eventId: "first-cycle"}]
  });
  assert.equal(calls.filter(call => call.name === "acquire").length, 1);
  assert.equal(control.stop(), true);
  const summary = await run;
  const report = calls.find(call => call.name === "report").input.summary;
  assert.equal(summary.reason, "OPERATOR_STOP");
  assert.equal(summary.positionEvidence.status, "UNKNOWN");
  assert.equal(summary.positionEvidence.unresolvedPositions, null);
  assert.equal(summary.positionEvidence.lastKnown.status, "STALE");
  assert.equal(summary.positionEvidence.lastKnown.reason, "STOP_REQUESTED:OPERATOR_STOP");
  assert.deepEqual(report.positionEvidence, summary.positionEvidence);
  assert.equal(calls.filter(call => call.name === "acquire").length, 1);
  assert.equal(runtime.pendingTimers(), 0);
});

test("position evidence keeps its source step across an empty acquisition cycle", async () => {
  const runtime = createFakeRuntime();
  let acquisitions = 0;
  const {control, calls} = setup({
    runtime,
    budgets: {requests: 2, events: 2, cycles: 2},
    overrides: {
      acquire() {
        acquisitions += 1;
        return {
          events: acquisitions === 1 ? [{synthetic: true, id: "position-sample"}] : [],
          requestsUsed: 1,
          done: acquisitions === 2
        };
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 1);
  await runtime.advance(DEFAULT_BUDGETS.pollIntervalMs);
  const summary = await run;
  const checkpoints = calls.filter(call => call.name === "checkpoint");
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[1].input.positionEvidenceStatus, "SUPPLIED");
  assert.equal(checkpoints[1].input.positionEvidenceSourceStep, 1);
  assert.deepEqual(checkpoints[1].input.unresolvedPositions, [
    {source: "synthetic callback evidence", eventId: "position-sample"}
  ]);
  assert.equal(summary.positionEvidence.status, "UNKNOWN");
  assert.equal(summary.positionEvidence.lastKnown.sourceStep, 1);
});

test("missing and null polling timer handles stop UNKNOWN after the first acknowledged cycle", async () => {
  for (const missingHandle of [undefined, null]) {
    const runtime = createFakeRuntime();
    let timerCalls = 0;
    const scheduler = {
      setTimeout(callback, delay) {
        timerCalls += 1;
        if (timerCalls === 2) return missingHandle;
        return runtime.scheduler.setTimeout(callback, delay);
      },
      clearTimeout(handle) {
        runtime.scheduler.clearTimeout(handle);
      }
    };
    const fake = createFakeCallbacks({
      acquire() {
        return {events: [{synthetic: true, id: "first-only"}], requestsUsed: 1};
      }
    });
    const control = createPilotRunControl({
      mode: SYNTHETIC_TEST_ONLY,
      callbacks: fake.callbacks,
      clock: runtime.clock,
      scheduler,
      budgets: {...DEFAULT_BUDGETS, requests: 2, events: 2, cycles: 2}
    });
    const summary = await control.start();
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.reason, "SCHEDULER_FAILED");
    assert.equal(summary.failureCode, "SCHEDULER_FAILED");
    assert.equal(summary.checkpointAcknowledgement.status, "ACKNOWLEDGED");
    assert.equal(fake.calls.filter(call => call.name === "acquire").length, 1);
    assert.equal(fake.calls.filter(call => call.name === "step").length, 1);
    assert.equal(fake.calls.filter(call => call.name === "checkpoint").length, 1);
    assert.equal(fake.calls.filter(call => call.name === "report").length, 1);
    assert.equal(runtime.pendingTimers(), 0);
  }
});

test("a slow acquisition never overlaps and polling begins only after cycle settlement", async () => {
  const runtime = createFakeRuntime();
  const barrier = deferred();
  let active = 0;
  let maximumActive = 0;
  const {control, calls} = setup({
    runtime,
    budgets: {requests: 2, cycles: 2},
    overrides: {
      acquire() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return barrier.promise.finally(() => { active -= 1; });
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  await runtime.advance(20);
  assert.equal(calls.filter(call => call.name === "acquire").length, 1);
  assert.equal(maximumActive, 1);
  barrier.resolve({events: [], requestsUsed: 1, done: true});
  const summary = await run;
  assert.equal(summary.status, "FINISHED");
  assert.equal(summary.counts.cycles, 1);
  assert.equal(maximumActive, 1);
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 1);
  assert.equal(runtime.pendingTimers(), 0);
});

test("zero and exhausted work budgets never exceed their limits", async () => {
  const noBudget = setup({budgets: {requests: 0, cycles: 0}});
  const empty = await noBudget.control.start();
  assert.equal(empty.status, "UNKNOWN");
  assert.equal(empty.reason, "BUDGET_EXHAUSTED");
  assert.equal(empty.counts.requests, 0);
  assert.equal(noBudget.calls.filter(call => call.name === "acquire").length, 0);

  const exhausted = setup({
    budgets: {requests: 3, cycles: 3, events: 1}
  });
  const bounded = await exhausted.control.start();
  assert.equal(bounded.status, "FINISHED");
  assert.equal(bounded.reason, "BUDGET_EXHAUSTED");
  assert.equal(bounded.counts.requests, 1);
  assert.equal(bounded.counts.events, 1);
  assert.equal(bounded.counts.cycles, 1);
  assert.equal(exhausted.calls.filter(call => call.name === "acquire").length, 1);
});

test("an event batch larger than the remaining budget is not truncated or processed", async () => {
  const {control, calls} = setup({
    overrides: {
      acquire() {
        return {events: [
          {synthetic: true, id: "over-budget-1"},
          {synthetic: true, id: "over-budget-2"}
        ], requestsUsed: 1};
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "EVENT_BUDGET_EXCEEDED");
  assert.equal(summary.counts.events, 0);
  assert.equal(calls.filter(call => call.name === "step").length, 0);
  assert.equal(summary.checkpointAcknowledgement.status, "NOT_ATTEMPTED");
});

test("sparse acquisition batches are rejected before stepping", async () => {
  const {control, calls} = setup({
    overrides: {
      acquire() {
        return {events: new Array(1), requestsUsed: 1};
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.failureCode, "INVALID_ACQUISITION_RESULT");
  assert.equal(calls.filter(call => call.name === "step").length, 0);
});

test("acquisition reports bounded request usage and an overrun stops before stepping", async () => {
  const {control, calls} = setup({
    overrides: {
      acquire(input) {
        assert.equal(input.remainingRequests, 1);
        return {events: [{synthetic: true, id: "request-overrun"}], requestsUsed: 2};
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.reason, "REQUEST_BUDGET_EXCEEDED");
  assert.equal(summary.failureCode, "REQUEST_BUDGET_EXCEEDED");
  assert.equal(summary.requestAccountingStatus, "KNOWN");
  assert.equal(summary.counts.requests, 2);
  assert.equal(calls.filter(call => call.name === "step").length, 0);
});

test("unknown checkpoint acknowledgement withholds durable FINISHED status", async () => {
  const {control, calls} = setup({
    overrides: {
      checkpoint() {
        return {status: "UNKNOWN", sequence: 1, hash: "a".repeat(64)};
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.checkpointAcknowledgement.status, "UNKNOWN");
  assert.equal(summary.positionEvidence.status, "UNKNOWN");
  assert.equal(summary.positionEvidence.lastKnown.status, "STALE");
  assert.equal(calls.find(call => call.name === "report").input.summary.positionEvidence.status, "UNKNOWN");
  assert.equal(calls.find(call => call.name === "report").input.summary.status, "UNKNOWN");
});

test("checkpoint acknowledgement sequences reject regression and conflicting same-sequence hashes", async () => {
  const scenarios = [
    [
      {status: "ACKNOWLEDGED", sequence: 2, hash: "2".padStart(64, "0")},
      {status: "ACKNOWLEDGED", sequence: 1, hash: "1".padStart(64, "0")}
    ],
    [
      {status: "ACKNOWLEDGED", sequence: 2, hash: "2".padStart(64, "0")},
      {status: "ACKNOWLEDGED", sequence: 2, hash: "a".repeat(64)}
    ]
  ];
  for (const acknowledgements of scenarios) {
    const runtime = createFakeRuntime();
    let acquisition = 0;
    let checkpoint = 0;
    const {control, calls} = setup({
      runtime,
      budgets: {requests: 2, events: 2, cycles: 2},
      overrides: {
        acquire() {
          acquisition += 1;
          return {
            events: [{synthetic: true, id: `step-${acquisition}`}],
            requestsUsed: 1
          };
        },
        checkpoint() {
          return acknowledgements[checkpoint++];
        }
      }
    });
    const run = control.start();
    await flushMicrotasks();
    await runtime.advance(DEFAULT_BUDGETS.pollIntervalMs);
    const summary = await run;
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.reason, "CHECKPOINT_ACK_UNKNOWN");
    assert.equal(summary.checkpointAcknowledgement.status, "UNKNOWN");
    assert.equal(calls.filter(call => call.name === "acquire").length, 2);
    assert.equal(calls.filter(call => call.name === "checkpoint").length, 2);
  }
});

test("repeated identical checkpoint ACK is accepted only when event and step progress is unchanged", async () => {
  for (const secondCycleHasEvent of [false, true]) {
    const runtime = createFakeRuntime();
    let acquisition = 0;
    const repeatedAck = {
      status: "ACKNOWLEDGED",
      sequence: 1,
      hash: "1".padStart(64, "0")
    };
    const {control, calls} = setup({
      runtime,
      budgets: {requests: 2, events: 2, cycles: 2},
      overrides: {
        acquire() {
          acquisition += 1;
          return {
            events: acquisition === 1 || secondCycleHasEvent
              ? [{synthetic: true, id: `cycle-${acquisition}`}]
              : [],
            requestsUsed: 1,
            done: acquisition === 2
          };
        },
        checkpoint() {
          return repeatedAck;
        }
      }
    });
    const run = control.start();
    await flushMicrotasks();
    await runtime.advance(DEFAULT_BUDGETS.pollIntervalMs);
    const summary = await run;
    assert.equal(calls.filter(call => call.name === "checkpoint").length, 2);
    if (secondCycleHasEvent) {
      assert.equal(summary.status, "UNKNOWN");
      assert.equal(summary.reason, "CHECKPOINT_ACK_UNKNOWN");
      assert.equal(summary.checkpointAcknowledgement.status, "UNKNOWN");
    } else {
      assert.equal(summary.status, "FINISHED");
      assert.equal(summary.checkpointAcknowledgement.status, "ACKNOWLEDGED");
      assert.equal(summary.checkpointAcknowledgement.sequence, repeatedAck.sequence);
      assert.equal(summary.checkpointAcknowledgement.hash, repeatedAck.hash);
    }
  }
});

test("a late checkpoint ACK after operator stop is retained without resuming work", async () => {
  const runtime = createFakeRuntime();
  const barrier = deferred();
  let checkpointSignal;
  const {control, calls} = setup({
    runtime,
    overrides: {
      checkpoint(input) {
        checkpointSignal = input.signal;
        return barrier.promise;
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 1);
  assert.equal(control.stop(), true);
  assert.equal(checkpointSignal.aborted, true);
  barrier.resolve({
    status: "ACKNOWLEDGED",
    sequence: 1,
    hash: "1".padStart(64, "0")
  });
  const summary = await run;
  const report = calls.find(call => call.name === "report").input.summary;
  assert.equal(summary.status, "FINISHED");
  assert.equal(summary.reason, "OPERATOR_STOP");
  assert.equal(summary.callbackCompletion.checkpoint, "COMPLETED_AFTER_STOP");
  assert.equal(summary.checkpointAcknowledgement.status, "ACKNOWLEDGED");
  assert.equal(report.status, "FINISHED");
  assert.equal(report.checkpointAcknowledgement.status, "ACKNOWLEDGED");
  assert.equal(calls.filter(call => call.name === "acquire").length, 1);
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 1);
  assert.equal(runtime.pendingTimers(), 0);
});

test("step and terminal report failures remain separate from checkpoint evidence", async () => {
  const {control, calls, runtime} = setup({
    overrides: {
      step() {
        const error = new Error("synthetic step failure");
        error.code = "STEP_FAILED";
        throw error;
      },
      report() {
        throw new Error("synthetic report failure");
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.failureCode, "STEP_FAILED");
  assert.equal(summary.checkpointAcknowledgement.status, "NOT_ATTEMPTED");
  assert.equal(summary.reportStatus, "FAILED");
  assert.equal(calls.filter(call => call.name === "checkpoint").length, 0);
  assert.equal(calls.filter(call => call.name === "report").length, 1);
  assert.equal(runtime.pendingTimers(), 0);
});

test("a report that ignores its signal cannot delay the terminal result indefinitely", async () => {
  const runtime = createFakeRuntime();
  const reportBarrier = deferred();
  let reportSignal;
  const {control, calls} = setup({
    runtime,
    overrides: {
      report(input) {
        reportSignal = input.signal;
        return reportBarrier.promise;
      }
    }
  });
  const run = control.start();
  await flushMicrotasks();
  assert.equal(calls.filter(call => call.name === "report").length, 1);
  await runtime.advance(DEFAULT_BUDGETS.callbackSettlementMs);
  assert.equal(reportSignal.aborted, true);
  const summary = await run;
  assert.equal(summary.status, "FINISHED");
  assert.equal(summary.reportStatus, "UNKNOWN");
  assert.equal(runtime.pendingTimers(), 0);
  reportBarrier.resolve();
  await flushMicrotasks();
  assert.equal(control.snapshot().state, "FINISHED");
});

test("duplicate stop and repeated start produce one terminal report", async () => {
  const {control, calls} = setup();
  const run = control.start();
  assert.equal(control.stop(), true);
  assert.equal(control.stop(), false);
  assert.equal(control.start(), run);
  const summary = await run;
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(control.stop(), false);
  assert.equal(calls.filter(call => call.name === "report").length, 1);
});

test("monotonic regression and invalid bounds fail closed", async () => {
  const runtime = createFakeRuntime();
  const {control, calls} = setup({
    runtime,
    overrides: {
      acquire() {
        runtime.setNow(999);
        return {events: [{synthetic: true, id: "regression"}], requestsUsed: 1};
      }
    }
  });
  const summary = await control.start();
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.failureCode, "MONOTONIC_CLOCK_INVALID");
  assert.equal(calls.filter(call => call.name === "step").length, 0);

  for (const budgets of [
    {durationMs: 8 * 60 * 60 * 1000 + 1},
    {callbackSettlementMs: 0},
    {pollIntervalMs: Infinity},
    {events: -1}
  ]) {
    const invalid = createFakeRuntime();
    const fake = createFakeCallbacks();
    assert.throws(() => createPilotRunControl({
      mode: SYNTHETIC_TEST_ONLY,
      callbacks: fake.callbacks,
      clock: invalid.clock,
      scheduler: invalid.scheduler,
      budgets: {...DEFAULT_BUDGETS, ...budgets}
    }), /bounded|integer/);
    assert.deepEqual(fake.calls, []);
  }
});

test("parent listener and scheduler timers are deterministically cleaned after completion", async () => {
  const runtime = createFakeRuntime();
  const signal = createTrackedSignal();
  const {control} = setup({runtime, signal});
  const summary = await control.start();
  assert.equal(summary.status, "FINISHED");
  assert.equal(signal.listenerCount(), 0);
  assert.equal(runtime.pendingTimers(), 0);
});
