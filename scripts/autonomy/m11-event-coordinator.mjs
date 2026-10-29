import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {types} from 'node:util';

export const DEFAULT_LIMITS = Object.freeze({
  events: 96,
  transitions: 24,
  eventBytes: 4096,
  replayBytes: 65536,
  runtimeMs: 10000
});

export const REQUIRED_REVIEW_PARTS = Object.freeze([
  'scope',
  'changed-files',
  'implementation',
  'tests',
  'security',
  'authority-boundaries'
]);

export const REQUIRED_POSTCHECKS = Object.freeze([
  'release-safety',
  'runtime-smoke',
  'release-coordinator',
  'pages'
]);

const REPOSITORY = 'Achi1984/meridian';
const RELEASE_SAFETY_WORKFLOW_ID = 347821227;
export const SYNTHETIC_POSTCHECK_WORKFLOW_IDS = Object.freeze({
  'release-safety': 901,
  'runtime-smoke': 902,
  'release-coordinator': 903,
  pages: 904
});
const PHASES = ['AUTHOR', 'CI', 'REVIEW', 'OWNER_MERGE', 'POSTCHECK', 'COMPLETE', 'RECONCILE', 'BLOCKED', 'EXPIRED'];
const VERDICTS = ['GREEN_LIGHT', 'REVISION_REQUIRED', 'NEEDS_MORE_EVIDENCE'];
const ACTORS = Object.freeze({
  AUTHOR_DELIVERY: ['Copilot', 'copilot-swe-agent[bot]'],
  CI: ['github-actions[bot]'],
  REVIEW_PART: ['claude[bot]'],
  HEAD_MOVED: ['Achi1984', 'Copilot', 'github-actions[bot]'],
  SOURCE_MERGED: ['Achi1984', 'web-flow'],
  POSTCHECK: ['github-actions[bot]'],
  MUTATION_UNKNOWN: ['coordinator-sim'],
  RECONCILED: ['Achi1984', 'coordinator-sim'],
  AGENT_OPERATION: ['coordinator-sim']
});
const EVENT_FIELDS = Object.freeze({
  AUTHOR_DELIVERY: ['status'],
  CI: ['status', 'completed', 'runId', 'runAttempt', 'workflowId', 'selectionRevision',
    'currentRunId', 'currentRunAttempt'],
  REVIEW_PART: ['reviewId', 'coverageParts', 'complete', 'verdict', 'truncated', 'turnLimit',
    'ciRunId', 'ciRunAttempt', 'ciWorkflowId'],
  HEAD_MOVED: ['newHeadSha', 'newBaseSha'],
  SOURCE_MERGED: ['mergeSha'],
  POSTCHECK: ['check', 'status', 'mergeSha', 'runId', 'runAttempt', 'workflowId',
    'selectionRevision', 'currentRunId', 'currentRunAttempt'],
  MUTATION_UNKNOWN: ['operationId'],
  RECONCILED: ['operationId', 'outcome'],
  AGENT_OPERATION: ['operation']
});
const COMMON_FIELDS = ['eventId', 'repository', 'pullRequest', 'headSha', 'baseSha', 'phase', 'actor', 'type', 'occurredAt'];
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const validString = value => typeof value === 'string' && value.isWellFormed();
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export class CoordinatorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CoordinatorError';
    this.code = code;
  }
}

const need = (condition, code) => {
  if (!condition) throw new CoordinatorError(code);
};

function readRecord(value, keys, code = 'INVALID_SCHEMA') {
  need(value !== null && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype, code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  need(names.length === keys.length && names.every(key => typeof key === 'string' && keys.includes(key)), code);
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, code);
    result[key] = descriptor.value;
  }
  return result;
}

function readStringArray(value, allowed, code) {
  need(Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= allowed.length, code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  need(names.length === value.length + 1 && names.every(key => key === 'length'
    || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)), code);
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, code);
    const item = descriptor.value;
    need(typeof item === 'string' && allowed.includes(item) && !result.includes(item), code);
    result.push(item);
  }
  return result;
}

function cloneData(value, depth = 0, budget = {nodes: 2048}) {
  need(--budget.nodes >= 0 && depth <= 8, 'STATE_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    need(validString(value) && Buffer.byteLength(value, 'utf8') <= 1024, 'STATE_LIMIT');
    return value;
  }
  if (typeof value === 'number') {
    need(Number.isSafeInteger(value), 'STATE_INVALID');
    return value;
  }
  need(value !== null && typeof value === 'object' && !types.isProxy(value), 'STATE_INVALID');
  const array = Array.isArray(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), 'STATE_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (array) {
    need(value.length <= 2048 && names.length === value.length + 1
      && names.every(key => key === 'length' || (typeof key === 'string'
        && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)), 'STATE_INVALID');
  }
  const result = array ? [] : {};
  for (const key of names) {
    if (array && key === 'length') continue;
    need(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'STATE_INVALID');
    const descriptor = descriptors[key];
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'STATE_INVALID');
    result[key] = cloneData(descriptor.value, depth + 1, budget);
  }
  return result;
}

