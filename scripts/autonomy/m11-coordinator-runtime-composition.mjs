import {isDeepStrictEqual} from 'node:util';
import {createCoordinatorAtomicRecordBackend} from './m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from './m11-coordinator-state-store.mjs';
import {isVerifiedCollection} from './m11-coordinator-collector.mjs';
import {startReviewLifecycle, observeReviewLifecycle} from './m11-review-lifecycle.mjs';
import {projectCoordinatorStatus} from './m11-coordinator-status-projection.mjs';

const RECEIPT_FIELDS = Object.freeze([
  'actionKey', 'executionKey', 'reviewRequestId', 'sessionId', 'repository',
  'pullRequest', 'headSha', 'baseSha', 'diffDigest', 'completionState', 'verdict'
]);
const COLLECTION_FIELDS = Object.freeze([
  'actionKey', 'executionKey', 'repository', 'pullRequest', 'headSha', 'baseSha',
  'diffDigest', 'runId', 'runAttempt', 'workflowId', 'selectionRevision', 'changedPathDigest'
]);
const REVIEWER_FIELDS = Object.freeze(['provider', 'agent', 'model', 'transport']);
const RECEIPT_UNKNOWN_STAGES = new Set([
  'RECEIPT_DELIVERY_UNKNOWN', 'RECEIPT_READBACK_UNKNOWN', 'RECEIPT_STATE_COMMIT_UNKNOWN'
]);

function annotate(result) {
  return Object.freeze({
    ...result,
    scope: 'SOURCE_COMPOSITION_ONLY',
    publication: 'NOT_READY',
    receiptDelivery: 'NOT_ATTEMPTED',
    hostedAtomicityProven: false
  });
}

