import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {isVerifiedCollection} from './m11-coordinator-collector.mjs';
import {REQUIRED_REVIEW_PARTS} from './m11-event-coordinator.mjs';

const VERDICTS = new Set(['GREEN_LIGHT', 'REVISION_REQUIRED', 'NEEDS_MORE_EVIDENCE']);
const MAX_SUMMARY_BYTES = 2048;

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
      Promise.resolve().then(() => operation({...input, signal: controller.signal}))
        .then(value => ({timedOut: false, value}), () => ({timedOut: false, error: true})),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeReview(input) {
  const keys = ['coverageParts', 'verdict', 'complete', 'truncated', 'turnLimit', 'summary'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || types.isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !keys.includes(key))
    || Object.values(descriptors).some(descriptor => !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) {
    return null;
  }
  const parts = descriptors.coverageParts.value;
  if (!Array.isArray(parts) || types.isProxy(parts) || Object.getPrototypeOf(parts) !== Array.prototype
    || parts.length > REQUIRED_REVIEW_PARTS.length) return null;
  const partDescriptors = Object.getOwnPropertyDescriptors(parts);
  const partKeys = Reflect.ownKeys(partDescriptors);
  if (partKeys.length !== parts.length + 1
    || !partKeys.includes('length')
    || partKeys.some(key => key !== 'length'
      && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= parts.length))) {
    return null;
  }
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
    coverageParts: Object.freeze(normalizedParts),
    verdict: complete ? verdict : 'NEEDS_MORE_EVIDENCE',
    truncated,
    turnLimit,
    summary
  });
}