function validateIdentity(repository, pullRequest, headSha, baseSha) {
  need(repository === REPOSITORY, 'REPOSITORY_MISMATCH');
  need(positive(pullRequest), 'INVALID_PR_NUMBER');
  need(sha(headSha) && sha(baseSha) && headSha !== baseSha, 'INVALID_SHA');
}

function currentRunDisposition(previous, event) {
  if (!previous) return null;
  const sameRun = previous.runId === event.runId;
  const incomingStatus = event.status.toUpperCase();
  if (sameRun && event.runAttempt < previous.runAttempt) return 'STALE_RUN_ATTEMPT';
  if (sameRun && event.runAttempt > previous.runAttempt) {
    return event.selectionRevision > previous.selectionRevision ? null : 'STALE_RUN_ATTEMPT';
  }
  if (!sameRun) {
    if (event.selectionRevision < previous.selectionRevision) return 'STALE_RUN_SELECTION';
    need(event.selectionRevision > previous.selectionRevision, 'CURRENT_RUN_SELECTION_CONFLICT');
    return null;
  }
  if (event.selectionRevision < previous.selectionRevision) return 'STALE_RUN_SELECTION';
  need(event.selectionRevision === previous.selectionRevision, 'CURRENT_RUN_SELECTION_CONFLICT');
  if (previous.status === incomingStatus) return 'UNCHANGED_RUN';
  if (previous.status !== 'PENDING' && incomingStatus === 'PENDING') return 'STALE_PENDING_AFTER_TERMINAL';
  if (previous.status === 'PENDING' && incomingStatus !== 'PENDING') return null;
  throw new CoordinatorError('RUN_RESULT_CONFLICT');
}

function ciCorrectionCause(ci) {
  return `ci:${ci.workflowId}:${ci.runId}:${ci.runAttempt}:${ci.selectionRevision}`;
}

function reviewCorrectionCause(ci, reviewId) {
  return `review:${ciCorrectionCause(ci)}:${reviewId}`;
}

export function createCoordinatorState({
  repository = REPOSITORY, pullRequest, headSha, baseSha, startsAt, expiresAt, wipCount = 1,
  requiredPostchecks = [...REQUIRED_POSTCHECKS], postcheckWorkflowIds
}) {
  validateIdentity(repository, pullRequest, headSha, baseSha);
  need(Number.isSafeInteger(startsAt) && Number.isSafeInteger(expiresAt)
    && startsAt > 0 && expiresAt > startsAt && expiresAt - startsAt <= 86400000, 'INVALID_WINDOW');
  need(Number.isSafeInteger(wipCount) && wipCount > 0 && wipCount <= 3, 'WIP_LIMIT_EXCEEDED');
  requiredPostchecks = readStringArray(requiredPostchecks, REQUIRED_POSTCHECKS, 'INVALID_REQUIRED_POSTCHECKS');
  need(requiredPostchecks.length > 0, 'INVALID_REQUIRED_POSTCHECKS');
  postcheckWorkflowIds = readRecord(postcheckWorkflowIds, requiredPostchecks, 'INVALID_POSTCHECK_WORKFLOW_MAP');
  for (const workflowId of Object.values(postcheckWorkflowIds)) need(positive(workflowId), 'INVALID_POSTCHECK_WORKFLOW_MAP');
  return freeze({
    schemaVersion: 2,
    repository,
    pullRequest,
    headSha,
    baseSha,
    wipCount,
    wipLimit: 3,
    maxConcurrentWriters: 1,
    requiredPostchecks,
    postcheckWorkflowIds,
    startsAt,
    expiresAt,
    phase: 'AUTHOR',
    authorDelivery: 'PENDING',
    ci: null,
    review: {status: 'NONE', reviewId: null, coverageParts: [], verdict: null, truncated: false, turnLimit: false},
    mergeSha: null,
    postchecks: Object.fromEntries(REQUIRED_POSTCHECKS.map(check => [check, null])),
    correctionCauses: [],
    mutationLane: {status: 'CLEAR', operationId: null, resumePhase: null},
    mutationHistory: [],
    processedEvents: [],
    eventCount: 0,
    transitionCount: 0,
    nextAllowedAction: 'WAIT_FOR_AUTHOR_DELIVERY'
  });
}

