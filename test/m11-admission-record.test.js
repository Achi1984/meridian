import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdmissionRecordError,
  createAdmissionRecordState,
  reduceAdmissionRecord
} from '../scripts/autonomy/m11-admission-record.mjs';

const ACTION_A = 'a'.repeat(64);
const ACTION_B = 'b'.repeat(64);
const EXEC_A = 'c'.repeat(64);
const EXEC_B = 'd'.repeat(64);

function admissionEvent({expectedRevision, expectedTotalQuota, logicalActionId, executionKey}) {
  return {
    kind: 'SIMULATE_ADMISSION',
    expectedRevision,
    expectedTotalQuota,
    logicalActionId,
    executionKey
  };
}

function effectEvent({logicalActionId, executionKey, admissionRevision}) {
  return {
    kind: 'EFFECT_OBSERVED',
    logicalActionId,
    executionKey,
    admissionRevision
  };
}

function completionEvent({logicalActionId, executionKey, admissionRevision, checkpointAcknowledged}) {
  return {
    kind: 'TERMINAL_COMPLETION',
    evidence: {
      logicalActionId,
      executionKey,
      admissionRevision,
      effect: 'COMPLETED',
      checkpointAcknowledged
    }
  };
}

function unknownEvent({logicalActionId, executionKey, stage = 'EFFECT'}) {
  return {
    kind: 'MARK_UNKNOWN',
    logicalActionId,
    executionKey,
    stage
  };
}

function readbackEvent({logicalActionId, executionKey, observation}) {
  return {
    kind: 'READBACK_OBSERVATION',
    logicalActionId,
    executionKey,
    observation
  };
}

function assertNoAuthority(result) {
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.externalEffects, false);
  assert.equal(result.retryAllowed, false);
}

test('default is disabled and synthetic enabled mode still emits no authority', () => {
  const disabled = createAdmissionRecordState({totalQuota: 1});
  assert.equal(disabled.enabled, false);
  const blocked = reduceAdmissionRecord(disabled, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  }));
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reason, 'DISABLED');
  assertNoAuthority(blocked);

  const enabled = createAdmissionRecordState({enabled: true, totalQuota: 1});
  const admitted = reduceAdmissionRecord(enabled, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  }));
  assert.equal(admitted.status, 'ADMITTED');
  assertNoAuthority(admitted);
});

test('synthetic interleavings (not real concurrency proof): atomic success and stale revision/gate/quota rejections', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 1});
  const before = JSON.parse(JSON.stringify(state));

  const first = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  }));
  assert.equal(first.status, 'ADMITTED');
  assert.equal(first.state.revision, 1);
  assert.equal(first.state.consumedQuota, 1);
  assert.deepEqual(first.state.activeGate, {
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  });
  assert.equal(first.state.claims.length, 1);

  const concurrentLoser = reduceAdmissionRecord(first.state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(concurrentLoser.status, 'BLOCKED');
  assert.equal(concurrentLoser.reason, 'STALE_REVISION');
  assert.deepEqual(state, before);

  const gateBlocked = reduceAdmissionRecord(first.state, admissionEvent({
    expectedRevision: 1,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(gateBlocked.status, 'BLOCKED');
  assert.equal(gateBlocked.reason, 'ACTIVE_GATE_HELD');

  state = reduceAdmissionRecord(first.state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;
  state = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  })).state;

  const budgetBlocked = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: state.revision,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(budgetBlocked.status, 'BLOCKED');
  assert.equal(budgetBlocked.reason, 'QUOTA_EXHAUSTED');
});

test('existing claim blocks duplicate logical action with fresh execution key', () => {
  const state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  const admitted = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;

  const duplicate = reduceAdmissionRecord(admitted, admissionEvent({
    expectedRevision: admitted.revision,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_B
  }));
  assert.equal(duplicate.status, 'BLOCKED');
  assert.equal(duplicate.reason, 'ACTIVE_GATE_HELD');

  const completed = reduceAdmissionRecord(
    reduceAdmissionRecord(admitted, effectEvent({logicalActionId: ACTION_A, executionKey: EXEC_A, admissionRevision: 1})).state,
    completionEvent({logicalActionId: ACTION_A, executionKey: EXEC_A, admissionRevision: 1, checkpointAcknowledged: true})
  ).state;

  const blockedByRetainedClaim = reduceAdmissionRecord(completed, admissionEvent({
    expectedRevision: completed.revision,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_B
  }));
  assert.equal(blockedByRetainedClaim.status, 'BLOCKED');
  assert.equal(blockedByRetainedClaim.reason, 'DUPLICATE_LOGICAL_ACTION');
});

