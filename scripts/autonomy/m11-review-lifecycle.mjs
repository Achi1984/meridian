import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isVerifiedCollection} from './m11-coordinator-collector.mjs';
import {evaluateReviewBoundary} from './m11-review-boundary.mjs';

const MAX_RUNTIME_MS = 10000;
const MAX_REVIEW_DEADLINE_MS = 86400000;
const MAX_ID_BYTES = 200;

function baseResult() {
  return {
    dispatch: false,
    merge: false,
    activation: false,
    externalEffects: false,
    retryAllowed: false
  };
}

function waiting(reason) {
  return Object.freeze({status: 'WAITING', reason, ...baseResult()});
}

function unknown(reason, externalEffects = false) {
  return Object.freeze({status: 'UNKNOWN', reason, ...baseResult(), externalEffects});
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validRuntimeMs(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_RUNTIME_MS;
}

function validDeadlineMs(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_REVIEW_DEADLINE_MS;
}

function validChangedPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && path.isWellFormed()
    && Buffer.byteLength(path, 'utf8') <= 512;
}

function validChangedPathsInventory(paths) {
  return Array.isArray(paths)
    && paths.length > 0
    && paths.length <= 1024
    && paths.every(validChangedPath)
    && new Set(paths).size === paths.length;
}

function sameCollectionPins(expected, observed) {
  return observed?.status === 'READY'
    && expected.actionKey === observed.actionKey
    && expected.executionKey === observed.executionKey
    && expected.repository === observed.repository
    && expected.pullRequest === observed.pullRequest
    && expected.headSha === observed.headSha
    && expected.baseSha === observed.baseSha
    && expected.runId === observed.runId
    && expected.runAttempt === observed.runAttempt
    && expected.workflowId === observed.workflowId
    && expected.selectionRevision === observed.selectionRevision
    && expected.diffDigest === observed.diffDigest
    && expected.changedPathDigest === observed.changedPathDigest
    && Array.isArray(observed.changedPaths)
    && validChangedPathsInventory(observed.changedPaths);
}