function validateState(input) {
  const state = cloneData(input);
  const keys = [
    'schemaVersion', 'repository', 'pullRequest', 'headSha', 'baseSha', 'wipCount', 'wipLimit',
    'maxConcurrentWriters', 'requiredPostchecks', 'postcheckWorkflowIds', 'startsAt', 'expiresAt',
    'phase', 'authorDelivery', 'ci', 'review', 'mergeSha', 'postchecks', 'correctionCauses',
    'mutationLane', 'mutationHistory', 'processedEvents', 'eventCount', 'transitionCount', 'nextAllowedAction'
  ];
  need(Object.keys(state).length === keys.length && keys.every(key => Object.hasOwn(state, key)), 'STATE_SCHEMA');
  validateIdentity(state.repository, state.pullRequest, state.headSha, state.baseSha);
  need(state.schemaVersion === 2 && Number.isSafeInteger(state.startsAt) && Number.isSafeInteger(state.expiresAt)
    && state.startsAt > 0 && state.expiresAt > state.startsAt && state.expiresAt - state.startsAt <= 86400000, 'STATE_INVALID');
  need(Number.isSafeInteger(state.wipCount) && state.wipCount > 0 && state.wipCount <= 3
    && state.wipLimit === 3 && state.maxConcurrentWriters === 1, 'WIP_OR_WRITER_LIMIT');
  state.requiredPostchecks = readStringArray(state.requiredPostchecks, REQUIRED_POSTCHECKS, 'STATE_INVALID');
  need(state.requiredPostchecks.length > 0, 'STATE_INVALID');
  const postcheckWorkflowIds = readRecord(state.postcheckWorkflowIds, state.requiredPostchecks, 'STATE_INVALID');
  for (const workflowId of Object.values(postcheckWorkflowIds)) need(positive(workflowId), 'STATE_INVALID');
  state.postcheckWorkflowIds = postcheckWorkflowIds;
  need(PHASES.includes(state.phase) && ['PENDING', 'DELIVERED', 'FAILED'].includes(state.authorDelivery)
    && Array.isArray(state.correctionCauses) && state.correctionCauses.length <= DEFAULT_LIMITS.transitions
    && state.correctionCauses.every(cause => typeof cause === 'string' && cause.length <= 256)
    && new Set(state.correctionCauses).size === state.correctionCauses.length
    && Number.isSafeInteger(state.eventCount)
    && state.eventCount >= 0 && state.eventCount <= DEFAULT_LIMITS.events
    && Number.isSafeInteger(state.transitionCount) && state.transitionCount >= 0
    && state.transitionCount <= DEFAULT_LIMITS.transitions, 'STATE_INVALID');
  need(typeof state.nextAllowedAction === 'string', 'STATE_INVALID');
  if (state.ci !== null) {
    readRecord(state.ci, ['runId', 'runAttempt', 'workflowId', 'selectionRevision', 'status']);
    need(positive(state.ci.runId) && positive(state.ci.runAttempt) && state.ci.workflowId === RELEASE_SAFETY_WORKFLOW_ID
      && positive(state.ci.selectionRevision)
      && ['PENDING', 'SUCCESS', 'FAILURE', 'ACTION_REQUIRED'].includes(state.ci.status), 'STATE_INVALID');
  }
  readRecord(state.review, ['status', 'reviewId', 'coverageParts', 'verdict', 'truncated', 'turnLimit']);
  need(['NONE', 'INCOMPLETE', 'COMPLETE'].includes(state.review.status)
    && (state.review.reviewId === null
      || (typeof state.review.reviewId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(state.review.reviewId)))
    && (state.review.verdict === null || VERDICTS.includes(state.review.verdict))
    && typeof state.review.truncated === 'boolean' && typeof state.review.turnLimit === 'boolean', 'STATE_INVALID');
  state.review.coverageParts = readStringArray(state.review.coverageParts, REQUIRED_REVIEW_PARTS, 'STATE_INVALID');
  need((state.review.status === 'NONE') === (state.review.reviewId === null), 'STATE_INVALID');
  if (state.review.status === 'COMPLETE') {
    need(REQUIRED_REVIEW_PARTS.every(part => state.review.coverageParts.includes(part))
      && ['GREEN_LIGHT', 'REVISION_REQUIRED'].includes(state.review.verdict)
      && !state.review.truncated && !state.review.turnLimit, 'STATE_INVALID');
  }
  need(state.mergeSha === null || sha(state.mergeSha), 'STATE_INVALID');
  const postchecks = readRecord(state.postchecks, REQUIRED_POSTCHECKS, 'STATE_INVALID');
  for (const [check, item] of Object.entries(postchecks)) {
    if (item !== null) {
      readRecord(item, ['runId', 'runAttempt', 'workflowId', 'selectionRevision', 'mergeSha', 'status']);
      need(state.requiredPostchecks.includes(check)
        && positive(item.runId) && positive(item.runAttempt)
        && item.workflowId === state.postcheckWorkflowIds[check]
        && positive(item.selectionRevision)
        && item.mergeSha === state.mergeSha && ['PENDING', 'SUCCESS', 'FAILURE'].includes(item.status), 'STATE_INVALID');
    }
  }
  state.postchecks = postchecks;
  readRecord(state.mutationLane, ['status', 'operationId', 'resumePhase'], 'STATE_INVALID');
  need(['CLEAR', 'UNKNOWN', 'RECONCILED'].includes(state.mutationLane.status)
    && (state.mutationLane.operationId === null || /^[A-Za-z0-9._:-]{3,128}$/.test(state.mutationLane.operationId))
    && (state.mutationLane.resumePhase === null || ['AUTHOR', 'CI', 'REVIEW', 'OWNER_MERGE', 'POSTCHECK'].includes(state.mutationLane.resumePhase)), 'STATE_INVALID');
  need(Array.isArray(state.mutationHistory) && state.mutationHistory.length <= DEFAULT_LIMITS.transitions, 'STATE_INVALID');
  const operationIds = new Set();
  for (const item of state.mutationHistory) {
    readRecord(item, ['operationId', 'status', 'outcome'], 'STATE_INVALID');
    need(/^[A-Za-z0-9._:-]{3,128}$/.test(item.operationId) && !operationIds.has(item.operationId)
      && ['UNKNOWN', 'RECONCILED'].includes(item.status)
      && (item.outcome === null || ['not_applied', 'applied', 'ambiguous'].includes(item.outcome)), 'STATE_INVALID');
    operationIds.add(item.operationId);
  }
  need(Array.isArray(state.processedEvents) && state.processedEvents.length <= DEFAULT_LIMITS.events, 'STATE_INVALID');
  for (const item of state.processedEvents) {
    readRecord(item, ['key', 'digest'], 'STATE_INVALID');
    need(typeof item.key === 'string' && /^[a-f0-9]{64}$/.test(item.digest), 'STATE_INVALID');
  }
  if (state.ci === null) need(['AUTHOR', 'CI', 'RECONCILE', 'EXPIRED', 'BLOCKED'].includes(state.phase), 'STATE_INVALID');
  if (state.phase === 'COMPLETE') {
    need(state.mergeSha !== null && state.requiredPostchecks.every(check => state.postchecks[check]?.status === 'SUCCESS'), 'STATE_INVALID');
  }
  if (state.mutationLane.status === 'UNKNOWN') need(['RECONCILE', 'EXPIRED'].includes(state.phase), 'STATE_INVALID');
  return state;
}