test('retained execution key cannot be reused after acknowledged completion', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;
  state = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  })).state;

  const reusedExecution = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: state.revision,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_B,
    executionKey: EXEC_A
  }));
  assert.equal(reusedExecution.status, 'BLOCKED');
  assert.equal(reusedExecution.reason, 'DUPLICATE_EXECUTION_KEY');
});

test('reservation before effect and effect before receipt ack are enforced', () => {
  const state = createAdmissionRecordState({enabled: true, totalQuota: 2});

  const noReservation = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  }));
  assert.equal(noReservation.status, 'BLOCKED');
  assert.equal(noReservation.reason, 'NO_ACTIVE_GATE');

  const admitted = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;

  const ackTooEarly = reduceAdmissionRecord(admitted, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  }));
  assert.equal(ackTooEarly.status, 'BLOCKED');
  assert.equal(ackTooEarly.reason, 'EFFECT_NOT_OBSERVED');
});

test('unacknowledged terminal completion does not release active gate', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;

  const completion = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: false
  }));
  assert.equal(completion.status, 'RECORDED');
  assert.equal(completion.reason, 'TERMINAL_UNACKNOWLEDGED');
  assert.notEqual(completion.state.activeGate, null);
  assert.equal(completion.state.claims[0].completion, 'UNACKNOWLEDGED');

  const blocked = reduceAdmissionRecord(completion.state, admissionEvent({
    expectedRevision: completion.state.revision,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reason, 'ACTIVE_GATE_HELD');
});

test('valid acknowledged terminal completion releases gate but retains consumed quota and claim', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;

  const completion = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  }));
  assert.equal(completion.reason, 'TERMINAL_ACKNOWLEDGED');
  assert.equal(completion.state.activeGate, null);
  assert.equal(completion.state.consumedQuota, 1);
  assert.equal(completion.state.claims.length, 1);
  assert.equal(completion.state.claims[0].status, 'COMPLETED_ACKED');
});

test('moved identity and incomplete evidence never release gate', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;

  const moved = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_B,
    admissionRevision: 1,
    checkpointAcknowledged: true
  }));
  assert.equal(moved.status, 'BLOCKED');
  assert.equal(moved.reason, 'ACTIVE_GATE_MISMATCH');
  assert.notEqual(moved.state.activeGate, null);

  const pending = createAdmissionRecordState({enabled: true, totalQuota: 2});
  const admitted = reduceAdmissionRecord(pending, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  const noEffect = reduceAdmissionRecord(admitted, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  }));
  assert.equal(noEffect.reason, 'EFFECT_NOT_OBSERVED');
  assert.notEqual(noEffect.state.activeGate, null);
});

test('UNKNOWN is terminal, survives roundtrip, and readback never resumes authority or retries', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;

  const unknown = reduceAdmissionRecord(state, unknownEvent({logicalActionId: ACTION_A, executionKey: EXEC_A}));
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.state.reconciliation.status, 'UNKNOWN');
  assert.equal(unknown.state.claims[0].status, 'UNKNOWN');

  const restarted = JSON.parse(JSON.stringify(unknown.state));
  const readback = reduceAdmissionRecord(restarted, readbackEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    observation: 'notobserved'
  }));
  assert.equal(readback.status, 'UNKNOWN');
  assert.equal(readback.reason, 'UNKNOWN_ANNOTATED');
  assert.equal(readback.state.reconciliation.status, 'UNKNOWN');
  assert.deepEqual(readback.state.reconciliation.observations, ['notobserved']);
  assertNoAuthority(readback);

  const stillBlocked = reduceAdmissionRecord(readback.state, admissionEvent({
    expectedRevision: readback.state.revision,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(stillBlocked.status, 'BLOCKED');
  assert.equal(stillBlocked.reason, 'UNKNOWN_LATCHED');
  assertNoAuthority(stillBlocked);
});

test('reachable conservative UNKNOWN from unacknowledged completion roundtrips and remains blocked', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;
  state = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: false
  })).state;
  state = reduceAdmissionRecord(state, unknownEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    stage: 'CHECKPOINT'
  })).state;
  const restored = JSON.parse(JSON.stringify(state));

  const annotated = reduceAdmissionRecord(restored, readbackEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    observation: 'unresolved'
  }));
  assert.equal(annotated.status, 'UNKNOWN');
  assert.equal(annotated.state.reconciliation.status, 'UNKNOWN');
  assert.equal(annotated.state.claims[0].status, 'UNKNOWN');
  assert.equal(annotated.state.claims[0].effectObserved, true);
  assert.equal(annotated.state.claims[0].completion, 'UNACKNOWLEDGED');
  assert.notEqual(annotated.state.activeGate, null);
  assertNoAuthority(annotated);
});

