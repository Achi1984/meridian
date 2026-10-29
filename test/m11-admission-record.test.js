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