function normalizeEvent(input) {
  need(input !== null && typeof input === 'object' && !Array.isArray(input) && !types.isProxy(input)
    && Object.getPrototypeOf(input) === Object.prototype, 'INVALID_EVENT');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const typeDescriptor = descriptors.type;
  need(typeDescriptor && Object.hasOwn(typeDescriptor, 'value') && typeDescriptor.enumerable
    && typeof typeDescriptor.value === 'string', 'INVALID_EVENT');
  const type = typeDescriptor.value;
  need(Object.hasOwn(EVENT_FIELDS, type), 'UNSUPPORTED_EVENT_TYPE');
  const keys = [...COMMON_FIELDS, ...EVENT_FIELDS[type]];
  const event = readRecord(input, keys, 'INVALID_EVENT_SCHEMA');
  validateIdentity(event.repository, event.pullRequest, event.headSha, event.baseSha);
  need(typeof event.eventId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(event.eventId)
    && PHASES.includes(event.phase) && Number.isSafeInteger(event.occurredAt) && event.occurredAt > 0, 'INVALID_EVENT_IDENTITY');
  need(ACTORS[type].includes(event.actor), 'FORGED_ACTOR');
  if (type === 'AUTHOR_DELIVERY') need(['delivered', 'failed'].includes(event.status), 'INVALID_AUTHOR_STATUS');
  if (type === 'CI') {
    need(['pending', 'success', 'failure', 'action_required'].includes(event.status)
      && typeof event.completed === 'boolean' && (event.status === 'pending' ? !event.completed : event.completed)
      && positive(event.runId) && positive(event.runAttempt) && event.workflowId === RELEASE_SAFETY_WORKFLOW_ID
      && positive(event.selectionRevision) && event.currentRunId === event.runId
      && event.currentRunAttempt === event.runAttempt, 'INVALID_CI_EVENT');
  }
  if (type === 'REVIEW_PART') {
    event.coverageParts = readStringArray(event.coverageParts, REQUIRED_REVIEW_PARTS, 'INVALID_REVIEW_COVERAGE');
    need(typeof event.reviewId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(event.reviewId)
      && typeof event.complete === 'boolean' && typeof event.truncated === 'boolean' && typeof event.turnLimit === 'boolean'
      && VERDICTS.includes(event.verdict) && positive(event.ciRunId) && positive(event.ciRunAttempt)
      && event.ciWorkflowId === RELEASE_SAFETY_WORKFLOW_ID, 'INVALID_REVIEW_EVENT');
  }
  if (type === 'HEAD_MOVED') need(sha(event.newHeadSha) && sha(event.newBaseSha)
    && event.newHeadSha !== event.newBaseSha, 'INVALID_MOVED_SCOPE');
  if (type === 'SOURCE_MERGED') need(sha(event.mergeSha), 'INVALID_MERGE_EVENT');
  if (type === 'POSTCHECK') need(REQUIRED_POSTCHECKS.includes(event.check)
    && ['pending', 'success', 'failure'].includes(event.status) && sha(event.mergeSha)
    && positive(event.runId) && positive(event.runAttempt) && positive(event.workflowId)
    && positive(event.selectionRevision) && event.currentRunId === event.runId
    && event.currentRunAttempt === event.runAttempt, 'INVALID_POSTCHECK_EVENT');
  if (type === 'MUTATION_UNKNOWN' || type === 'RECONCILED') {
    need(typeof event.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(event.operationId), 'INVALID_OPERATION_ID');
  }
  if (type === 'RECONCILED') need(['not_applied', 'applied', 'ambiguous'].includes(event.outcome), 'INVALID_RECONCILIATION');
  if (type === 'AGENT_OPERATION') need(['copilot_assignment', 'claude_review_dispatch',
    'action_required_approval', 'auto_merge', 'deployment'].includes(event.operation), 'UNSUPPORTED_OPERATION');
  const serialized = JSON.stringify(event);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  need(bytes <= DEFAULT_LIMITS.eventBytes, 'EVENT_BYTE_LIMIT');
  return {event, bytes};
}

