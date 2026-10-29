import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {isVerifiedCollection} from './m11-coordinator-collector.mjs';
import {REQUIRED_REVIEW_PARTS} from './m11-event-coordinator.mjs';

const VERDICTS = new Set(['GREEN_LIGHT', 'REVISION_REQUIRED', 'NEEDS_MORE_EVIDENCE']);
const MAX_SUMMARY_BYTES = 2048;
const MAX_ID_BYTES = 200;
const MAX_REVIEWER_FIELD_BYTES = 120;
const CAPABILITY_STATES = new Set(['DOCUMENTED', 'CONFIGURED', 'EXERCISED', 'ENABLED']);
const RECONCILABLE_RECEIPT_STAGES = new Set(['RECEIPT_POSTING', 'RECEIPT_DELIVERY', 'RECEIPT_DELIVERED']);

function waiting(reason) {
  return Object.freeze({status: 'WAITING', reason, externalEffects: false});
}

async function callWithinBudget(operation, input, remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return {timedOut: true};
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({timedOut: true});
    }, remainingMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(input !== null && typeof input === 'object'
        ? {...input, signal: controller.signal} : input))
        .then(value => ({timedOut: false, value}), () => ({timedOut: false, error: true})),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeReview(input, expected) {
  const keys = ['reviewRequestId', 'sessionId', 'reviewer', 'coverageParts', 'verdict',
    'complete', 'truncated', 'turnLimit', 'summary'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key))
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) {
    return null;
  }
  const reviewRequestId = descriptors.reviewRequestId.value;
  const sessionId = descriptors.sessionId.value;
  const reviewer = descriptors.reviewer.value;
  const reviewerKeys = ['provider', 'agent', 'model', 'transport'];
  if (reviewRequestId !== expected.reviewRequestId
    || typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > MAX_ID_BYTES
    || !reviewer || typeof reviewer !== 'object' || Array.isArray(reviewer)
    || types.isProxy(reviewer) || Object.getPrototypeOf(reviewer) !== Object.prototype
    || Reflect.ownKeys(reviewer).length !== reviewerKeys.length
    || Object.values(Object.getOwnPropertyDescriptors(reviewer))
      .some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) return null;
  const reviewerDescriptors = Object.getOwnPropertyDescriptors(reviewer);
  if (reviewerKeys.some(key => typeof reviewerDescriptors[key]?.value !== 'string'
    || reviewerDescriptors[key].value.length === 0
    || Buffer.byteLength(reviewerDescriptors[key].value, 'utf8') > MAX_REVIEWER_FIELD_BYTES
    || reviewerDescriptors[key].value !== expected.reviewer[key])) return null;

  const parts = descriptors.coverageParts.value;
  if (!Array.isArray(parts) || types.isProxy(parts) || Object.getPrototypeOf(parts) !== Array.prototype
    || parts.length > REQUIRED_REVIEW_PARTS.length) return null;
  const partDescriptors = Object.getOwnPropertyDescriptors(parts);
  const partKeys = Reflect.ownKeys(partDescriptors);
  if (partKeys.length !== parts.length + 1
    || !partKeys.includes('length')
    || partKeys.some(key => key !== 'length'
      && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= parts.length))) return null;
  const normalizedParts = [];
  for (let index = 0; index < parts.length; index++) {
    const descriptor = partDescriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    const part = descriptor.value;
    if (!REQUIRED_REVIEW_PARTS.includes(part) || normalizedParts.includes(part)) return null;
    normalizedParts.push(part);
  }
  const verdict = descriptors.verdict.value;
  const completeFlag = descriptors.complete.value;
  const truncated = descriptors.truncated.value;
  const turnLimit = descriptors.turnLimit.value;
  const summary = descriptors.summary.value;
  if (!VERDICTS.has(verdict) || typeof completeFlag !== 'boolean' || typeof truncated !== 'boolean'
    || typeof turnLimit !== 'boolean' || typeof summary !== 'string'
    || Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) return null;

  const complete = completeFlag && !truncated && !turnLimit
    && REQUIRED_REVIEW_PARTS.every(part => normalizedParts.includes(part))
    && verdict !== 'NEEDS_MORE_EVIDENCE';
  return Object.freeze({
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    reviewRequestId,
    sessionId,
    reviewer: Object.freeze({...reviewer}),
    capabilityEvidence: expected.capabilityEvidence,
    coverageParts: Object.freeze(normalizedParts),
    verdict: complete ? verdict : 'NEEDS_MORE_EVIDENCE',
    truncated,
    turnLimit,
    summary
  });
}