function blocked(reason, status = 'WAITING') {
  return annotate({
    status, reason, dispatch: false, merge: false, activation: false,
    externalEffects: false, retryAllowed: false
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.isWellFormed()
    && Buffer.byteLength(value, 'utf8') <= 120;
}

function validReviewer(value) {
  return exactKeys(value, REVIEWER_FIELDS) && REVIEWER_FIELDS.every(key => text(value[key]));
}

function validRuntime(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 10000;
}

function receiptPayload(claim) {
  return Object.fromEntries(RECEIPT_FIELDS.map(key => [key, claim[key]]));
}

function sameCollection(claim, collected) {
  return COLLECTION_FIELDS.every(key => claim[key] === collected[key])
    && claim.changedPathCount === collected.changedPaths.length;
}

function validatePosting(envelope, claim, payload, collected, reviewerIdentity) {
  const tip = envelope.transitionChain.at(-1);
  const persisted = envelope.claims.find(item => item.executionKey === claim.executionKey);
  return persisted && isDeepStrictEqual(persisted, claim)
    && claim.status === 'RECEIPT_POSTING' && claim.lastStage === 'RECEIPT_POSTING'
    && tip?.kind === 'RECEIPT_POSTING' && exactKeys(tip.transition, ['kind'])
    && tip.transition.kind === 'RECEIPT_POSTING'
    && tip.claimId === claim.claimId && tip.actionKey === claim.actionKey
    && tip.executionKey === claim.executionKey
    && tip.storageVersion === envelope.storageVersion
    && claim.storageVersion === envelope.storageVersion
    && tip.publicRevision === envelope.snapshot.revision
    && claim.expectedRevision === envelope.snapshot.revision
    && tip.publicOid === envelope.snapshot.oid && claim.expectedOid === envelope.snapshot.oid
    && /^[a-f0-9]{64}$/.test(tip.digest)
    && sameCollection(claim, collected)
    && validReviewer(claim.reviewer) && isDeepStrictEqual(claim.reviewer, reviewerIdentity)
    && text(claim.reviewRequestId) && text(claim.sessionId)
    && ((claim.completionState === 'COMPLETE' && claim.verdict === 'GREEN_LIGHT')
      || (claim.completionState === 'REVISION_REQUIRED' && claim.verdict === 'REVISION_REQUIRED'))
    && exactKeys(payload, RECEIPT_FIELDS)
    && RECEIPT_FIELDS.every(key => payload[key] === claim[key]);
}

// Dependencies are explicit; construction never reads state, the clock, or a provider.
export function createCoordinatorRuntimeComposition({
  enabled = false,
  stateTransport = null,
  now = null,
  dispatchReview = null,
  observeReview = null,
  revalidate = null,
  reviewerIdentity = null,
  trustedRuntimeSeam = null,
  receiptLookup = null
} = {}) {
  const transportValid = () => stateTransport
    && typeof stateTransport.readCanonicalEnvelope === 'function'
    && typeof stateTransport.replaceCanonicalEnvelope === 'function';
  const components = () => {
    const backend = createCoordinatorAtomicRecordBackend({transport: stateTransport, now});
    return {backend, store: createCoordinatorStateStore({backend, enabled: true})};
  };
  function preflight({collected, expiresAt, maxRuntimeMs}) {
    if (enabled !== true) return 'DISABLED';
    if (!transportValid() || typeof now !== 'function' || typeof revalidate !== 'function'
      || !validReviewer(reviewerIdentity) || !validRuntime(maxRuntimeMs)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return 'RUNTIME_INPUT_OR_SEAM_INVALID';
    return null;
  }
  function collectionPreflight(collected, expiresAt) {
    let timestamp;
    try {
      timestamp = now();
    } catch {
      return 'INVALID_CLOCK';
    }
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return 'INVALID_CLOCK';
    if (!isVerifiedCollection(collected, timestamp) || collected.status !== 'READY') {
      return 'FRESH_COLLECTION_REQUIRED';
    }
    return timestamp >= expiresAt ? 'PILOT_OR_COLLECTION_EXPIRED' : null;
  }

  async function start({
    collected, expiresAt, maxRuntimeMs = 10000, reviewDeadlineMs = 300000,
    claimOwner = 'm11-runtime-composition'
  } = {}) {
    const reason = preflight({collected, expiresAt, maxRuntimeMs});
    if (reason) return blocked(reason);
    if (typeof dispatchReview !== 'function'
      || !Number.isSafeInteger(reviewDeadlineMs) || reviewDeadlineMs < 1 || reviewDeadlineMs > 86400000
      || typeof claimOwner !== 'string' || !/^[A-Za-z0-9._:-]{3,100}$/.test(claimOwner)) {
      return blocked('START_INPUT_OR_SEAM_INVALID');
    }
    const collectionReason = collectionPreflight(collected, expiresAt);
    if (collectionReason) return blocked(collectionReason);
    const {store} = components();
    return annotate(await startReviewLifecycle({
      enabled: true, collected, store, dispatchReview, reviewerIdentity, revalidate, now,
      expiresAt, maxRuntimeMs, reviewDeadlineMs, claimOwner
    }));
  }

  async function observe({executionKey, collected, expiresAt, maxRuntimeMs = 10000} = {}) {
    const reason = preflight({collected, expiresAt, maxRuntimeMs});
    if (reason) return blocked(reason);
    if (typeof executionKey !== 'string' || !/^[a-f0-9]{64}$/.test(executionKey)
      || executionKey !== collected?.executionKey || typeof observeReview !== 'function'
      || !exactKeys(trustedRuntimeSeam, ['verifyRuntimeEvidence'])
      || typeof trustedRuntimeSeam.verifyRuntimeEvidence !== 'function'
      || !exactKeys(receiptLookup, ['lookupByExecutionKey'])
      || typeof receiptLookup.lookupByExecutionKey !== 'function') {
      return blocked('OBSERVE_INPUT_OR_SEAM_INVALID');
    }
    const collectionReason = collectionPreflight(collected, expiresAt);
    if (collectionReason) return blocked(collectionReason);
    const {backend, store} = components();
    let diagnostic = null;
    let postingClaim = null;
    let postingEnvelope = null;
    let postingCommit = null;
    let publicationAttempted = false;
    const guardedStore = Object.freeze({
      ...store,
      async reconcile(key) {
        const result = await store.reconcile(key);
        if (result.status !== 'READY') return result;
        const claim = result.claim;
        if (RECEIPT_UNKNOWN_STAGES.has(claim.lastStage)) {
          diagnostic = 'POSTING_IDENTITY_RECONCILIATION_REQUIRED';
          return {status: 'UNKNOWN'};
        }
        if (claim.status !== 'RECEIPT_POSTING' && claim.lastStage !== 'RECEIPT_POSTING') return result;
        try {
          const envelope = await backend.exportCanonicalEnvelope();
          if (!validatePosting(envelope, claim, receiptPayload(claim), collected, reviewerIdentity)) {
            diagnostic = 'POSTING_STATE_OR_PAYLOAD_MISMATCH';
            return {status: 'UNKNOWN'};
          }
          postingClaim = claim;
          postingEnvelope = envelope;
          return result;
        } catch {
          diagnostic = 'POSTING_CANONICAL_STATE_UNAVAILABLE';
          return {status: 'UNKNOWN'};
        }
      },
      async commit(input) {
        // A refused local publication is not delivery ambiguity. Keep the durable posting fence.
        if (publicationAttempted && input.transition.kind === 'UNKNOWN'
          && input.transition.stage === 'RECEIPT_DELIVERY_UNKNOWN') {
          return {status: 'BLOCKED', reason: diagnostic};
        }
        const result = await store.commit(input);
        if (input.transition.kind === 'RECEIPT_POSTING' && result.status === 'COMMITTED') {
          postingCommit = result;
        }
        return result;
      }
    });
    const receipt = Object.freeze({
      async postOnce(input) {
        publicationAttempted = true;
        diagnostic = 'POSTING_STATE_OR_PAYLOAD_MISMATCH';
        try {
          const envelope = await backend.exportCanonicalEnvelope();
          const claim = envelope.claims.find(item => item.executionKey === executionKey);
          if (!input.signal.aborted && postingCommit && claim
            && postingCommit.claim.claimId === claim.claimId
            && postingCommit.claim.actionKey === claim.actionKey
            && postingCommit.claim.executionKey === claim.executionKey
            && postingCommit.revision === envelope.snapshot.revision
            && postingCommit.oid === envelope.snapshot.oid
            && input.actionKey === executionKey && input.executionKey === executionKey
            && validatePosting(envelope, claim, input.receipt, collected, reviewerIdentity)) {
            diagnostic = 'PUBLICATION_NOT_READY';
          }
        } catch {
          diagnostic = 'POSTING_CANONICAL_STATE_UNAVAILABLE';
        }
        return {status: 'NOT_ATTEMPTED', reason: diagnostic};
      },
      async lookupByActionKey({actionKey, signal}) {
        diagnostic = 'POSTING_STATE_OR_PAYLOAD_MISMATCH';
        const envelope = await backend.exportCanonicalEnvelope();
        if (signal.aborted || actionKey !== executionKey || !postingClaim || !postingEnvelope
          || !isDeepStrictEqual(envelope, postingEnvelope)
          || !validatePosting(envelope, postingClaim, receiptPayload(postingClaim), collected, reviewerIdentity)) {
          return {status: 'UNKNOWN', complete: false, receiptIds: []};
        }
        diagnostic = null;
        const result = await receiptLookup.lookupByExecutionKey({executionKey, signal});
        if (signal.aborted || !exactKeys(result, ['status', 'complete', 'receiptIds'])
          || result.complete !== true || !Array.isArray(result.receiptIds)
          || result.receiptIds.length > 2 || !result.receiptIds.every(text)
          || !((result.status === 'NOT_FOUND' && result.receiptIds.length === 0)
            || (result.status === 'FOUND' && result.receiptIds.length > 0))) {
          return {status: 'UNKNOWN', complete: false, receiptIds: []};
        }
        return result;
      }
    });
    const result = await observeReviewLifecycle({
      enabled: true, executionKey, collected, store: guardedStore, observeReview, revalidate,
      trustedRuntimeSeam, receipt, now, expiresAt, maxRuntimeMs
    });
    return annotate(diagnostic
      ? {...result, status: 'UNKNOWN', reason: diagnostic, externalEffects: false}
      : result);
  }

  async function projectStatus({contextJson, nowMs} = {}) {
    if (enabled !== true) return blocked('DISABLED');
    if (!transportValid() || typeof contextJson !== 'string'
      || !Number.isSafeInteger(nowMs) || nowMs <= 0) return blocked('PROJECTION_INPUT_OR_SEAM_INVALID');
    try {
      const {backend} = components();
      const envelope = await backend.exportCanonicalEnvelope();
      return annotate(await projectCoordinatorStatus(JSON.stringify(envelope), contextJson, nowMs));
    } catch {
      return annotate({status: 'UNAVAILABLE', diagnostic: 'CANONICAL_STATE_UNAVAILABLE'});
    }
  }

  return Object.freeze({start, observe, projectStatus});
}