function setNextAction(state) {
  if (state.phase === 'EXPIRED') return 'STOP_EXPIRED';
  if (state.phase === 'BLOCKED') return 'STOP_UNSUPPORTED_AGENT_OPERATION';
  if (state.mutationLane.status === 'UNKNOWN') return 'RECONCILE_UNKNOWN_MUTATION';
  if (state.phase === 'AUTHOR') return 'WAIT_FOR_AUTHOR_DELIVERY';
  if (state.phase === 'CI') {
    if (state.ci?.status === 'FAILURE') return state.correctionCauses.includes(ciCorrectionCause(state.ci))
      ? 'WAIT_FOR_CONSOLIDATED_CORRECTION' : 'REQUEST_ONE_CONSOLIDATED_CORRECTION';
    if (state.ci?.status === 'ACTION_REQUIRED') return 'WAIT_FOR_OWNER_CI_ACTION';
    return 'WAIT_FOR_CI';
  }
  if (state.phase === 'REVIEW') {
    if (state.review.status === 'COMPLETE' && state.review.verdict === 'REVISION_REQUIRED') {
      return state.correctionCauses.includes(reviewCorrectionCause(state.ci, state.review.reviewId))
        ? 'WAIT_FOR_CONSOLIDATED_CORRECTION' : 'REQUEST_ONE_CONSOLIDATED_CORRECTION';
    }
    return state.review.status === 'NONE' ? 'REQUEST_EXACT_PAIR_REVIEW' : 'REQUEST_REVIEW_COMPLETION';
  }
  if (state.phase === 'OWNER_MERGE') return 'WAIT_FOR_OWNER_MERGE';
  if (state.phase === 'POSTCHECK') {
    if (Object.values(state.postchecks).some(check => check?.status === 'FAILURE')) return 'STOP_POSTCHECK_FAILURE';
    return 'WAIT_FOR_POSTCHECKS';
  }
  if (state.phase === 'COMPLETE') return 'COMPLETE';
  if (state.phase === 'RECONCILE') return 'RECONCILE_UNKNOWN_MUTATION';
  return 'STOP';
}

function scopeKey(state, event) {
  return [event.repository, event.pullRequest, event.headSha, event.baseSha, event.phase, event.eventId].join('|');
}

function result(state, changed, reason) {
  const actionDedupeKey = createHash('sha256')
    .update([state.repository, state.pullRequest, state.headSha, state.baseSha, state.phase].join('|'))
    .digest('hex');
  return freeze({
    state: freeze(state),
    changed,
    reason,
    actionDedupeKey,
    authenticated: false,
    provenanceVerified: false,
    authorized: false,
    dispatchAllowed: false,
    mergeAllowed: false,
    activationAllowed: false,
    runtimeTradingAuthority: false,
    externalEffects: false
  });
}