function sameEvidence(left, right) {
  return right?.status === 'READY'
    && left.actionKey === right.actionKey && left.executionKey === right.executionKey
    && left.repository === right.repository && left.pullRequest === right.pullRequest
    && left.headSha === right.headSha && left.baseSha === right.baseSha
    && left.runId === right.runId && left.runAttempt === right.runAttempt
    && left.workflowId === right.workflowId && left.selectionRevision === right.selectionRevision
    && left.diffDigest === right.diffDigest;
}

async function revalidateCollection(revalidate, collected, remainingMs, now) {
  const checked = await callWithinBudget(revalidate, {
    expected: Object.freeze({
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      selectionRevision: collected.selectionRevision,
      actionKey: collected.actionKey,
      executionKey: collected.executionKey,
      diffDigest: collected.diffDigest
    })
  }, remainingMs);
  if (checked.timedOut || checked.error || !isVerifiedCollection(checked.value, now())
    || !sameEvidence(collected, checked.value)) return {ok: false, timedOut: checked.timedOut};
  return {ok: true};
}

async function recordUnknown(store, claim, stage, remainingMs, extra = {}) {
  return callWithinBudget(store.commit.bind(store), {
    claim,
    transition: {kind: 'UNKNOWN', stage, ...extra}
  }, remainingMs);
}

