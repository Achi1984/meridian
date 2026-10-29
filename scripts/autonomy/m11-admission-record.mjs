import {types} from 'node:util';

const HEX64 = /^[a-f0-9]{64}$/;
const MAX_RETAINED_CLAIMS = 64;
const MAX_READBACK_OBSERVATIONS = 32;

const CLAIM_STATUS = new Set(['ADMITTED', 'UNKNOWN', 'COMPLETED_UNACKED', 'COMPLETED_ACKED']);
const COMPLETION_STATUS = new Set(['PENDING', 'UNACKNOWLEDGED', 'ACKNOWLEDGED']);
const UNKNOWN_STAGES = new Set(['ADMISSION', 'EFFECT', 'CHECKPOINT']);
const READBACK_OBSERVATIONS = new Set(['committed', 'notobserved', 'unresolved']);

export class AdmissionRecordError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AdmissionRecordError';
    this.code = code;
  }
}

function fail(code) {
  throw new AdmissionRecordError(code);
}

function isPlainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readRecord(value, keys, code) {
  if (!isPlainRecord(value)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length
    || names.some(name => typeof name !== 'string' || !keys.includes(name))) {
    fail(code);
  }
  const out = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    out[key] = descriptor.value;
  }
  return out;
}

function readArray(value, code) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (!names.includes('length')
    || names.length !== value.length + 1
    || names.some(name => name !== 'length' && (typeof name !== 'string'
      || !/^(0|[1-9][0-9]*)$/.test(name)
      || Number(name) >= value.length))) {
    fail(code);
  }
  const out = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
    out.push(descriptor.value);
  }
  return out;
}