export function reduceEvent(inputState, inputEvent) {
  const old = validateState(inputState);
  const {event} = normalizeEvent(inputEvent);
  if (event.repository !== old.repository) throw new CoordinatorError('REPOSITORY_MISMATCH');
  if (event.pullRequest !== old.pullRequest) return result(old, false, 'STALE_PR');
  if (event.headSha !== old.headSha || event.baseSha !== old.baseSha) return result(old, false, 'STALE_HEAD_OR_BASE');
  if (event.occurredAt < old.startsAt) return result(old, false, 'NOT_STARTED');
  if (event.occurredAt >= old.expiresAt) {
    if (old.phase === 'EXPIRED') return result(old, false, 'EXPIRED_NOOP');
    const expired = {...old, phase: 'EXPIRED', ci: null,
      review: {status: 'NONE', reviewId: null, coverageParts: [], verdict: null, truncated: false, turnLimit: false},
      mergeSha: null, postchecks: Object.fromEntries(REQUIRED_POSTCHECKS.map(check => [check, null])),
      nextAllowedAction: 'STOP_EXPIRED'};
    return result(expired, true, 'EXPIRED');
  }
  const eventScopeKey = scopeKey(old, event);
  const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const prior = old.processedEvents.find(item => item.key === eventScopeKey);
  if (prior) {
    need(prior.digest === digest, 'EVENT_ID_CONFLICT');
    return result(old, false, 'DUPLICATE_EVENT');
  }
  if (event.type === 'CI' && old.ci !== null) {
    const disposition = currentRunDisposition(old.ci, event);
    if (disposition) return result(old, false, disposition);
  }
  if (event.type === 'POSTCHECK') {
    need(old.requiredPostchecks.includes(event.check), 'NON_APPLICABLE_POSTCHECK');
    need(event.workflowId === old.postcheckWorkflowIds[event.check], 'POSTCHECK_WORKFLOW_MISMATCH');
    const previous = old.postchecks[event.check];
    if (previous !== null) {
      const disposition = currentRunDisposition(previous, event);
      if (disposition) return result(old, false, disposition);
    }
  }
  if (event.phase !== old.phase && !(event.type === 'CI' && ['REVIEW', 'OWNER_MERGE'].includes(event.phase))) {
    return result(old, false, 'STALE_PHASE');
  }
  if (old.phase === 'COMPLETE' || old.phase === 'BLOCKED' || old.phase === 'EXPIRED') {
    return result(old, false, 'TERMINAL_STATE');
  }

  const next = cloneData(old);
  let oneShotAction = null;
  const resetPairGates = () => {
    next.authorDelivery = 'PENDING';
    next.ci = null;
    next.review = {status: 'NONE', reviewId: null, coverageParts: [], verdict: null, truncated: false, turnLimit: false};
    next.mergeSha = null;
    next.postchecks = Object.fromEntries(REQUIRED_POSTCHECKS.map(check => [check, null]));
    next.correctionCauses = [];
    next.mutationLane = {status: 'CLEAR', operationId: null, resumePhase: null};
    next.phase = 'AUTHOR';
  };

  if (event.type === 'HEAD_MOVED') {
    need(!['POSTCHECK', 'COMPLETE', 'RECONCILE'].includes(old.phase), 'HEAD_MOVE_REQUIRES_RECONCILIATION');
    need(event.newHeadSha !== old.headSha || event.newBaseSha !== old.baseSha, 'UNCHANGED_HEAD_AND_BASE');
    next.headSha = event.newHeadSha;
    next.baseSha = event.newBaseSha;
    resetPairGates();
  } else if (event.type === 'AUTHOR_DELIVERY') {
    need(old.phase === 'AUTHOR', 'INVALID_TRANSITION');
    if (event.status === 'delivered') {
      next.authorDelivery = 'DELIVERED';
      next.phase = 'CI';
    } else {
      next.authorDelivery = 'FAILED';
    }
  } else if (event.type === 'CI') {
    need(old.phase === 'CI' || old.phase === 'REVIEW' || old.phase === 'OWNER_MERGE', 'INVALID_TRANSITION');
    if (old.phase === 'REVIEW' || old.phase === 'OWNER_MERGE') {
      next.review = {status: 'NONE', reviewId: null, coverageParts: [], verdict: null, truncated: false, turnLimit: false};
      next.phase = 'CI';
    }
    next.ci = {runId: event.runId, runAttempt: event.runAttempt, workflowId: event.workflowId,
      selectionRevision: event.selectionRevision, status: event.status.toUpperCase()};
    if (event.status === 'failure') {
      const cause = ciCorrectionCause(next.ci);
      if (!old.correctionCauses.includes(cause)) {
        next.correctionCauses.push(cause);
        oneShotAction = 'REQUEST_ONE_CONSOLIDATED_CORRECTION';
      }
    }
    if (event.status === 'success') next.phase = 'REVIEW';
  } else if (event.type === 'REVIEW_PART') {
    need(old.phase === 'REVIEW' && old.ci?.status === 'SUCCESS', 'REVIEW_REQUIRES_SUCCESSFUL_CI');
    need(event.ciRunId === old.ci.runId && event.ciRunAttempt === old.ci.runAttempt
      && event.ciWorkflowId === old.ci.workflowId, 'REVIEW_CI_MISMATCH');
    if (old.review.reviewId !== null) {
      need(old.review.reviewId === event.reviewId, 'REVIEW_IDENTITY_MISMATCH');
      if (old.review.status === 'COMPLETE') {
        need(old.review.verdict === event.verdict, 'REVIEW_RESULT_CONFLICT');
        return result(old, false, 'UNCHANGED_REVIEW_RESULT');
      }
      need(!(old.review.verdict === 'REVISION_REQUIRED' && event.verdict === 'GREEN_LIGHT'),
        'REVIEW_RESULT_CONFLICT');
    }
    const parts = [...new Set([...old.review.coverageParts, ...event.coverageParts])];
    const verdict = old.review.verdict === 'REVISION_REQUIRED' || event.verdict === 'REVISION_REQUIRED'
      ? 'REVISION_REQUIRED' : event.verdict;
    const complete = event.complete && !event.truncated && !event.turnLimit
      && REQUIRED_REVIEW_PARTS.every(part => parts.includes(part))
      && verdict !== 'NEEDS_MORE_EVIDENCE';
    next.review = {
      status: complete ? 'COMPLETE' : 'INCOMPLETE',
      reviewId: event.reviewId,
      coverageParts: parts,
      verdict: complete ? verdict : (verdict === 'REVISION_REQUIRED' ? verdict : 'NEEDS_MORE_EVIDENCE'),
      truncated: event.truncated,
      turnLimit: event.turnLimit
    };
    if (complete && event.verdict === 'GREEN_LIGHT') next.phase = 'OWNER_MERGE';
    if (complete && verdict === 'REVISION_REQUIRED') {
      const cause = reviewCorrectionCause(old.ci, event.reviewId);
      if (!old.correctionCauses.includes(cause)) {
        next.correctionCauses.push(cause);
        oneShotAction = 'REQUEST_ONE_CONSOLIDATED_CORRECTION';
      }
    }
  } else if (event.type === 'SOURCE_MERGED') {
    need(old.phase === 'OWNER_MERGE' && old.authorDelivery === 'DELIVERED'
      && old.ci?.status === 'SUCCESS' && old.review.status === 'COMPLETE'
      && old.review.verdict === 'GREEN_LIGHT', 'SOURCE_MERGE_GATES_INCOMPLETE');
    next.mergeSha = event.mergeSha;
    next.phase = 'POSTCHECK';
  } else if (event.type === 'POSTCHECK') {
    need(old.phase === 'POSTCHECK' && old.mergeSha !== null && event.mergeSha === old.mergeSha, 'POSTCHECK_MERGE_MISMATCH');
    next.postchecks[event.check] = {
      runId: event.runId,
      runAttempt: event.runAttempt,
      workflowId: event.workflowId,
      selectionRevision: event.selectionRevision,
      mergeSha: event.mergeSha,
      status: event.status.toUpperCase()
    };
    if (next.requiredPostchecks.every(check => next.postchecks[check]?.status === 'SUCCESS')) {
      next.phase = 'COMPLETE';
    }
  } else if (event.type === 'MUTATION_UNKNOWN') {
    need(!['RECONCILE', 'COMPLETE', 'BLOCKED'].includes(old.phase)
      && !old.mutationHistory.some(item => item.operationId === event.operationId), 'MUTATION_REPLAY_BLOCKED');
    next.mutationHistory.push({operationId: event.operationId, status: 'UNKNOWN', outcome: null});
    next.mutationLane = {status: 'UNKNOWN', operationId: event.operationId, resumePhase: old.phase};
    next.phase = 'RECONCILE';
  } else if (event.type === 'RECONCILED') {
    need(old.phase === 'RECONCILE' && old.mutationLane.status === 'UNKNOWN'
      && old.mutationLane.operationId === event.operationId, 'RECONCILIATION_SCOPE_MISMATCH');
    const history = next.mutationHistory.find(item => item.operationId === event.operationId);
    need(history?.status === 'UNKNOWN', 'MUTATION_REPLAY_BLOCKED');
    return result(old, false, 'MANUAL_RECONCILIATION_REQUIRED');
  } else if (event.type === 'AGENT_OPERATION') {
    next.phase = 'BLOCKED';
    next.ci = null;
    next.review = {status: 'NONE', reviewId: null, coverageParts: [], verdict: null, truncated: false, turnLimit: false};
    next.mergeSha = null;
    next.postchecks = Object.fromEntries(REQUIRED_POSTCHECKS.map(check => [check, null]));
  }

  need(next.eventCount < DEFAULT_LIMITS.events, 'EVENT_BUDGET_EXHAUSTED');
  need(next.transitionCount < DEFAULT_LIMITS.transitions, 'TRANSITION_BUDGET_EXHAUSTED');
  next.eventCount++;
  next.transitionCount++;
  next.processedEvents.push({key: eventScopeKey, digest});
  next.nextAllowedAction = oneShotAction || setNextAction(next);
  return result(next, true, event.type);
}