export async function runReviewCoordinator({
  enabled = false,
  collected,
  store,
  reviewer,
  reviewerIdentity,
  capabilityEvidence,
  revalidate,
  receipt,
  now = Date.now,
  expiresAt,
  maxRuntimeMs = 10000,
  claimOwner = 'm11-review-coordinator'
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (!isVerifiedCollection(collected, now()) || collected.status !== 'READY') return waiting('UNVERIFIED_OR_EXPIRED_CI_COLLECTION');
  if (!store || store.available !== true || typeof store.read !== 'function'
    || typeof store.claim !== 'function' || typeof store.commit !== 'function'
    || typeof store.reconcile !== 'function' || typeof reviewer !== 'function'
    || typeof revalidate !== 'function'
    || !receipt || typeof receipt.postOnce !== 'function'
    || typeof receipt.lookupByActionKey !== 'function'
    || !reviewerIdentity || ['provider', 'agent', 'model', 'transport'].some(key =>
      typeof reviewerIdentity[key] !== 'string' || reviewerIdentity[key].length === 0
      || Buffer.byteLength(reviewerIdentity[key], 'utf8') > MAX_REVIEWER_FIELD_BYTES)) {
    return waiting('REQUIRED_ADAPTER_UNAVAILABLE');
  }
  const capabilityKeys = ['state', 'provider', 'agent', 'model', 'transport', 'observedAt', 'expiresAt'];
  if (!capabilityEvidence || typeof capabilityEvidence !== 'object'
    || Array.isArray(capabilityEvidence) || types.isProxy(capabilityEvidence)
    || Object.getPrototypeOf(capabilityEvidence) !== Object.prototype
    || Object.keys(capabilityEvidence).length !== capabilityKeys.length
    || capabilityKeys.some(key => !Object.hasOwn(capabilityEvidence, key))
    || !CAPABILITY_STATES.has(capabilityEvidence.state)
    || capabilityEvidence.state !== 'ENABLED'
    || ['provider', 'agent', 'model', 'transport'].some(key =>
      capabilityEvidence[key] !== reviewerIdentity[key])
    || !Number.isSafeInteger(capabilityEvidence.observedAt)
    || !Number.isSafeInteger(capabilityEvidence.expiresAt)
    || capabilityEvidence.observedAt > now() || capabilityEvidence.expiresAt <= now()
    || capabilityEvidence.expiresAt - capabilityEvidence.observedAt > 86400000) {
    return waiting('REVIEWER_CAPABILITY_UNAVAILABLE');
  }
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(maxRuntimeMs)
    || maxRuntimeMs < 1 || maxRuntimeMs > 10000) return waiting('INVALID_BUDGET');
  const started = performance.now();
  const startedAt = now();
  const deadline = Math.min(expiresAt, collected.expiresAt, capabilityEvidence.expiresAt);
  if (!Number.isSafeInteger(startedAt) || startedAt >= deadline) return waiting('PILOT_OR_COLLECTION_EXPIRED');
  const budgetExpired = () => performance.now() - started > maxRuntimeMs || now() >= deadline;
  const remainingMs = () => Math.min(maxRuntimeMs - (performance.now() - started), deadline - now());
  const reviewRequestId = createHash('sha256').update([
    collected.actionKey, collected.executionKey, collected.diffDigest
  ].join('|')).digest('hex');
  let claim;
  try {
    const beforeClaim = await revalidateCollection(revalidate, collected, remainingMs(), now);
    if (!beforeClaim.ok || budgetExpired()) return waiting(beforeClaim.timedOut ? 'REVALIDATION_TIMEOUT' : 'STALE_OR_UNKNOWN_BEFORE_CLAIM');
    const snapshotCall = await callWithinBudget(store.read.bind(store), {}, remainingMs());
    if (snapshotCall.timedOut || snapshotCall.error || budgetExpired()) return waiting('STATE_UNAVAILABLE');
    const snapshotResult = snapshotCall.value;
    if (snapshotResult?.status !== 'READY') return waiting('STATE_UNAVAILABLE');
    const claimCall = await callWithinBudget(store.claim.bind(store), {
      actionKey: collected.actionKey,
      executionKey: collected.executionKey,
      packetKey: createHash('sha256').update([
        collected.repository, collected.pullRequest, collected.headSha, collected.baseSha
      ].join('|')).digest('hex'),
      maxPackets: 3,
      expectedRevision: snapshotResult.snapshot.revision,
      expectedOid: snapshotResult.snapshot.oid,
      owner: claimOwner,
      now: startedAt
    }, remainingMs());
    if (claimCall.timedOut || claimCall.error) {
      return Object.freeze({status: 'UNKNOWN', reason: 'CLAIM_OUTCOME_UNKNOWN', externalEffects: false});
    }
    if (claimCall.value?.status !== 'CLAIMED') {
      if (claimCall.value?.status === 'CLAIM_UNKNOWN') {
        return Object.freeze({status: 'UNKNOWN', reason: 'CLAIM_OUTCOME_UNKNOWN', externalEffects: false});
      }
      return Object.freeze({
        status: 'WAITING',
        reason: claimCall.value?.status || 'CLAIM_NOT_ACQUIRED',
        externalEffects: false
      });
    }
    claim = claimCall.value.claim;
    const beforeReview = await revalidateCollection(revalidate, collected, remainingMs(), now);
    if (!beforeReview.ok || budgetExpired()) {
      await recordUnknown(store, claim, 'STALE_AFTER_CLAIM', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'STALE_OR_UNKNOWN_BEFORE_REVIEW', externalEffects: false});
    }
    const reviewInput = Object.freeze({
      reviewRequestId,
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      ci: Object.freeze({
        runId: collected.runId,
        runAttempt: collected.runAttempt,
        workflowId: collected.workflowId,
        selectionRevision: collected.selectionRevision
      }),
      expectedReviewer: Object.freeze({...reviewerIdentity}),
      capabilityEvidence: Object.freeze({...capabilityEvidence}),
      untrustedDiff: collected.diff,
      diffDigest: collected.diffDigest,
      requiredCoverageParts: REQUIRED_REVIEW_PARTS
    });
    const reviewCall = await callWithinBudget(reviewer, reviewInput, remainingMs());
    if (reviewCall.timedOut || reviewCall.error) {
      await recordUnknown(store, claim, 'REVIEW', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'REVIEW_OUTCOME_UNKNOWN', externalEffects: true});
    }
    if (budgetExpired()) {
      await recordUnknown(store, claim, 'REVIEW', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'TIME_BUDGET_AFTER_REVIEW', externalEffects: true});
    }
    const review = normalizeReview(reviewCall.value, {
      reviewRequestId,
      reviewer: reviewerIdentity,
      capabilityEvidence: Object.freeze({...capabilityEvidence})
    });
    if (!review) {
      await recordUnknown(store, claim, 'INVALID_REVIEW', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'INVALID_OR_UNBOUND_REVIEW', externalEffects: true});
    }
    const reviewCommitCall = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {
        kind: 'REVIEW_RESULT',
        actionKey: collected.actionKey,
        executionKey: collected.executionKey,
        reviewRequestId,
        exactPair: [collected.repository, collected.pullRequest, collected.headSha, collected.baseSha],
        ci: [collected.workflowId, collected.runId, collected.runAttempt],
        review
      }
    }, remainingMs());
    const reviewCommit = reviewCommitCall.value;
    if (reviewCommitCall.timedOut || reviewCommitCall.error || reviewCommit?.status !== 'COMMITTED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'REVIEW_STATE_COMMIT_UNKNOWN', externalEffects: true});
    }
    claim = reviewCommit.claim;
    if (budgetExpired()) return Object.freeze({status: 'UNKNOWN', reason: 'TIME_BUDGET_BEFORE_RECEIPT', externalEffects: true});
    const beforeReceipt = await revalidateCollection(revalidate, collected, remainingMs(), now);
    if (!beforeReceipt.ok || budgetExpired()) {
      await recordUnknown(store, claim, 'STALE_BEFORE_RECEIPT', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'STALE_OR_UNKNOWN_BEFORE_RECEIPT', externalEffects: true});
    }
    const receiptPayload = Object.freeze({
      actionKey: collected.actionKey,
      executionKey: collected.executionKey,
      reviewRequestId,
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      diffDigest: collected.diffDigest,
      review
    });
    const postingCommitCall = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {kind: 'RECEIPT_POSTING', actionKey: collected.actionKey, executionKey: collected.executionKey}
    }, remainingMs());
    if (postingCommitCall.timedOut || postingCommitCall.error || postingCommitCall.value?.status !== 'COMMITTED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_POSTING_STATE_UNKNOWN', externalEffects: true});
    }
    claim = postingCommitCall.value.claim;
    const receiptCall = await callWithinBudget(receipt.postOnce.bind(receipt), {
      actionKey: collected.executionKey,
      executionKey: collected.executionKey,
      receipt: receiptPayload
    }, remainingMs());
    if (receiptCall.timedOut || receiptCall.error) {
      await recordUnknown(store, claim, 'RECEIPT_DELIVERY', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_DELIVERY_UNKNOWN', externalEffects: true});
    }
    const receiptResult = receiptCall.value;
    if (budgetExpired() || !receiptResult || receiptResult.status !== 'CREATED'
      || typeof receiptResult.receiptId !== 'string' || receiptResult.receiptId.length === 0
      || receiptResult.receiptId.length > MAX_ID_BYTES) {
      await recordUnknown(store, claim, 'RECEIPT_DELIVERY', remainingMs(), {reviewRequestId});
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_REQUIRES_RECONCILIATION', externalEffects: true});
    }
    const finalCommitCall = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {
        kind: 'RECEIPT_DELIVERED',
        actionKey: collected.actionKey,
        executionKey: collected.executionKey,
        receiptId: receiptResult.receiptId
      }
    }, remainingMs());
    const finalCommit = finalCommitCall.value;
    if (finalCommitCall.timedOut || finalCommitCall.error || finalCommit?.status !== 'COMMITTED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_STATE_COMMIT_UNKNOWN', externalEffects: true});
    }
    return Object.freeze({
      status: 'PROPOSED',
      review,
      receiptStatus: receiptResult.status,
      externalEffects: true
    });
  } catch {
    return Object.freeze({status: 'UNKNOWN', reason: 'COORDINATOR_FAILURE_RECONCILE', externalEffects: Boolean(claim)});
  }
}