function validId(value) {
  return typeof value === 'string' && HEX64.test(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return value;
}

function normalizeGate(value, code) {
  if (value === null) return null;
  const gate = readRecord(value, ['logicalActionId', 'executionKey', 'admissionRevision'], code);
  if (!validId(gate.logicalActionId) || !validId(gate.executionKey)
    || !Number.isSafeInteger(gate.admissionRevision) || gate.admissionRevision < 1) {
    fail(code);
  }
  return gate;
}

function normalizeClaim(value, code) {
  const claim = readRecord(value, ['logicalActionId', 'executionKey', 'admissionRevision',
    'status', 'effectObserved', 'completion'], code);
  if (!validId(claim.logicalActionId) || !validId(claim.executionKey)
    || !Number.isSafeInteger(claim.admissionRevision) || claim.admissionRevision < 1
    || !CLAIM_STATUS.has(claim.status)
    || typeof claim.effectObserved !== 'boolean'
    || !COMPLETION_STATUS.has(claim.completion)) {
    fail(code);
  }
  return claim;
}

function normalizeReconciliation(value, code) {
  const reconciliation = readRecord(value, ['status', 'stage', 'logicalActionId', 'executionKey', 'observations'], code);
  if (!['CLEAR', 'UNKNOWN'].includes(reconciliation.status)) fail(code);
  const observations = readArray(reconciliation.observations, code);
  if (observations.length > MAX_READBACK_OBSERVATIONS) fail(code);
  for (const observation of observations) {
    if (!READBACK_OBSERVATIONS.has(observation)) fail(code);
  }
  if (reconciliation.status === 'CLEAR') {
    if (reconciliation.stage !== null || reconciliation.logicalActionId !== null
      || reconciliation.executionKey !== null || observations.length !== 0) {
      fail(code);
    }
  } else if (!UNKNOWN_STAGES.has(reconciliation.stage)
    || !validId(reconciliation.logicalActionId)
    || !validId(reconciliation.executionKey)) {
    fail(code);
  }
  return {
    status: reconciliation.status,
    stage: reconciliation.stage,
    logicalActionId: reconciliation.logicalActionId,
    executionKey: reconciliation.executionKey,
    observations
  };
}

function normalizeState(input) {
  const state = readRecord(input, [
    'enabled', 'revision', 'totalQuota', 'consumedQuota', 'activeGate', 'claims', 'reconciliation'
  ], 'STATE_INVALID');
  if (typeof state.enabled !== 'boolean'
    || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isSafeInteger(state.totalQuota) || state.totalQuota < 0
    || !Number.isSafeInteger(state.consumedQuota) || state.consumedQuota < 0
    || state.consumedQuota > state.totalQuota) {
    fail('STATE_INVALID');
  }
  const activeGate = normalizeGate(state.activeGate, 'STATE_INVALID');
  const reconciliation = normalizeReconciliation(state.reconciliation, 'STATE_INVALID');
  const claimsRaw = readArray(state.claims, 'STATE_INVALID');
  if (claimsRaw.length > MAX_RETAINED_CLAIMS) fail('STATE_INVALID');
  const claims = claimsRaw.map(value => normalizeClaim(value, 'STATE_INVALID'));
  const seenLogical = new Set();
  const seenExecution = new Set();
  for (const claim of claims) {
    if (seenLogical.has(claim.logicalActionId) || seenExecution.has(claim.executionKey)) fail('STATE_INVALID');
    seenLogical.add(claim.logicalActionId);
    seenExecution.add(claim.executionKey);
    if (claim.admissionRevision > state.revision) fail('STATE_INVALID');
    if (claim.status === 'ADMITTED') {
      if (claim.completion !== 'PENDING') fail('STATE_INVALID');
    } else if (claim.status === 'COMPLETED_UNACKED') {
      if (claim.effectObserved !== true || claim.completion !== 'UNACKNOWLEDGED') fail('STATE_INVALID');
    } else if (claim.status === 'COMPLETED_ACKED') {
      if (claim.effectObserved !== true || claim.completion !== 'ACKNOWLEDGED') fail('STATE_INVALID');
    } else if (claim.status === 'UNKNOWN') {
      if (!['PENDING', 'UNACKNOWLEDGED'].includes(claim.completion)) fail('STATE_INVALID');
      if (claim.completion === 'UNACKNOWLEDGED' && claim.effectObserved !== true) fail('STATE_INVALID');
    }
  }
  if (state.consumedQuota !== claims.length) fail('STATE_INVALID');
  const unresolvedClaims = claims.filter(claim => ['ADMITTED', 'COMPLETED_UNACKED', 'UNKNOWN'].includes(claim.status));
  if (activeGate === null && unresolvedClaims.length > 0) fail('STATE_INVALID');
  const unknownClaims = claims.filter(claim => claim.status === 'UNKNOWN');
  if (reconciliation.status === 'CLEAR') {
    if (unknownClaims.length > 0) fail('STATE_INVALID');
  } else {
    if (unknownClaims.length !== 1) fail('STATE_INVALID');
    if (activeGate === null) fail('STATE_INVALID');
    const unknownClaim = unknownClaims[0];
    if (unknownClaim.logicalActionId !== reconciliation.logicalActionId
      || unknownClaim.executionKey !== reconciliation.executionKey) {
      fail('STATE_INVALID');
    }
    if (activeGate.logicalActionId !== reconciliation.logicalActionId
      || activeGate.executionKey !== reconciliation.executionKey
      || activeGate.admissionRevision !== unknownClaim.admissionRevision) {
      fail('STATE_INVALID');
    }
  }
  if (activeGate !== null) {
    if (unresolvedClaims.length !== 1) fail('STATE_INVALID');
    const matched = claims.find(claim => claim.logicalActionId === activeGate.logicalActionId
      && claim.executionKey === activeGate.executionKey
      && claim.admissionRevision === activeGate.admissionRevision);
    if (!matched) fail('STATE_INVALID');
    if (!['ADMITTED', 'COMPLETED_UNACKED', 'UNKNOWN'].includes(matched.status)) fail('STATE_INVALID');
    if (unresolvedClaims[0] !== matched) fail('STATE_INVALID');
    if (claims.some(claim => claim !== matched && claim.status !== 'COMPLETED_ACKED')) fail('STATE_INVALID');
  }
  if (activeGate === null && claims.some(claim => claim.status === 'UNKNOWN')) fail('STATE_INVALID');
  return deepFreeze({
    enabled: state.enabled,
    revision: state.revision,
    totalQuota: state.totalQuota,
    consumedQuota: state.consumedQuota,
    activeGate,
    claims,
    reconciliation
  });
}

function normalizeEvent(input) {
  if (!isPlainRecord(input)) fail('EVENT_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (!Object.hasOwn(descriptors, 'kind')) fail('EVENT_INVALID');
  if (!descriptors.kind.enumerable || !Object.hasOwn(descriptors.kind, 'value')) fail('EVENT_INVALID');
  const kind = descriptors.kind.value;
  if (kind === 'SIMULATE_ADMISSION') {
    const event = readRecord(input, ['kind', 'expectedRevision', 'expectedTotalQuota', 'logicalActionId', 'executionKey'], 'EVENT_INVALID');
    if (!Number.isSafeInteger(event.expectedRevision) || event.expectedRevision < 0
      || !Number.isSafeInteger(event.expectedTotalQuota) || event.expectedTotalQuota < 0
      || !validId(event.logicalActionId) || !validId(event.executionKey)) {
      fail('EVENT_INVALID');
    }
    return event;
  }
  if (kind === 'EFFECT_OBSERVED') {
    const event = readRecord(input, ['kind', 'logicalActionId', 'executionKey', 'admissionRevision'], 'EVENT_INVALID');
    if (!validId(event.logicalActionId) || !validId(event.executionKey)
      || !Number.isSafeInteger(event.admissionRevision) || event.admissionRevision < 1) {
      fail('EVENT_INVALID');
    }
    return event;
  }
  if (kind === 'TERMINAL_COMPLETION') {
    const event = readRecord(input, ['kind', 'evidence'], 'EVENT_INVALID');
    const evidence = readRecord(event.evidence,
      ['logicalActionId', 'executionKey', 'admissionRevision', 'effect', 'checkpointAcknowledged'],
      'EVENT_INVALID');
    if (!validId(evidence.logicalActionId) || !validId(evidence.executionKey)
      || !Number.isSafeInteger(evidence.admissionRevision) || evidence.admissionRevision < 1
      || evidence.effect !== 'COMPLETED' || typeof evidence.checkpointAcknowledged !== 'boolean') {
      fail('EVENT_INVALID');
    }
    return {kind, evidence};
  }
  if (kind === 'MARK_UNKNOWN') {
    const event = readRecord(input, ['kind', 'logicalActionId', 'executionKey', 'stage'], 'EVENT_INVALID');
    if (!validId(event.logicalActionId) || !validId(event.executionKey)
      || !UNKNOWN_STAGES.has(event.stage)) {
      fail('EVENT_INVALID');
    }
    return event;
  }
  if (kind === 'READBACK_OBSERVATION') {
    const event = readRecord(input, ['kind', 'logicalActionId', 'executionKey', 'observation'], 'EVENT_INVALID');
    if (!validId(event.logicalActionId) || !validId(event.executionKey)
      || !READBACK_OBSERVATIONS.has(event.observation)) {
      fail('EVENT_INVALID');
    }
    return event;
  }
  fail('EVENT_INVALID');
}

function cloneState(state) {
  return {
    enabled: state.enabled,
    revision: state.revision,
    totalQuota: state.totalQuota,
    consumedQuota: state.consumedQuota,
    activeGate: state.activeGate ? {...state.activeGate} : null,
    claims: state.claims.map(claim => ({...claim})),
    reconciliation: {
      status: state.reconciliation.status,
      stage: state.reconciliation.stage,
      logicalActionId: state.reconciliation.logicalActionId,
      executionKey: state.reconciliation.executionKey,
      observations: [...state.reconciliation.observations]
    }
  };
}

function noAuthorityFields() {
  return {
    dispatchAllowed: false,
    mergeAllowed: false,
    activationAllowed: false,
    externalEffects: false,
    retryAllowed: false
  };
}

function blocked(state, reason) {
  return deepFreeze({
    status: 'BLOCKED',
    reason,
    changed: false,
    state,
    ...noAuthorityFields()
  });
}

function claimIndexByLogicalAction(state, logicalActionId) {
  return state.claims.findIndex(claim => claim.logicalActionId === logicalActionId);
}

function claimIndexByExecutionKey(state, executionKey) {
  return state.claims.findIndex(claim => claim.executionKey === executionKey);
}

function exactIdentityMatch(claim, identity) {
  return claim && claim.logicalActionId === identity.logicalActionId
    && claim.executionKey === identity.executionKey
    && claim.admissionRevision === identity.admissionRevision;
}

function nextRevisionAvailable(state) {
  return state.revision < Number.MAX_SAFE_INTEGER;
}

function finalize(state, status, reason, changed) {
  return deepFreeze({
    status,
    reason,
    changed,
    state: normalizeState(state),
    ...noAuthorityFields()
  });
}

export function createAdmissionRecordState(options = {}) {
  if (!isPlainRecord(options)) fail('INITIAL_STATE_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const names = Reflect.ownKeys(descriptors);
  const allowed = new Set(['enabled', 'totalQuota']);
  if (names.some(name => typeof name !== 'string' || !allowed.has(name))) fail('INITIAL_STATE_INVALID');
  if ((Object.hasOwn(descriptors, 'enabled')
    && (!descriptors.enabled.enumerable || !Object.hasOwn(descriptors.enabled, 'value')))
    || (Object.hasOwn(descriptors, 'totalQuota')
      && (!descriptors.totalQuota.enumerable || !Object.hasOwn(descriptors.totalQuota, 'value')))) {
    fail('INITIAL_STATE_INVALID');
  }
  const envelope = {
    enabled: Object.hasOwn(descriptors, 'enabled') ? descriptors.enabled.value : false,
    totalQuota: Object.hasOwn(descriptors, 'totalQuota') ? descriptors.totalQuota.value : 0
  };
  if (typeof envelope.enabled !== 'boolean'
    || !Number.isSafeInteger(envelope.totalQuota) || envelope.totalQuota < 0) {
    fail('INITIAL_STATE_INVALID');
  }
  return deepFreeze({
    enabled: envelope.enabled,
    revision: 0,
    totalQuota: envelope.totalQuota,
    consumedQuota: 0,
    activeGate: null,
    claims: [],
    reconciliation: {
      status: 'CLEAR',
      stage: null,
      logicalActionId: null,
      executionKey: null,
      observations: []
    }
  });
}

export function reduceAdmissionRecord(inputState, inputEvent) {
  const state = normalizeState(inputState);
  const event = normalizeEvent(inputEvent);

  if (event.kind === 'SIMULATE_ADMISSION') {
    if (!state.enabled) return blocked(state, 'DISABLED');
    if (state.reconciliation.status === 'UNKNOWN') return blocked(state, 'UNKNOWN_LATCHED');
    if (event.expectedRevision !== state.revision) return blocked(state, 'STALE_REVISION');
    if (event.expectedTotalQuota !== state.totalQuota) return blocked(state, 'TOTAL_QUOTA_MISMATCH');
    if (state.activeGate !== null) return blocked(state, 'ACTIVE_GATE_HELD');
    if (!nextRevisionAvailable(state)) return blocked(state, 'REVISION_EXHAUSTED');
    if (claimIndexByLogicalAction(state, event.logicalActionId) !== -1) {
      return blocked(state, 'DUPLICATE_LOGICAL_ACTION');
    }
    if (claimIndexByExecutionKey(state, event.executionKey) !== -1) {
      return blocked(state, 'DUPLICATE_EXECUTION_KEY');
    }
    if (state.claims.length >= MAX_RETAINED_CLAIMS) return blocked(state, 'CLAIM_RETENTION_LIMIT');
    if (state.consumedQuota >= state.totalQuota) return blocked(state, 'QUOTA_EXHAUSTED');

    const next = cloneState(state);
    next.revision += 1;
    next.consumedQuota += 1;
    const claim = {
      logicalActionId: event.logicalActionId,
      executionKey: event.executionKey,
      admissionRevision: next.revision,
      status: 'ADMITTED',
      effectObserved: false,
      completion: 'PENDING'
    };
    next.claims.push(claim);
    next.activeGate = {
      logicalActionId: claim.logicalActionId,
      executionKey: claim.executionKey,
      admissionRevision: claim.admissionRevision
    };

    return finalize(next, 'ADMITTED', 'SIMULATED_ATOMIC_ADMISSION', true);
  }

  if (event.kind === 'EFFECT_OBSERVED') {
    if (state.reconciliation.status === 'UNKNOWN') return blocked(state, 'UNKNOWN_LATCHED');
    if (!state.activeGate) return blocked(state, 'NO_ACTIVE_GATE');
    if (!nextRevisionAvailable(state)) return blocked(state, 'REVISION_EXHAUSTED');
    if (!exactIdentityMatch(state.activeGate, event)) return blocked(state, 'ACTIVE_GATE_MISMATCH');
    const index = claimIndexByLogicalAction(state, event.logicalActionId);
    if (index < 0) return blocked(state, 'CLAIM_NOT_FOUND');
    const claim = state.claims[index];
    if (!exactIdentityMatch(claim, event)) return blocked(state, 'CLAIM_IDENTITY_MISMATCH');
    if (claim.effectObserved) return blocked(state, 'EFFECT_ALREADY_RECORDED');

    const next = cloneState(state);
    next.revision += 1;
    next.claims[index].effectObserved = true;

    return finalize(next, 'RECORDED', 'EFFECT_OBSERVED', true);
  }

  if (event.kind === 'TERMINAL_COMPLETION') {
    if (state.reconciliation.status === 'UNKNOWN') return blocked(state, 'UNKNOWN_LATCHED');
    if (!state.activeGate) return blocked(state, 'NO_ACTIVE_GATE');
    if (!nextRevisionAvailable(state)) return blocked(state, 'REVISION_EXHAUSTED');
    if (!exactIdentityMatch(state.activeGate, event.evidence)) return blocked(state, 'ACTIVE_GATE_MISMATCH');
    const index = claimIndexByLogicalAction(state, event.evidence.logicalActionId);
    if (index < 0) return blocked(state, 'CLAIM_NOT_FOUND');
    const claim = state.claims[index];
    if (!exactIdentityMatch(claim, event.evidence)) return blocked(state, 'CLAIM_IDENTITY_MISMATCH');
    if (!claim.effectObserved) return blocked(state, 'EFFECT_NOT_OBSERVED');
    if (claim.completion !== 'PENDING') return blocked(state, 'TERMINAL_ALREADY_RECORDED');

    const next = cloneState(state);
    next.revision += 1;
    next.claims[index].completion = event.evidence.checkpointAcknowledged ? 'ACKNOWLEDGED' : 'UNACKNOWLEDGED';
    next.claims[index].status = event.evidence.checkpointAcknowledged ? 'COMPLETED_ACKED' : 'COMPLETED_UNACKED';
    if (event.evidence.checkpointAcknowledged) next.activeGate = null;

    return finalize(next, 'RECORDED',
      event.evidence.checkpointAcknowledged ? 'TERMINAL_ACKNOWLEDGED' : 'TERMINAL_UNACKNOWLEDGED', true);
  }

  if (event.kind === 'MARK_UNKNOWN') {
    if (state.reconciliation.status === 'UNKNOWN') return blocked(state, 'UNKNOWN_ALREADY_LATCHED');
    if (!nextRevisionAvailable(state)) return blocked(state, 'REVISION_EXHAUSTED');
    if (!state.activeGate) return blocked(state, 'NO_ACTIVE_GATE');
    const index = claimIndexByLogicalAction(state, event.logicalActionId);
    if (index < 0) return blocked(state, 'CLAIM_NOT_FOUND');
    const claim = state.claims[index];
    if (claim.executionKey !== event.executionKey) return blocked(state, 'CLAIM_IDENTITY_MISMATCH');
    if (!exactIdentityMatch(state.activeGate, claim)) return blocked(state, 'ACTIVE_GATE_MISMATCH');
    if (claim.status === 'COMPLETED_ACKED') return blocked(state, 'CLAIM_ALREADY_RELEASED');

    const next = cloneState(state);
    next.revision += 1;
    next.claims[index].status = 'UNKNOWN';
    next.reconciliation = {
      status: 'UNKNOWN',
      stage: event.stage,
      logicalActionId: event.logicalActionId,
      executionKey: event.executionKey,
      observations: []
    };

    return finalize(next, 'UNKNOWN', `${event.stage}_OUTCOME_UNKNOWN`, true);
  }

  if (state.reconciliation.status !== 'UNKNOWN') return blocked(state, 'NO_UNKNOWN_LATCH');
  if (event.logicalActionId !== state.reconciliation.logicalActionId
    || event.executionKey !== state.reconciliation.executionKey) {
    return blocked(state, 'RECONCILIATION_IDENTITY_MISMATCH');
  }
  if (!nextRevisionAvailable(state)) return blocked(state, 'REVISION_EXHAUSTED');
  if (state.reconciliation.observations.length >= MAX_READBACK_OBSERVATIONS) {
    return blocked(state, 'READBACK_OBSERVATION_LIMIT');
  }

  const next = cloneState(state);
  next.revision += 1;
  next.reconciliation.observations.push(event.observation);

  return finalize(next, 'UNKNOWN', 'UNKNOWN_ANNOTATED', true);
}

export const ADMISSION_RECORD_LIMITS = Object.freeze({
  MAX_RETAINED_CLAIMS,
  MAX_READBACK_OBSERVATIONS
});