function readEvents(value) {
  need(Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype
    && value.length <= DEFAULT_LIMITS.events, 'INVALID_REPLAY_EVENTS');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  need(names.length === value.length + 1 && names.every(key => key === 'length'
    || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)), 'INVALID_REPLAY_EVENTS');
  const events = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'INVALID_REPLAY_EVENTS');
    events.push(descriptor.value);
  }
  return events;
}

export function simulateReplay(inputEvents, {
  initialState,
  maxEvents = DEFAULT_LIMITS.events,
  maxTransitions = DEFAULT_LIMITS.transitions,
  maxBytes = DEFAULT_LIMITS.replayBytes,
  maxRuntimeMs = DEFAULT_LIMITS.runtimeMs,
  clock = () => performance.now()
} = {}) {
  const events = readEvents(inputEvents);
  need(Number.isSafeInteger(maxEvents) && maxEvents >= 0 && maxEvents <= DEFAULT_LIMITS.events
    && Number.isSafeInteger(maxTransitions) && maxTransitions >= 0 && maxTransitions <= DEFAULT_LIMITS.transitions
    && Number.isSafeInteger(maxBytes) && maxBytes >= 0 && maxBytes <= DEFAULT_LIMITS.replayBytes
    && Number.isSafeInteger(maxRuntimeMs) && maxRuntimeMs >= 0 && maxRuntimeMs <= DEFAULT_LIMITS.runtimeMs
    && typeof clock === 'function', 'INVALID_REPLAY_LIMITS');
  let state = initialState ? validateState(initialState) : createCoordinatorState({
    repository: REPOSITORY,
    pullRequest: 1,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    startsAt: 1700000000000,
    expiresAt: 1700086400000,
    postcheckWorkflowIds: SYNTHETIC_POSTCHECK_WORKFLOW_IDS
  });
  const start = clock();
  need(Number.isFinite(start), 'INVALID_REPLAY_CLOCK');
  let payloadBytes = 0;
  let processedEvents = 0;
  let stopReason = null;
  for (const raw of events) {
    if (processedEvents >= maxEvents) {
      stopReason = 'EVENT_BUDGET_EXHAUSTED';
      break;
    }
    const normalized = normalizeEvent(raw);
    if (payloadBytes + normalized.bytes > maxBytes) {
      stopReason = 'BYTE_BUDGET_EXHAUSTED';
      break;
    }
    const before = state;
    const outcome = reduceEvent(state, normalized.event);
    if (outcome.changed && state.transitionCount >= maxTransitions) {
      stopReason = 'TRANSITION_BUDGET_EXHAUSTED';
      break;
    }
    state = outcome.state;
    payloadBytes += normalized.bytes;
    processedEvents++;
    const elapsed = clock() - start;
    need(Number.isFinite(elapsed) && elapsed >= 0, 'INVALID_REPLAY_CLOCK');
    if (elapsed > maxRuntimeMs) {
      stopReason = 'TIME_BUDGET_EXHAUSTED';
      break;
    }
    if (before === state && outcome.reason === 'DUPLICATE_EVENT') continue;
  }
  const end = clock();
  need(Number.isFinite(end) && end >= start, 'INVALID_REPLAY_CLOCK');
  if (!stopReason && end - start > maxRuntimeMs) stopReason = 'TIME_BUDGET_EXHAUSTED';
  return freeze({
    state,
    outcome: stopReason ? 'BOUNDED_STOP' : 'REPLAY_COMPLETE',
    stopReason,
    inputEvents: processedEvents,
    payloadBytes,
    elapsedMs: end - start,
    offlineOnly: true,
    externalEffects: false
  });
}