test('MARK_UNKNOWN on released historical claim is explicitly blocked unchanged', () => {
  let state = createAdmissionRecordState({enabled: true, totalQuota: 2});
  state = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })).state;
  state = reduceAdmissionRecord(state, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  })).state;
  state = reduceAdmissionRecord(state, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  })).state;
  const before = JSON.parse(JSON.stringify(state));

  const blocked = reduceAdmissionRecord(state, unknownEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    stage: 'CHECKPOINT'
  }));
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reason, 'NO_ACTIVE_GATE');
  assert.equal(blocked.changed, false);
  assert.deepEqual(blocked.state, before);
  assertNoAuthority(blocked);
});

test('malformed reconstructed states fail before transition', () => {
  const invalidAdmittedNoGate = {
    enabled: true,
    revision: 1,
    totalQuota: 2,
    consumedQuota: 1,
    activeGate: null,
    claims: [{
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1,
      status: 'ADMITTED',
      effectObserved: false,
      completion: 'PENDING'
    }],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  };
  assert.throws(() => reduceAdmissionRecord(invalidAdmittedNoGate, admissionEvent({
    expectedRevision: 1,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  })), {code: 'STATE_INVALID'});

  const invalidUnknownClear = {
    enabled: true,
    revision: 2,
    totalQuota: 2,
    consumedQuota: 1,
    activeGate: null,
    claims: [{
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1,
      status: 'UNKNOWN',
      effectObserved: true,
      completion: 'PENDING'
    }],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  };
  assert.throws(() => reduceAdmissionRecord(invalidUnknownClear, readbackEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    observation: 'committed'
  })), {code: 'STATE_INVALID'});

  const invalidDuplicateExecution = {
    enabled: true,
    revision: 2,
    totalQuota: 3,
    consumedQuota: 2,
    activeGate: {
      logicalActionId: ACTION_B,
      executionKey: EXEC_B,
      admissionRevision: 2
    },
    claims: [
      {
        logicalActionId: ACTION_A,
        executionKey: EXEC_A,
        admissionRevision: 1,
        status: 'COMPLETED_ACKED',
        effectObserved: true,
        completion: 'ACKNOWLEDGED'
      },
      {
        logicalActionId: ACTION_B,
        executionKey: EXEC_A,
        admissionRevision: 2,
        status: 'ADMITTED',
        effectObserved: false,
        completion: 'PENDING'
      }
    ],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  };
  assert.throws(() => reduceAdmissionRecord(invalidDuplicateExecution, effectEvent({
    logicalActionId: ACTION_B,
    executionKey: EXEC_B,
    admissionRevision: 2
  })), {code: 'STATE_INVALID'});

  const invalidMultipleUnresolvedWithGateMatch = {
    enabled: true,
    revision: 3,
    totalQuota: 4,
    consumedQuota: 3,
    activeGate: {
      logicalActionId: ACTION_B,
      executionKey: EXEC_B,
      admissionRevision: 2
    },
    claims: [
      {
        logicalActionId: ACTION_A,
        executionKey: EXEC_A,
        admissionRevision: 1,
        status: 'ADMITTED',
        effectObserved: false,
        completion: 'PENDING'
      },
      {
        logicalActionId: ACTION_B,
        executionKey: EXEC_B,
        admissionRevision: 2,
        status: 'COMPLETED_UNACKED',
        effectObserved: true,
        completion: 'UNACKNOWLEDGED'
      },
      {
        logicalActionId: 'e'.repeat(64),
        executionKey: 'f'.repeat(64),
        admissionRevision: 3,
        status: 'COMPLETED_ACKED',
        effectObserved: true,
        completion: 'ACKNOWLEDGED'
      }
    ],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  };
  assert.throws(() => reduceAdmissionRecord(invalidMultipleUnresolvedWithGateMatch, effectEvent({
    logicalActionId: ACTION_B,
    executionKey: EXEC_B,
    admissionRevision: 2
  })), {code: 'STATE_INVALID'});
});