async function callWithinBudget(operation, input, remainingMs) {
  if (typeof operation !== 'function' || !Number.isFinite(remainingMs) || remainingMs <= 0) {
    return {timedOut: true};
  }
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
      Promise.resolve()
        .then(() => operation(input !== null && typeof input === 'object'
          ? {...input, signal: controller.signal}
          : input))
        .then(value => ({timedOut: false, value}), () => ({timedOut: false, error: true})),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function revalidateCollection({revalidate, expected, remainingMs, now}) {
  if (typeof revalidate !== 'function') return {ok: false, missing: true, timedOut: false};
  const value = await callWithinBudget(revalidate, {
    expected: Object.freeze({
      repository: expected.repository,
      pullRequest: expected.pullRequest,
      headSha: expected.headSha,
      baseSha: expected.baseSha,
      runId: expected.runId,
      runAttempt: expected.runAttempt,
      workflowId: expected.workflowId,
      selectionRevision: expected.selectionRevision,
      actionKey: expected.actionKey,
      executionKey: expected.executionKey,
      diffDigest: expected.diffDigest,
      changedPathDigest: expected.changedPathDigest
    })
  }, remainingMs);
  if (value.timedOut || value.error || !isVerifiedCollection(value.value, now())
    || value.value?.status !== 'READY'
    || !validChangedPathsInventory(value.value?.changedPaths)
    || typeof value.value?.changedPathDigest !== 'string'
    || !sameCollectionPins(expected, value.value)) {
    return {ok: false, timedOut: value.timedOut};
  }
  return {ok: true, collected: value.value};
}

function claimHasPendingIdentity(claim) {
  return claim && typeof claim.reviewRequestId === 'string' && claim.reviewRequestId.length > 0
    && typeof claim.sessionId === 'string' && claim.sessionId.length > 0
    && positiveInteger(claim.reviewDeadlineAt)
    && positiveInteger(claim.runId)
    && positiveInteger(claim.runAttempt)
    && positiveInteger(claim.workflowId)
    && positiveInteger(claim.selectionRevision)
    && typeof claim.repository === 'string'
    && positiveInteger(claim.pullRequest)
    && typeof claim.headSha === 'string'
    && typeof claim.baseSha === 'string'
    && typeof claim.diffDigest === 'string'
    && typeof claim.changedPathDigest === 'string'
    && positiveInteger(claim.changedPathCount)
    && claim.reviewer && typeof claim.reviewer === 'object';
}

const TERMINAL_UNKNOWN_STAGES = new Set([
  'DISPATCH_ACK_UNKNOWN',
  'DISPATCH_ACK_AMBIGUOUS',
  'STALE_BEFORE_DISPATCH',
  'OBSERVE_UNKNOWN',
  'OBSERVE_AMBIGUOUS',
  'OBSERVED_RUN_IDENTITY_MISMATCH',
  'BOUNDARY_REJECTED',
  'COLLECTION_PIN_MISMATCH',
  'STALE_BEFORE_OBSERVE',
  'STALE_BEFORE_RECEIPT'
]);
const NONADVANCING_ATTEMPT_STAGES = new Set([
  'OBSERVE_PREPARING',
  'RECEIPT_PREPARING'
]);

async function recordUnknown(store, claim, stage, remainingMs, extra = {}) {
  return callWithinBudget(store.commit.bind(store), {
    claim,
    transition: {kind: 'UNKNOWN', stage, ...extra}
  }, remainingMs);
}

function expectedIdentityFromClaim(claim, changedPaths) {
  return Object.freeze({
    reviewRequestId: claim.reviewRequestId,
    sessionId: claim.sessionId,
    reviewer: claim.reviewer,
    repository: claim.repository,
    pullRequest: claim.pullRequest,
    headSha: claim.headSha,
    baseSha: claim.baseSha,
    diffDigest: claim.diffDigest,
    changedPaths
  });
}

export async function startReviewLifecycle({
  enabled = false,
  collected,
  store,
  dispatchReview,
  reviewerIdentity,
  revalidate,
  now = Date.now,
  expiresAt,
  maxRuntimeMs = MAX_RUNTIME_MS,
  reviewDeadlineMs = 300000,
  claimOwner = 'm11-review-lifecycle'
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (!isVerifiedCollection(collected, now()) || collected.status !== 'READY'
    || !validChangedPathsInventory(collected.changedPaths)
    || typeof collected.changedPathDigest !== 'string') {
    return waiting('UNVERIFIED_OR_EXPIRED_CI_COLLECTION');
  }
  if (!store || store.available !== true || typeof store.read !== 'function'
    || typeof store.claim !== 'function' || typeof store.commit !== 'function'
    || typeof dispatchReview !== 'function'
    || typeof revalidate !== 'function'
    || !reviewerIdentity || ['provider', 'agent', 'model', 'transport']
      .some(key => typeof reviewerIdentity[key] !== 'string'
        || reviewerIdentity[key].length === 0
        || Buffer.byteLength(reviewerIdentity[key], 'utf8') > MAX_ID_BYTES)
    || !validRuntimeMs(maxRuntimeMs) || !validDeadlineMs(reviewDeadlineMs)
    || !positiveInteger(expiresAt) || typeof claimOwner !== 'string' || claimOwner.length < 3) {
    return waiting('START_ADAPTER_UNAVAILABLE');
  }

  const started = performance.now();
  const startedAt = now();
  const deadline = Math.min(expiresAt, collected.expiresAt);
  if (!positiveInteger(startedAt) || startedAt >= deadline) return waiting('PILOT_OR_COLLECTION_EXPIRED');
  const budgetExpired = () => performance.now() - started > maxRuntimeMs || now() >= deadline;
  const remainingMs = () => Math.min(maxRuntimeMs - (performance.now() - started), deadline - now());

  const reviewRequestId = createHash('sha256').update([
    collected.actionKey,
    collected.executionKey,
    collected.diffDigest,
    'review-request'
  ].join('|')).digest('hex');
  const sessionId = createHash('sha256').update([
    reviewRequestId,
    reviewerIdentity.provider,
    reviewerIdentity.model,
    'session'
  ].join('|')).digest('hex').slice(0, 40);

  try {
    const beforeClaim = await revalidateCollection({revalidate, expected: collected, remainingMs: remainingMs(), now});
    if (!beforeClaim.ok || budgetExpired()) {
      return waiting(beforeClaim.timedOut ? 'REVALIDATION_TIMEOUT'
        : beforeClaim.missing ? 'FRESH_COLLECTION_REQUIRED' : 'STALE_OR_UNKNOWN_BEFORE_CLAIM');
    }
    const snapshotCall = await callWithinBudget(store.read.bind(store), {}, remainingMs());
    if (snapshotCall.timedOut || snapshotCall.error || budgetExpired() || snapshotCall.value?.status !== 'READY') {
      return waiting('STATE_UNAVAILABLE');
    }
    const packetKey = createHash('sha256').update([
      collected.repository,
      collected.pullRequest,
      collected.headSha,
      collected.baseSha
    ].join('|')).digest('hex');
    const claimCall = await callWithinBudget(store.claim.bind(store), {
      actionKey: collected.actionKey,
      executionKey: collected.executionKey,
      packetKey,
      maxPackets: 3,
      expectedRevision: snapshotCall.value.snapshot.revision,
      expectedOid: snapshotCall.value.snapshot.oid,
      owner: claimOwner,
      now: startedAt
    }, remainingMs());
    if (claimCall.timedOut || claimCall.error || claimCall.value?.status === 'CLAIM_UNKNOWN') {
      return unknown('CLAIM_OUTCOME_UNKNOWN', false);
    }
    if (claimCall.value?.status !== 'CLAIMED') {
      return Object.freeze({
        status: 'WAITING',
        reason: claimCall.value?.status || 'CLAIM_NOT_ACQUIRED',
        ...baseResult()
      });
    }
    let claim = claimCall.value.claim;
    const pendingTransition = {
      kind: 'REVIEW_PENDING',
      actionKey: collected.actionKey,
      executionKey: collected.executionKey,
      reviewRequestId,
      sessionId,
      reviewer: reviewerIdentity,
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      diffDigest: collected.diffDigest,
      changedPathDigest: collected.changedPathDigest,
      changedPathCount: collected.changedPaths.length,
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      selectionRevision: collected.selectionRevision,
      reviewDeadlineAt: startedAt + reviewDeadlineMs
    };
    const pendingCommit = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: pendingTransition
    }, remainingMs());
    if (pendingCommit.timedOut || pendingCommit.error || pendingCommit.value?.status !== 'COMMITTED') {
      return unknown('PENDING_STATE_COMMIT_UNKNOWN', false);
    }
    claim = pendingCommit.value.claim;

    const beforeDispatch = await revalidateCollection({revalidate, expected: beforeClaim.collected, remainingMs: remainingMs(), now});
    if (!beforeDispatch.ok || budgetExpired()) {
      await recordUnknown(store, claim, 'STALE_BEFORE_DISPATCH', remainingMs(), {reviewRequestId, sessionId});
      return unknown(beforeDispatch.missing ? 'FRESH_COLLECTION_REQUIRED' : 'STALE_OR_UNKNOWN_BEFORE_DISPATCH', false);
    }
    const dispatchCall = await callWithinBudget(dispatchReview, {
      reviewRequestId,
      sessionId,
      reviewer: reviewerIdentity,
      reviewDeadlineAt: startedAt + reviewDeadlineMs,
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      diffDigest: collected.diffDigest,
      actionKey: collected.actionKey,
      executionKey: collected.executionKey
    }, remainingMs());
    if (dispatchCall.timedOut || dispatchCall.error) {
      await recordUnknown(store, claim, 'DISPATCH_ACK_UNKNOWN', remainingMs(), {reviewRequestId, sessionId});
      return unknown('DISPATCH_ACK_UNKNOWN', true);
    }
    const ack = dispatchCall.value;
    if (!ack || ack.status !== 'ACKNOWLEDGED'
      || ack.reviewRequestId !== reviewRequestId || ack.sessionId !== sessionId) {
      await recordUnknown(store, claim, 'DISPATCH_ACK_AMBIGUOUS', remainingMs(), {reviewRequestId, sessionId});
      return unknown('DISPATCH_ACK_AMBIGUOUS', true);
    }
    const acknowledgedCommit = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {
        kind: 'DISPATCH_ACKED',
        reviewRequestId,
        sessionId
      }
    }, remainingMs());
    if (acknowledgedCommit.timedOut || acknowledgedCommit.error || acknowledgedCommit.value?.status !== 'COMMITTED') {
      return unknown('DISPATCH_ACK_COMMIT_UNKNOWN', true);
    }
    return Object.freeze({
      status: 'REVIEW_PENDING',
      reviewRequestId,
      sessionId,
      reviewDeadlineAt: startedAt + reviewDeadlineMs,
      ...baseResult()
    });
  } catch {
    return unknown('START_FAILURE_RECONCILE', false);
  }
}