export function createSyntheticReplay() {
  const repository = REPOSITORY;
  const pullRequest = 972;
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const mergeSha = 'c'.repeat(40);
  const startsAt = 1700000000000;
  const event = (type, phase, actor, eventId, fields, occurredAt = startsAt + 1) => ({
    eventId, repository, pullRequest, headSha, baseSha, phase, actor, type, occurredAt, ...fields
  });
  const review = event('REVIEW_PART', 'REVIEW', 'claude[bot]', 'synthetic-review-01', {
    reviewId: 'synthetic-review-session-01', coverageParts: [...REQUIRED_REVIEW_PARTS],
    complete: true, verdict: 'GREEN_LIGHT',
    truncated: false, turnLimit: false, ciRunId: 11, ciRunAttempt: 1, ciWorkflowId: RELEASE_SAFETY_WORKFLOW_ID
  });
  return {
    startsAt,
    expiresAt: startsAt + 86400000,
    initialState: createCoordinatorState({
      repository, pullRequest, headSha, baseSha, startsAt, expiresAt: startsAt + 86400000,
      postcheckWorkflowIds: SYNTHETIC_POSTCHECK_WORKFLOW_IDS
    }),
    events: [
      event('AUTHOR_DELIVERY', 'AUTHOR', 'Copilot', 'synthetic-author-01', {status: 'delivered'}),
      event('CI', 'CI', 'github-actions[bot]', 'synthetic-ci-01', {
        status: 'success', completed: true, runId: 11, runAttempt: 1, workflowId: RELEASE_SAFETY_WORKFLOW_ID,
        selectionRevision: 1, currentRunId: 11, currentRunAttempt: 1
      }),
      review,
      event('SOURCE_MERGED', 'OWNER_MERGE', 'Achi1984', 'synthetic-merge-01', {mergeSha}),
      ...REQUIRED_POSTCHECKS.map((check, index) => event('POSTCHECK', 'POSTCHECK', 'github-actions[bot]',
        `synthetic-postcheck-${index + 1}`, {
          check, status: 'success', mergeSha, runId: 20 + index, runAttempt: 1,
          workflowId: SYNTHETIC_POSTCHECK_WORKFLOW_IDS[check], selectionRevision: 1,
          currentRunId: 20 + index, currentRunAttempt: 1
        }))
    ]
  };
}