export async function reconcileUnknownReceipt({
  enabled = false,
  executionKey,
  store,
  receipt,
  maxRuntimeMs = 10000
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (typeof executionKey !== 'string' || !/^[a-f0-9]{64}$/.test(executionKey)
    || !store || store.available !== true || typeof store.reconcile !== 'function'
    || !receipt || typeof receipt.lookupByActionKey !== 'function'
    || !Number.isSafeInteger(maxRuntimeMs) || maxRuntimeMs < 1 || maxRuntimeMs > 10000) {
    return waiting('RECONCILIATION_ADAPTER_UNAVAILABLE');
  }
  const started = performance.now();
  const [stored, remote] = await Promise.all([
    callWithinBudget(store.reconcile.bind(store), executionKey, maxRuntimeMs),
    callWithinBudget(receipt.lookupByActionKey.bind(receipt), {actionKey: executionKey}, maxRuntimeMs)
  ]);
  if (stored.timedOut || stored.error || remote.timedOut || remote.error
    || performance.now() - started > maxRuntimeMs) {
    return Object.freeze({status: 'UNKNOWN', reason: 'RECONCILIATION_INCOMPLETE', retryAllowed: false});
  }
  const durable = stored.value;
  const result = remote.value;
  const claim = durable?.claim;
  if (durable?.status !== 'READY' || !claim || claim.executionKey !== executionKey
    || !/^[a-f0-9]{64}$/.test(claim.actionKey || '')
    || typeof claim.claimId !== 'string' || claim.claimId.length === 0
    || !RECONCILABLE_RECEIPT_STAGES.has(claim.lastStage)) {
    return Object.freeze({status: 'UNKNOWN', reason: 'DURABLE_CLAIM_EVIDENCE_MISSING_OR_CONFLICTING', retryAllowed: false});
  }
  const coherentStage = claim.lastStage === 'RECEIPT_POSTING' ? claim.status === 'RECEIPT_POSTING'
    : claim.lastStage === 'RECEIPT_DELIVERY' ? claim.status === 'UNKNOWN'
      : claim.lastStage === 'RECEIPT_DELIVERED' && claim.status === 'COMMITTED';
  if (!coherentStage) {
    return Object.freeze({status: 'UNKNOWN', reason: 'DURABLE_RECEIPT_STAGE_CONFLICTING', retryAllowed: false});
  }
  if (result?.complete !== true || !['FOUND', 'NOT_FOUND'].includes(result.status)
    || (result.status === 'FOUND' && (!Array.isArray(result.receiptIds)
      || result.receiptIds.length !== 1 || typeof result.receiptIds[0] !== 'string'
      || result.receiptIds[0].length === 0 || result.receiptIds[0].length > MAX_ID_BYTES))
    || (result.status === 'NOT_FOUND' && (!Array.isArray(result.receiptIds) || result.receiptIds.length !== 0))) {
    return Object.freeze({status: 'UNKNOWN', reason: 'REMOTE_RECEIPT_STATE_AMBIGUOUS', retryAllowed: false});
  }
  if (result.status === 'FOUND' && claim.lastStage === 'RECEIPT_DELIVERED') {
    if (typeof claim.receiptId !== 'string' || claim.receiptId.length === 0
      || claim.receiptId.length > MAX_ID_BYTES) {
      return Object.freeze({status: 'UNKNOWN', reason: 'DURABLE_RECEIPT_ID_MISSING', retryAllowed: false});
    }
    if (claim.receiptId !== result.receiptIds[0]) {
      return Object.freeze({status: 'UNKNOWN', reason: 'DURABLE_RECEIPT_ID_MISMATCH', retryAllowed: false});
    }
    return Object.freeze({
      status: 'APPLIED',
      reason: 'DURABLE_AND_REMOTE_RECEIPT_IDS_MATCH',
      receiptId: claim.receiptId,
      retryAllowed: false
    });
  }
  if (result.status === 'FOUND'
    && (claim.lastStage === 'RECEIPT_POSTING' || claim.lastStage === 'RECEIPT_DELIVERY')) {
    return Object.freeze({
      status: 'APPLIED',
      reason: 'REMOTE_RECEIPT_FOUND_BEFORE_FINAL_STATE_COMMIT',
      receiptId: result.receiptIds[0],
      retryAllowed: false
    });
  }
  return Object.freeze({status: 'UNKNOWN', reason: 'ABSENCE_OR_CONFLICT_REQUIRES_MANUAL_RECONCILIATION', retryAllowed: false});
}