export async function observeReviewLifecycle({
  enabled = false,
  executionKey,
  store,
  observeReview,
  revalidate,
  collected,
  trustedRuntimeSeam,
  receipt,
  now = Date.now,
  expiresAt,
  maxRuntimeMs = MAX_RUNTIME_MS
} = {}) {
  if (enabled !== true) return waiting('DISABLED');
  if (!isVerifiedCollection(collected, now()) || collected?.status !== 'READY'
    || !validChangedPathsInventory(collected?.changedPaths)
    || typeof collected?.changedPathDigest !== 'string') {
    return waiting('FRESH_COLLECTION_REQUIRED');
  }
  if (typeof executionKey !== 'string' || !/^[a-f0-9]{64}$/.test(executionKey)
    || !store || store.available !== true || typeof store.reconcile !== 'function'
    || typeof store.commit !== 'function' || typeof observeReview !== 'function'
    || typeof revalidate !== 'function'
    || !receipt || typeof receipt.postOnce !== 'function' || typeof receipt.lookupByActionKey !== 'function'
    || !trustedRuntimeSeam || typeof trustedRuntimeSeam.verifyRuntimeEvidence !== 'function'
    || !validRuntimeMs(maxRuntimeMs) || !positiveInteger(expiresAt)) {
    return waiting('OBSERVE_ADAPTER_UNAVAILABLE');
  }
  const started = performance.now();
  const startedAt = now();
  if (!positiveInteger(startedAt) || startedAt >= expiresAt) return waiting('PILOT_OR_COLLECTION_EXPIRED');
  const budgetExpired = () => performance.now() - started > maxRuntimeMs || now() >= expiresAt;
  const remainingMs = () => Math.min(maxRuntimeMs - (performance.now() - started), expiresAt - now());
  try {
    const durableCall = await callWithinBudget(
      ({signal}) => store.reconcile(executionKey, {signal}),
      {},
      remainingMs()
    );
    if (durableCall.timedOut || durableCall.error || durableCall.value?.status !== 'READY') {
      return unknown('DURABLE_CLAIM_EVIDENCE_MISSING_OR_CONFLICTING', false);
    }
    let claim = durableCall.value.claim;
    if (!claim || claim.executionKey !== executionKey || !claimHasPendingIdentity(claim)) {
      return unknown('DURABLE_PENDING_IDENTITY_MISSING', false);
    }
    if (claim.status === 'UNKNOWN' && TERMINAL_UNKNOWN_STAGES.has(claim.lastStage)) {
      return unknown('TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION', false);
    }
    if (claim.lastStage === 'REVIEW_PENDING') {
      return unknown('DISPATCH_ACK_DURABILITY_MISSING', true);
    }
    if (NONADVANCING_ATTEMPT_STAGES.has(claim.lastStage)) {
      return unknown('PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED', false);
    }
    if (claim.lastStage === 'RECEIPT_DELIVERED' && claim.status === 'COMMITTED') {
      return Object.freeze({
        status: 'COMPLETE',
        completionState: claim.completionState || 'COMPLETE',
        receiptId: claim.receiptId,
        ...baseResult()
      });
    }
    if (claim.lastStage === 'RECEIPT_POSTING'
      || (claim.status === 'UNKNOWN'
        && ['RECEIPT_DELIVERY_UNKNOWN', 'RECEIPT_READBACK_UNKNOWN', 'RECEIPT_STATE_COMMIT_UNKNOWN']
          .includes(claim.lastStage))) {
      const lookup = await callWithinBudget(receipt.lookupByActionKey.bind(receipt), {
        actionKey: claim.executionKey
      }, remainingMs());
      if (lookup.timedOut || lookup.error || lookup.value?.complete !== true
        || !['FOUND', 'NOT_FOUND'].includes(lookup.value?.status)
        || !Array.isArray(lookup.value?.receiptIds)) {
        return unknown('RECEIPT_READBACK_UNKNOWN', true);
      }
      if (lookup.value.status === 'FOUND'
        && lookup.value.receiptIds.length === 1
        && typeof lookup.value.receiptIds[0] === 'string'
        && lookup.value.receiptIds[0].length > 0) {
        return Object.freeze({
          status: 'UNKNOWN',
          reason: 'RECEIPT_FOUND_RECONCILE_REQUIRED',
          receiptId: lookup.value.receiptIds[0],
          ...baseResult(),
          externalEffects: true
        });
      }
      return unknown('RECEIPT_NOT_CONFIRMED_NO_REPOST', true);
    }
    if ((claim.lastStage === 'DISPATCH_ACKED' || claim.lastStage === 'OBSERVE_PENDING')
      && claim.status !== 'REVIEW_PENDING') {
      return unknown('UNSUPPORTED_DURABLE_STATE_PAIR', false);
    }
    if (claim.lastStage === 'REVIEW_RESULT'
      && (claim.completionState === 'COMPLETE' || claim.completionState === 'REVISION_REQUIRED')
      && claim.status !== 'REVIEWED') {
      return unknown('UNSUPPORTED_DURABLE_STATE_PAIR', false);
    }
    if (claim.lastStage === 'REVIEW_RESULT'
      && claim.completionState && claim.completionState !== 'COMPLETE'
      && claim.completionState !== 'REVISION_REQUIRED') {
      return Object.freeze({
        status: 'INCOMPLETE',
        completionState: claim.completionState,
        verdict: claim.verdict || 'NEEDS_MORE_EVIDENCE',
        ...baseResult()
      });
    }
    const observePendingEntry = claim.status === 'REVIEW_PENDING'
      && (claim.lastStage === 'DISPATCH_ACKED' || claim.lastStage === 'OBSERVE_PENDING');
    const persistedCompletion = claim.status === 'REVIEWED'
      && claim.lastStage === 'REVIEW_RESULT'
      && (claim.completionState === 'COMPLETE' || claim.completionState === 'REVISION_REQUIRED')
      ? Object.freeze({
        completionState: claim.completionState,
        verdict: typeof claim.verdict === 'string' && claim.verdict.length > 0
          ? claim.verdict
          : 'NEEDS_MORE_EVIDENCE'
      })
      : null;
    if (!observePendingEntry && !persistedCompletion) {
      return unknown('UNSUPPORTED_DURABLE_STATE_PAIR', false);
    }
    let completionState;
    let verdict;
    let receiptPreparationCommitted = false;
    if (observePendingEntry) {
      const observePreparingCommit = await callWithinBudget(store.commit.bind(store), {
        claim,
        transition: {kind: 'OBSERVE_PREPARING'}
      }, remainingMs());
      if (observePreparingCommit.timedOut || observePreparingCommit.error || observePreparingCommit.value?.status !== 'COMMITTED') {
        return unknown('OBSERVE_PREPARING_STATE_UNKNOWN', false);
      }
      claim = observePreparingCommit.value.claim;
    } else {
      completionState = persistedCompletion.completionState;
      verdict = persistedCompletion.verdict;
      const receiptPreparingCommit = await callWithinBudget(store.commit.bind(store), {
        claim,
        transition: {
          kind: 'RECEIPT_PREPARING',
          completionState,
          verdict
        }
      }, remainingMs());
      if (receiptPreparingCommit.timedOut || receiptPreparingCommit.error
        || receiptPreparingCommit.value?.status !== 'COMMITTED') {
        return unknown('RECEIPT_PREPARING_STATE_UNKNOWN', false);
      }
      claim = receiptPreparingCommit.value.claim;
      receiptPreparationCommitted = true;
    }
    const revalidated = await revalidateCollection({
      revalidate,
      expected: collected,
      remainingMs: remainingMs(),
      now
    });
    if (!revalidated.ok || budgetExpired()) {
      const staleStage = observePendingEntry ? 'STALE_BEFORE_OBSERVE' : 'STALE_BEFORE_RECEIPT';
      await recordUnknown(store, claim, staleStage, remainingMs(), {
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      });
      return unknown(revalidated.missing
        ? 'FRESH_COLLECTION_REQUIRED'
        : observePendingEntry ? 'STALE_OR_UNKNOWN_BEFORE_OBSERVE' : 'STALE_OR_UNKNOWN_BEFORE_RECEIPT', false);
    }
    const fresh = revalidated.collected;
    if (claim.actionKey !== fresh.actionKey || claim.executionKey !== fresh.executionKey
      || claim.headSha !== fresh.headSha || claim.baseSha !== fresh.baseSha
      || claim.runId !== fresh.runId || claim.runAttempt !== fresh.runAttempt
      || claim.workflowId !== fresh.workflowId || claim.selectionRevision !== fresh.selectionRevision
      || claim.diffDigest !== fresh.diffDigest
      || claim.changedPathDigest !== fresh.changedPathDigest
      || claim.changedPathCount !== fresh.changedPaths.length) {
      await recordUnknown(store, claim, 'COLLECTION_PIN_MISMATCH', remainingMs(), {
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      });
      return unknown('COLLECTION_PIN_MISMATCH', false);
    }
    if (observePendingEntry && now() > claim.reviewDeadlineAt) {
      const timeoutCommit = await callWithinBudget(store.commit.bind(store), {
        claim,
        transition: {
          kind: 'REVIEW_RESULT',
          completionState: 'INCOMPLETE',
          verdict: 'NEEDS_MORE_EVIDENCE',
          reason: 'REVIEW_DEADLINE_EXPIRED'
        }
      }, remainingMs());
      if (timeoutCommit.timedOut || timeoutCommit.error || timeoutCommit.value?.status !== 'COMMITTED') {
        return unknown('REVIEW_RESULT_COMMIT_UNKNOWN', false);
      }
      claim = timeoutCommit.value.claim;
      return Object.freeze({
        status: 'INCOMPLETE',
        reason: 'REVIEW_DEADLINE_EXPIRED',
        completionState: 'INCOMPLETE',
        ...baseResult()
      });
    }
    if (observePendingEntry) {
      const observeCall = await callWithinBudget(observeReview, {
        actionKey: claim.actionKey,
        executionKey: claim.executionKey,
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      }, remainingMs());
      if (observeCall.timedOut || observeCall.error) {
        await recordUnknown(store, claim, 'OBSERVE_UNKNOWN', remainingMs(), {
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId
        });
        return unknown('OBSERVE_OUTCOME_UNKNOWN', false);
      }
      const observed = observeCall.value;
      if (observed && observed.status === 'PENDING') {
        const pendingCommit = await callWithinBudget(store.commit.bind(store), {
          claim,
          transition: {kind: 'OBSERVE_PENDING'}
        }, remainingMs());
        if (pendingCommit.timedOut || pendingCommit.error || pendingCommit.value?.status !== 'COMMITTED') {
          return unknown('OBSERVE_PENDING_STATE_UNKNOWN', false);
        }
        claim = pendingCommit.value.claim;
        return Object.freeze({
          status: 'REVIEW_PENDING',
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId,
          ...baseResult()
        });
      }
      if (!observed) {
        await recordUnknown(store, claim, 'OBSERVE_AMBIGUOUS', remainingMs(), {
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId
        });
        return unknown('OBSERVE_AMBIGUOUS', false);
      }
      if (observed.status !== 'COMPLETED') {
        await recordUnknown(store, claim, 'OBSERVE_AMBIGUOUS', remainingMs(), {
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId
        });
        return unknown('OBSERVE_AMBIGUOUS', false);
      }
      if (!observed.ci || observed.ci.runId !== claim.runId
        || observed.ci.runAttempt !== claim.runAttempt
        || observed.ci.workflowId !== claim.workflowId
        || observed.ci.selectionRevision !== claim.selectionRevision) {
        await recordUnknown(store, claim, 'OBSERVED_RUN_IDENTITY_MISMATCH', remainingMs(), {
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId
        });
        return unknown('OBSERVED_RUN_IDENTITY_MISMATCH', false);
      }
      const observedAtMs = Number.isSafeInteger(observed.observedAtMs) ? observed.observedAtMs : now();
      if (observedAtMs > claim.reviewDeadlineAt) {
        const lateCommit = await callWithinBudget(store.commit.bind(store), {
          claim,
          transition: {
            kind: 'REVIEW_RESULT',
            completionState: 'INCOMPLETE',
            verdict: 'NEEDS_MORE_EVIDENCE',
            reason: 'LATE_COMPLETION_AFTER_DEADLINE'
          }
        }, remainingMs());
        if (lateCommit.timedOut || lateCommit.error || lateCommit.value?.status !== 'COMMITTED') {
          return unknown('REVIEW_RESULT_COMMIT_UNKNOWN', false);
        }
        claim = lateCommit.value.claim;
        return Object.freeze({
          status: 'INCOMPLETE',
          reason: 'LATE_COMPLETION_AFTER_DEADLINE',
          completionState: 'INCOMPLETE',
          ...baseResult()
        });
      }

      const boundary = evaluateReviewBoundary({
        trustedRuntimeSeam,
        trustedRuntimeEvidence: observed.trustedRuntimeEvidence,
        modelOutput: observed.modelOutput,
        expectedIdentity: expectedIdentityFromClaim(claim, fresh.changedPaths),
        now
      });
      if (boundary.status !== 'ADMITTED') {
        await recordUnknown(store, claim, 'BOUNDARY_REJECTED', remainingMs(), {
          reason: boundary.reason || boundary.status
        });
        return unknown('BOUNDARY_REJECTED', false);
      }
      completionState = boundary.completionState;
      verdict = boundary.verdict;
      const resultCommit = await callWithinBudget(store.commit.bind(store), {
        claim,
        transition: {
          kind: 'REVIEW_RESULT',
          completionState,
          verdict,
          reviewRequestId: claim.reviewRequestId,
          sessionId: claim.sessionId,
          evidenceId: boundary.trustedRuntime.evidenceId
        }
      }, remainingMs());
      if (resultCommit.timedOut || resultCommit.error || resultCommit.value?.status !== 'COMMITTED') {
        return unknown('REVIEW_RESULT_COMMIT_UNKNOWN', false);
      }
      claim = resultCommit.value.claim;
      if (completionState !== 'COMPLETE' && completionState !== 'REVISION_REQUIRED') {
        return Object.freeze({
          status: 'INCOMPLETE',
          completionState,
          verdict,
          ...baseResult()
        });
      }
    }
    if (!receiptPreparationCommitted) {
      const receiptPreparingCommit = await callWithinBudget(store.commit.bind(store), {
        claim,
        transition: {
          kind: 'RECEIPT_PREPARING',
          completionState,
          verdict
        }
      }, remainingMs());
      if (receiptPreparingCommit.timedOut || receiptPreparingCommit.error
        || receiptPreparingCommit.value?.status !== 'COMMITTED') {
        return unknown('RECEIPT_PREPARING_STATE_UNKNOWN', false);
      }
      claim = receiptPreparingCommit.value.claim;
      receiptPreparationCommitted = true;
    }
    const beforeReceipt = await revalidateCollection({revalidate, expected: fresh, remainingMs: remainingMs(), now});
    if (!beforeReceipt.ok || budgetExpired()) {
      await recordUnknown(store, claim, 'STALE_BEFORE_RECEIPT', remainingMs(), {
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      });
      return unknown(beforeReceipt.missing ? 'FRESH_COLLECTION_REQUIRED' : 'STALE_OR_UNKNOWN_BEFORE_RECEIPT', true);
    }

    const postingCommit = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {kind: 'RECEIPT_POSTING'}
    }, remainingMs());
    if (postingCommit.timedOut || postingCommit.error || postingCommit.value?.status !== 'COMMITTED') {
      return unknown('RECEIPT_POSTING_STATE_UNKNOWN', false);
    }
    claim = postingCommit.value.claim;

    const payload = Object.freeze({
      actionKey: claim.actionKey,
      executionKey: claim.executionKey,
      reviewRequestId: claim.reviewRequestId,
      sessionId: claim.sessionId,
      repository: claim.repository,
      pullRequest: claim.pullRequest,
      headSha: claim.headSha,
      baseSha: claim.baseSha,
      diffDigest: claim.diffDigest,
      completionState,
      verdict
    });
    const receiptCall = await callWithinBudget(receipt.postOnce.bind(receipt), {
      actionKey: claim.executionKey,
      executionKey: claim.executionKey,
      receipt: payload
    }, remainingMs());
    if (receiptCall.timedOut || receiptCall.error
      || receiptCall.value?.status !== 'CREATED'
      || typeof receiptCall.value.receiptId !== 'string'
      || receiptCall.value.receiptId.length === 0) {
      await recordUnknown(store, claim, 'RECEIPT_DELIVERY_UNKNOWN', remainingMs(), {
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      });
      return unknown('RECEIPT_DELIVERY_UNKNOWN', true);
    }
    const lookupCall = await callWithinBudget(receipt.lookupByActionKey.bind(receipt), {
      actionKey: claim.executionKey
    }, remainingMs());
    if (lookupCall.timedOut || lookupCall.error || lookupCall.value?.status !== 'FOUND'
      || lookupCall.value.complete !== true || !Array.isArray(lookupCall.value.receiptIds)
      || lookupCall.value.receiptIds.length !== 1
      || lookupCall.value.receiptIds[0] !== receiptCall.value.receiptId) {
      await recordUnknown(store, claim, 'RECEIPT_READBACK_UNKNOWN', remainingMs(), {
        reviewRequestId: claim.reviewRequestId,
        sessionId: claim.sessionId
      });
      return unknown('RECEIPT_READBACK_UNKNOWN', true);
    }
    const finalCommit = await callWithinBudget(store.commit.bind(store), {
      claim,
      transition: {
        kind: 'RECEIPT_DELIVERED',
        receiptId: receiptCall.value.receiptId,
        completionState,
        verdict
      }
    }, remainingMs());
    if (finalCommit.timedOut || finalCommit.error || finalCommit.value?.status !== 'COMMITTED') {
      return unknown('RECEIPT_STATE_COMMIT_UNKNOWN', true);
    }
    return Object.freeze({
      status: 'COMPLETE',
      completionState,
      verdict,
      receiptId: receiptCall.value.receiptId,
      ...baseResult()
    });
  } catch {
    return unknown('OBSERVE_FAILURE_RECONCILE', false);
  }
}