test('revision overflow blocks unchanged on every mutating transition kind', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const base = {
    enabled: true,
    revision: max,
    totalQuota: 2,
    consumedQuota: 1,
    activeGate: {
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1
    },
    claims: [{
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1,
      status: 'ADMITTED',
      effectObserved: true,
      completion: 'PENDING'
    }],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  };
  const admissionState = {
    ...base,
    consumedQuota: 0,
    activeGate: null,
    claims: []
  };
  const admission = reduceAdmissionRecord(admissionState, admissionEvent({
    expectedRevision: max,
    expectedTotalQuota: 2,
    logicalActionId: ACTION_B,
    executionKey: EXEC_B
  }));
  assert.equal(admission.status, 'BLOCKED');
  assert.equal(admission.reason, 'REVISION_EXHAUSTED');
  assert.equal(admission.changed, false);
  assert.deepEqual(admission.state, admissionState);

  const effect = reduceAdmissionRecord(base, effectEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1
  }));
  assert.equal(effect.reason, 'REVISION_EXHAUSTED');
  assert.equal(effect.changed, false);
  assert.deepEqual(effect.state, base);

  const completion = reduceAdmissionRecord(base, completionEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    admissionRevision: 1,
    checkpointAcknowledged: true
  }));
  assert.equal(completion.reason, 'REVISION_EXHAUSTED');
  assert.equal(completion.changed, false);
  assert.deepEqual(completion.state, base);

  const markUnknown = reduceAdmissionRecord(base, unknownEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    stage: 'CHECKPOINT'
  }));
  assert.equal(markUnknown.reason, 'REVISION_EXHAUSTED');
  assert.equal(markUnknown.changed, false);
  assert.deepEqual(markUnknown.state, base);

  const unknownBase = {
    ...base,
    claims: [{
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1,
      status: 'UNKNOWN',
      effectObserved: true,
      completion: 'PENDING'
    }],
    reconciliation: {
      status: 'UNKNOWN',
      stage: 'CHECKPOINT',
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      observations: []
    }
  };
  const readback = reduceAdmissionRecord(unknownBase, readbackEvent({
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    observation: 'unresolved'
  }));
  assert.equal(readback.reason, 'REVISION_EXHAUSTED');
  assert.equal(readback.changed, false);
  assert.deepEqual(readback.state, unknownBase);
});

test('rejections leave prior frozen input unchanged', () => {
  const state = createAdmissionRecordState({enabled: true, totalQuota: 1});
  assert.equal(Object.isFrozen(state), true);
  const before = JSON.parse(JSON.stringify(state));

  const rejected = reduceAdmissionRecord(state, admissionEvent({
    expectedRevision: 1,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  }));
  assert.equal(rejected.status, 'BLOCKED');
  assert.equal(rejected.reason, 'STALE_REVISION');
  assert.deepEqual(state, before);
  assert.equal(Object.isFrozen(state.claims), true);
});

test('hostile schemas, malformed ids, proxies, getters, extras, and bad integers are rejected', () => {
  assert.throws(() => createAdmissionRecordState({enabled: true, totalQuota: 1, extra: true}), {
    code: 'INITIAL_STATE_INVALID'
  });

  const initial = createAdmissionRecordState({enabled: true, totalQuota: 1});
  const proxyState = new Proxy(initial, {});
  assert.throws(() => reduceAdmissionRecord(proxyState, admissionEvent({
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  })), {code: 'STATE_INVALID'});

  const eventWithGetter = {};
  Object.defineProperty(eventWithGetter, 'kind', {enumerable: true, get() { return 'SIMULATE_ADMISSION'; }});
  Object.assign(eventWithGetter, {
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  });
  assert.throws(() => reduceAdmissionRecord(initial, eventWithGetter), {code: 'EVENT_INVALID'});

  assert.throws(() => reduceAdmissionRecord(initial, {
    kind: 'SIMULATE_ADMISSION',
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: 'not-hex',
    executionKey: EXEC_A
  }), {code: 'EVENT_INVALID'});

  assert.throws(() => reduceAdmissionRecord(initial, {
    kind: 'SIMULATE_ADMISSION',
    expectedRevision: -1,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A
  }), {code: 'EVENT_INVALID'});

  assert.throws(() => reduceAdmissionRecord(initial, {
    kind: 'SIMULATE_ADMISSION',
    expectedRevision: 0,
    expectedTotalQuota: 1,
    logicalActionId: ACTION_A,
    executionKey: EXEC_A,
    extra: true
  }), {code: 'EVENT_INVALID'});

  assert.throws(() => reduceAdmissionRecord(initial, {
    kind: 'TERMINAL_COMPLETION',
    evidence: {
      logicalActionId: ACTION_A,
      executionKey: EXEC_A,
      admissionRevision: 1,
      effect: 'PARTIAL',
      checkpointAcknowledged: true
    }
  }), {code: 'EVENT_INVALID'});

  assert.equal(new AdmissionRecordError('X').name, 'AdmissionRecordError');
});