export async function runReviewCoordinator({
  enabled = false,
  collected,
  store,
  reviewer,
  receipt,
  now = Date.now,
  expiresAt,
  maxRuntimeMs = 10000,
  leaseOwner = 'm11-review-coordinator',
  leaseDurationMs = 30000
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (!isVerifiedCollection(collected) || collected.status !== 'READY') return waiting('UNVERIFIED_CI_COLLECTION');
  if (!store || store.available !== true || typeof store.read !== 'function'
    || typeof store.claim !== 'function' || typeof store.commit !== 'function'
    || typeof store.reconcile !== 'function' || typeof store.release !== 'function'
    || typeof reviewer !== 'function'
    || !receipt || typeof receipt.postOnce !== 'function'
    || typeof receipt.lookupByActionKey !== 'function') return waiting('REQUIRED_ADAPTER_UNAVAILABLE');
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(maxRuntimeMs)
    || maxRuntimeMs < 1 || maxRuntimeMs > 10000 || !Number.isSafeInteger(leaseDurationMs)
    || leaseDurationMs < 1000 || leaseDurationMs > 30000) return waiting('INVALID_BUDGET');
  const started = performance.now();
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt >= expiresAt) return waiting('PILOT_EXPIRED');
  const budgetExpired = () => performance.now() - started > maxRuntimeMs || now() >= expiresAt;
  const remainingMs = () => Math.min(maxRuntimeMs - (performance.now() - started), expiresAt - now());
  try {
    const snapshotCall = await callWithinBudget(store.read.bind(store), {}, remainingMs());
    if (snapshotCall.timedOut || budgetExpired()) return waiting('TIME_BUDGET_EXHAUSTED');
    const snapshotResult = snapshotCall.value;
    if (snapshotResult?.status !== 'READY') return waiting('STATE_UNAVAILABLE');
    const snapshot = snapshotResult.snapshot;
    const claimCall = await callWithinBudget(store.claim.bind(store), {
      actionKey: collected.actionKey,
      packetKey: createHash('sha256').update([
        collected.repository, collected.pullRequest, collected.headSha, collected.baseSha
      ].join('|')).digest('hex'),
      maxPackets: 3,
      expectedRevision: snapshot.revision,
      expectedOid: snapshot.oid,
      expectedFence: snapshot.fencingToken,
      owner: leaseOwner,
      leaseExpiresAt: Math.min(expiresAt, startedAt + leaseDurationMs),
      now: startedAt
    }, remainingMs());
    if (claimCall.timedOut) return Object.freeze({status: 'UNKNOWN', reason: 'CLAIM_OUTCOME_UNKNOWN', externalEffects: false});
    const claim = claimCall.value;
    if (claim?.status !== 'CLAIMED') {
      return Object.freeze({status: 'WAITING', reason: claim?.status || 'CLAIM_NOT_ACQUIRED', externalEffects: false});
    }
    let lease = claim.lease;
    const reviewInput = Object.freeze({
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
      untrustedDiff: collected.diff,
      diffDigest: collected.diffDigest,
      requiredCoverageParts: REQUIRED_REVIEW_PARTS
    });

    if (budgetExpired()) {
      await callWithinBudget(store.commit.bind(store),
        {lease, transition: {kind: 'UNKNOWN', stage: 'REVIEW_NOT_STARTED'}}, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'TIME_BUDGET_BEFORE_REVIEW', externalEffects: false});
    }
    const reviewCall = await callWithinBudget(reviewer, reviewInput, remainingMs());
    if (reviewCall.timedOut || reviewCall.error) {
      await callWithinBudget(store.commit.bind(store),
        {lease, transition: {kind: 'UNKNOWN', stage: 'REVIEW'}}, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'REVIEW_OUTCOME_UNKNOWN', externalEffects: true});
    }
    const rawReview = reviewCall.value;
    if (budgetExpired()) {
      await callWithinBudget(store.commit.bind(store),
        {lease, transition: {kind: 'UNKNOWN', stage: 'REVIEW'}}, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'TIME_BUDGET_AFTER_REVIEW', externalEffects: true});
    }
    const review = normalizeReview(rawReview);
    if (!review) {
      await callWithinBudget(store.commit.bind(store),
        {lease, transition: {kind: 'UNKNOWN', stage: 'INVALID_REVIEW'}}, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'INVALID_STRUCTURED_REVIEW', externalEffects: true});
    }
    const reviewCommitCall = await callWithinBudget(store.commit.bind(store), {
      lease,
      transition: {
        kind: 'REVIEW_RESULT',
        actionKey: collected.actionKey,
        exactPair: [collected.repository, collected.pullRequest, collected.headSha, collected.baseSha],
        ci: [collected.runId, collected.runAttempt, collected.workflowId],
        review
      }
    }, remainingMs());
    const reviewCommit = reviewCommitCall.value;
    if (reviewCommitCall.timedOut || reviewCommit?.status !== 'COMMITTED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'REVIEW_STATE_COMMIT_UNKNOWN', externalEffects: true});
    }
    lease = reviewCommit.lease;
    if (budgetExpired()) return Object.freeze({status: 'UNKNOWN', reason: 'TIME_BUDGET_BEFORE_RECEIPT', externalEffects: true});

    const receiptPayload = Object.freeze({
      actionKey: collected.actionKey,
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
    const receiptCall = await callWithinBudget(receipt.postOnce.bind(receipt), {
      actionKey: collected.actionKey, receipt: receiptPayload
    }, remainingMs());
    if (receiptCall.timedOut || receiptCall.error) {
      await callWithinBudget(store.commit.bind(store), {
        lease,
        transition: {kind: 'UNKNOWN', stage: 'RECEIPT_DELIVERY', actionKey: collected.actionKey}
      }, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_DELIVERY_UNKNOWN', externalEffects: true});
    }
    const receiptResult = receiptCall.value;
    if (budgetExpired() || !receiptResult || receiptResult.status !== 'CREATED'
      || typeof receiptResult.receiptId !== 'string' || receiptResult.receiptId.length === 0
      || receiptResult.receiptId.length > 200) {
      await callWithinBudget(store.commit.bind(store), {
        lease,
        transition: {kind: 'UNKNOWN', stage: 'RECEIPT_DELIVERY', actionKey: collected.actionKey}
      }, remainingMs());
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_REQUIRES_RECONCILIATION', externalEffects: true});
    }
    const finalCommitCall = await callWithinBudget(store.commit.bind(store), {
      lease,
      transition: {kind: 'RECEIPT_DELIVERED', actionKey: collected.actionKey}
    }, remainingMs());
    const finalCommit = finalCommitCall.value;
    if (finalCommitCall.timedOut || finalCommit?.status !== 'COMMITTED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'RECEIPT_STATE_COMMIT_UNKNOWN', externalEffects: true});
    }
    const releaseCall = await callWithinBudget(store.release.bind(store), {lease}, remainingMs());
    if (releaseCall.timedOut || releaseCall.value?.status !== 'RELEASED') {
      return Object.freeze({status: 'UNKNOWN', reason: 'LEASE_RELEASE_REQUIRES_RECONCILIATION', externalEffects: true});
    }
    return Object.freeze({
      status: 'PROPOSED',
      review,
      receiptStatus: receiptResult.status,
      externalEffects: true
    });
  } catch {
    return Object.freeze({status: 'UNKNOWN', reason: 'COORDINATOR_FAILURE_RECONCILE', externalEffects: true});
  }
}

export async function reconcileUnknownReceipt({
  enabled = false,
  actionKey,
  store,
  receipt,
  maxRuntimeMs = 10000
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (typeof actionKey !== 'string' || !/^[a-f0-9]{64}$/.test(actionKey)
    || !store || store.available !== true || typeof store.reconcile !== 'function'
    || !receipt || typeof receipt.lookupByActionKey !== 'function'
    || !Number.isSafeInteger(maxRuntimeMs) || maxRuntimeMs < 1 || maxRuntimeMs > 10000) {
    return waiting('RECONCILIATION_ADAPTER_UNAVAILABLE');
  }
  const started = performance.now();
  const [stored, remote] = await Promise.all([
    callWithinBudget(store.reconcile.bind(store), {actionKey}, maxRuntimeMs),
    callWithinBudget(receipt.lookupByActionKey.bind(receipt), {actionKey}, maxRuntimeMs)
  ]);
  if (stored.timedOut || stored.error || remote.timedOut || remote.error
    || performance.now() - started > maxRuntimeMs) {
    return Object.freeze({status: 'UNKNOWN', reason: 'RECONCILIATION_INCOMPLETE', retryAllowed: false});
  }
  const result = remote.value;
  if (result?.complete !== true || !['FOUND', 'NOT_FOUND'].includes(result.status)
    || (result.status === 'FOUND' && (!Array.isArray(result.receiptIds)
      || result.receiptIds.length !== 1 || typeof result.receiptIds[0] !== 'string'
      || result.receiptIds[0].length === 0 || result.receiptIds[0].length > 200))) {
    return Object.freeze({status: 'UNKNOWN', reason: 'REMOTE_RECEIPT_STATE_AMBIGUOUS', retryAllowed: false});
  }
  if (result.status === 'FOUND') {
    return Object.freeze({
      status: 'APPLIED',
      reason: 'RECEIPT_FOUND_BY_AUTHORITATIVE_READ',
      receiptId: result.receiptIds[0],
      retryAllowed: false
    });
  }
  return Object.freeze({
    status: 'NOT_APPLIED',
    reason: 'NO_RECEIPT_FOUND_REQUIRES_EXPLICIT_NEW_ACTION',
    retryAllowed: false,
    stateStoreStatus: stored.value?.status || 'UNKNOWN'
  });
}
