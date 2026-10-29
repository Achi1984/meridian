import {createHash, randomBytes} from 'node:crypto';
import {createAdmissionRecordState, reduceAdmissionRecord} from './m11-admission-record.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const MAX_TRANSITION_CHAIN = 1024;
const MAX_TRANSITION_BYTES = 16384;
const MAX_CHAIN_BYTES = 262144;
const ROOT_DIGEST = createHash('sha256').update('m11-atomic-record-root').digest('hex');

const UNKNOWN_STAGE_MAP = Object.freeze({
  STALE_BEFORE_DISPATCH: 'ADMISSION',
  STALE_BEFORE_OBSERVE: 'EFFECT',
  OBSERVE_UNKNOWN: 'EFFECT',
  OBSERVE_AMBIGUOUS: 'EFFECT',
  OBSERVED_RUN_IDENTITY_MISMATCH: 'EFFECT',
  COLLECTION_PIN_MISMATCH: 'EFFECT',
  BOUNDARY_REJECTED: 'EFFECT',
  STALE_BEFORE_RECEIPT: 'CHECKPOINT',
  RECEIPT_DELIVERY_UNKNOWN: 'CHECKPOINT',
  RECEIPT_READBACK_UNKNOWN: 'CHECKPOINT',
  RECEIPT_STATE_COMMIT_UNKNOWN: 'CHECKPOINT',
  DISPATCH_ACK_UNKNOWN: 'ADMISSION',
  DISPATCH_ACK_AMBIGUOUS: 'ADMISSION'
});

const TRANSITION_KEYSETS = Object.freeze({
  CLAIM_CREATED: ['actionKey', 'executionKey', 'owner', 'createdAt', 'claimId'],
  REVIEW_PENDING: ['kind', 'actionKey', 'executionKey', 'reviewRequestId', 'sessionId', 'reviewer', 'repository', 'pullRequest',
    'headSha', 'baseSha', 'diffDigest', 'changedPathDigest', 'changedPathCount', 'runId',
    'runAttempt', 'workflowId', 'selectionRevision', 'reviewDeadlineAt'],
  DISPATCH_ACKED: ['kind', 'reviewRequestId', 'sessionId'],
  OBSERVE_PREPARING: ['kind'],
  OBSERVE_PENDING: ['kind'],
  REVIEW_RESULT: ['kind', 'completionState', 'verdict',
    'reviewRequestId', 'sessionId', 'evidenceId', 'reason'],
  RECEIPT_PREPARING: ['kind', 'completionState', 'verdict'],
  RECEIPT_POSTING: ['kind'],
  RECEIPT_DELIVERED: ['kind', 'receiptId', 'completionState', 'verdict'],
  UNKNOWN: ['kind', 'stage', 'reviewRequestId', 'sessionId', 'reason']
});

export const ATOMIC_RECORD_BACKEND_LIMITS = Object.freeze({
  MAX_TRANSITION_CHAIN,
  MAX_TRANSITION_BYTES,
  MAX_CHAIN_BYTES
});

function clone(value) {
  return structuredClone(value);
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validKey(value) {
  return typeof value === 'string' && HEX64.test(value);
}

function validOwner(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,100}$/.test(value);
}

function validSnapshot(value) {
  return value && Number.isSafeInteger(value.revision) && value.revision >= 0
    && typeof value.oid === 'string' && value.oid.length > 0
    && value.chainValid === true;
}

function mapAdmissionBlockToClaimStatus(reason) {
  if (reason === 'QUOTA_EXHAUSTED') return 'BUDGET_EXHAUSTED';
  if (reason === 'DUPLICATE_EXECUTION_KEY' || reason === 'DUPLICATE_LOGICAL_ACTION') return 'EXISTS';
  if (reason === 'ACTIVE_GATE_HELD') return 'BUSY';
  return 'UNKNOWN';
}

function validObservedCompletionPair(completionState, verdict) {
  return (completionState === 'COMPLETE' && verdict === 'GREEN_LIGHT')
    || (completionState === 'REVISION_REQUIRED' && verdict === 'REVISION_REQUIRED')
    || (completionState === 'INCOMPLETE' && verdict === 'NEEDS_MORE_EVIDENCE');
}

function validTerminalCompletionPair(completionState, verdict) {
  return (completionState === 'COMPLETE' && verdict === 'GREEN_LIGHT')
    || (completionState === 'REVISION_REQUIRED' && verdict === 'REVISION_REQUIRED');
}

function makeClaimId(actionKey, executionKey, admissionRevision, storageVersion) {
  return hash([
    actionKey,
    executionKey,
    String(admissionRevision),
    String(storageVersion),
    randomBytes(8).toString('hex')
  ].join('|')).slice(0, 40);
}

function verifyTransitionShape(kind, transition) {
  const keys = TRANSITION_KEYSETS[kind];
  if (!keys || !transition || typeof transition !== 'object' || Array.isArray(transition)) return false;
  if (kind !== 'CLAIM_CREATED' && transition.kind !== kind) return false;
  if (bytes(transition) > MAX_TRANSITION_BYTES) return false;
  if (!Object.keys(transition).every(key => keys.includes(key))) return false;
  if (kind === 'REVIEW_PENDING') {
    return validKey(transition.actionKey) && validKey(transition.executionKey)
      && typeof transition.reviewRequestId === 'string' && transition.reviewRequestId.length > 0
      && typeof transition.sessionId === 'string' && transition.sessionId.length > 0
      && transition.reviewer && typeof transition.reviewer === 'object' && !Array.isArray(transition.reviewer)
      && typeof transition.repository === 'string' && transition.repository.length > 0
      && Number.isSafeInteger(transition.pullRequest) && transition.pullRequest > 0
      && typeof transition.headSha === 'string' && transition.headSha.length > 0
      && typeof transition.baseSha === 'string' && transition.baseSha.length > 0
      && typeof transition.diffDigest === 'string' && transition.diffDigest.length > 0
      && typeof transition.changedPathDigest === 'string' && transition.changedPathDigest.length > 0
      && Number.isSafeInteger(transition.changedPathCount) && transition.changedPathCount > 0
      && Number.isSafeInteger(transition.runId) && transition.runId > 0
      && Number.isSafeInteger(transition.runAttempt) && transition.runAttempt > 0
      && Number.isSafeInteger(transition.workflowId) && transition.workflowId > 0
      && Number.isSafeInteger(transition.selectionRevision) && transition.selectionRevision > 0
      && Number.isSafeInteger(transition.reviewDeadlineAt) && transition.reviewDeadlineAt > 0;
  }
  if (kind === 'DISPATCH_ACKED') {
    return typeof transition.reviewRequestId === 'string' && transition.reviewRequestId.length > 0
      && typeof transition.sessionId === 'string' && transition.sessionId.length > 0;
  }
  if (kind === 'OBSERVE_PREPARING' || kind === 'OBSERVE_PENDING') {
    return true;
  }
  if (kind === 'REVIEW_RESULT') {
    if (!validObservedCompletionPair(transition.completionState, transition.verdict)) return false;
    if (transition.completionState === 'INCOMPLETE') {
      return typeof transition.reason === 'string' && transition.reason.length > 0
        && !Object.hasOwn(transition, 'reviewRequestId')
        && !Object.hasOwn(transition, 'sessionId');
    }
    return typeof transition.reviewRequestId === 'string' && transition.reviewRequestId.length > 0
      && typeof transition.sessionId === 'string' && transition.sessionId.length > 0
      && (!Object.hasOwn(transition, 'evidenceId')
        || (typeof transition.evidenceId === 'string' && transition.evidenceId.length > 0))
      && (!Object.hasOwn(transition, 'reason')
        || (typeof transition.reason === 'string' && transition.reason.length > 0));
  }
  if (kind === 'RECEIPT_PREPARING') {
    return validTerminalCompletionPair(transition.completionState, transition.verdict);
  }
  if (kind === 'RECEIPT_POSTING') return true;
  if (kind === 'RECEIPT_DELIVERED') {
    return typeof transition.receiptId === 'string' && transition.receiptId.length > 0
      && validTerminalCompletionPair(transition.completionState, transition.verdict);
  }
  if (kind === 'UNKNOWN') {
    return typeof transition.stage === 'string' && transition.stage.length > 0
      && (!Object.hasOwn(transition, 'reviewRequestId')
        || (typeof transition.reviewRequestId === 'string' && transition.reviewRequestId.length > 0))
      && (!Object.hasOwn(transition, 'sessionId')
        || (typeof transition.sessionId === 'string' && transition.sessionId.length > 0))
      && (!Object.hasOwn(transition, 'reason')
        || (typeof transition.reason === 'string' && transition.reason.length > 0));
  }
  if (kind === 'CLAIM_CREATED') {
    return validKey(transition.actionKey)
      && validKey(transition.executionKey)
      && typeof transition.claimId === 'string' && transition.claimId.length > 0
      && validOwner(transition.owner)
      && Number.isSafeInteger(transition.createdAt);
  }
  return false;
}

function transitionDigest(kind, transition) {
  return hash({kind, transition});
}

function recordDigest(record) {
  return hash({
    storageVersion: record.storageVersion,
    parentStorageVersion: record.parentStorageVersion,
    parentDigest: record.parentDigest,
    kind: record.kind,
    claimId: record.claimId,
    actionKey: record.actionKey,
    executionKey: record.executionKey,
    publicRevision: record.publicRevision,
    publicOid: record.publicOid,
    transitionDigest: record.transitionDigest
  });
}

function validClaim(claim) {
  return claim && validKey(claim.actionKey) && validKey(claim.executionKey)
    && typeof claim.claimId === 'string' && claim.claimId.length > 0
    && validOwner(claim.owner)
    && Number.isSafeInteger(claim.createdAt)
    && Number.isSafeInteger(claim.admissionRevision) && claim.admissionRevision > 0
    && Number.isSafeInteger(claim.expectedRevision) && claim.expectedRevision >= 0
    && typeof claim.expectedOid === 'string' && claim.expectedOid.length > 0
    && typeof claim.status === 'string' && typeof claim.lastStage === 'string'
    && Number.isSafeInteger(claim.storageVersion) && claim.storageVersion >= 1;
}

function reducer(inputState, event) {
  try {
    return reduceAdmissionRecord(inputState, event);
  } catch {
    return null;
  }
}

function findClaim(claims, executionKey) {
  return claims.find(entry => entry.executionKey === executionKey) || null;
}

function requireTransitionIdentity(claim, transition) {
  if (Object.hasOwn(transition, 'actionKey') && transition.actionKey !== claim.actionKey) return false;
  if (Object.hasOwn(transition, 'executionKey') && transition.executionKey !== claim.executionKey) return false;
  if (Object.hasOwn(transition, 'reviewRequestId') && claim.reviewRequestId
    && transition.reviewRequestId !== claim.reviewRequestId) return false;
  if (Object.hasOwn(transition, 'sessionId') && claim.sessionId
    && transition.sessionId !== claim.sessionId) return false;
  return true;
}

function canApplyTransition(claim, transition) {
  if (!requireTransitionIdentity(claim, transition)) return false;
  if (claim.status === 'COMMITTED') return false;
  if (claim.status === 'UNKNOWN' && transition.kind !== 'UNKNOWN') return false;
  if (transition.kind === 'UNKNOWN') return claim.status !== 'COMMITTED';

  if (transition.kind === 'REVIEW_PENDING') {
    return claim.status === 'CLAIMED' && claim.lastStage === 'CLAIMED';
  }
  if (transition.kind === 'DISPATCH_ACKED') {
    return claim.status === 'REVIEW_PENDING' && claim.lastStage === 'REVIEW_PENDING'
      && transition.reviewRequestId === claim.reviewRequestId
      && transition.sessionId === claim.sessionId;
  }
  if (transition.kind === 'OBSERVE_PREPARING') {
    return claim.status === 'REVIEW_PENDING'
      && (claim.lastStage === 'DISPATCH_ACKED' || claim.lastStage === 'OBSERVE_PENDING');
  }
  if (transition.kind === 'OBSERVE_PENDING') {
    return claim.status === 'REVIEW_PENDING' && claim.lastStage === 'OBSERVE_PREPARING';
  }
  if (transition.kind === 'REVIEW_RESULT') {
    return claim.status === 'REVIEW_PENDING' && claim.lastStage === 'OBSERVE_PREPARING'
      && validObservedCompletionPair(transition.completionState, transition.verdict);
  }
  if (transition.kind === 'RECEIPT_PREPARING') {
    return claim.status === 'REVIEWED' && claim.lastStage === 'REVIEW_RESULT'
      && validTerminalCompletionPair(claim.completionState, claim.verdict)
      && transition.completionState === claim.completionState
      && transition.verdict === claim.verdict;
  }
  if (transition.kind === 'RECEIPT_POSTING') {
    return claim.status === 'REVIEWED' && claim.lastStage === 'RECEIPT_PREPARING';
  }
  if (transition.kind === 'RECEIPT_DELIVERED') {
    return claim.status === 'RECEIPT_POSTING' && claim.lastStage === 'RECEIPT_POSTING'
      && typeof transition.receiptId === 'string' && transition.receiptId.length > 0
      && transition.completionState === claim.completionState
      && transition.verdict === claim.verdict
      && validTerminalCompletionPair(transition.completionState, transition.verdict);
  }
  return false;
}

function applyUnknownAdmission(admissionState, claim, stage) {
  const reduced = reducer(admissionState, {
    kind: 'MARK_UNKNOWN',
    logicalActionId: claim.actionKey,
    executionKey: claim.executionKey,
    stage: UNKNOWN_STAGE_MAP[stage] || 'CHECKPOINT'
  });
  if (!reduced || reduced.status !== 'UNKNOWN' || reduced.changed !== true) return null;
  return reduced.state;
}

function applyTransitionMutation({admissionState, claim, transition}) {
  const nextClaim = clone(claim);
  let nextAdmissionState = admissionState;

  if (transition.kind === 'REVIEW_PENDING') {
    nextClaim.status = 'REVIEW_PENDING';
    nextClaim.lastStage = 'REVIEW_PENDING';
    nextClaim.reviewRequestId = transition.reviewRequestId;
    nextClaim.sessionId = transition.sessionId;
    nextClaim.reviewer = clone(transition.reviewer);
    nextClaim.repository = transition.repository;
    nextClaim.pullRequest = transition.pullRequest;
    nextClaim.headSha = transition.headSha;
    nextClaim.baseSha = transition.baseSha;
    nextClaim.diffDigest = transition.diffDigest;
    nextClaim.changedPathDigest = transition.changedPathDigest;
    nextClaim.changedPathCount = transition.changedPathCount;
    nextClaim.runId = transition.runId;
    nextClaim.runAttempt = transition.runAttempt;
    nextClaim.workflowId = transition.workflowId;
    nextClaim.selectionRevision = transition.selectionRevision;
    nextClaim.reviewDeadlineAt = transition.reviewDeadlineAt;
  } else if (transition.kind === 'DISPATCH_ACKED') {
    nextClaim.status = 'REVIEW_PENDING';
    nextClaim.lastStage = 'DISPATCH_ACKED';
  } else if (transition.kind === 'OBSERVE_PREPARING') {
    nextClaim.status = 'REVIEW_PENDING';
    nextClaim.lastStage = 'OBSERVE_PREPARING';
  } else if (transition.kind === 'OBSERVE_PENDING') {
    nextClaim.status = 'REVIEW_PENDING';
    nextClaim.lastStage = 'OBSERVE_PENDING';
  } else if (transition.kind === 'REVIEW_RESULT') {
    const observed = reducer(nextAdmissionState, {
      kind: 'EFFECT_OBSERVED',
      logicalActionId: nextClaim.actionKey,
      executionKey: nextClaim.executionKey,
      admissionRevision: nextClaim.admissionRevision
    });
    if (!observed || observed.status !== 'RECORDED' || observed.changed !== true) return null;
    nextAdmissionState = observed.state;
    nextClaim.status = 'REVIEWED';
    nextClaim.lastStage = 'REVIEW_RESULT';
    nextClaim.completionState = transition.completionState;
    nextClaim.verdict = transition.verdict;
    if (typeof transition.reason === 'string') nextClaim.reason = transition.reason;
    if (typeof transition.evidenceId === 'string') nextClaim.evidenceId = transition.evidenceId;
  } else if (transition.kind === 'RECEIPT_PREPARING') {
    nextClaim.lastStage = 'RECEIPT_PREPARING';
  } else if (transition.kind === 'RECEIPT_POSTING') {
    nextClaim.status = 'RECEIPT_POSTING';
    nextClaim.lastStage = 'RECEIPT_POSTING';
  } else if (transition.kind === 'RECEIPT_DELIVERED') {
    const completed = reducer(nextAdmissionState, {
      kind: 'TERMINAL_COMPLETION',
      evidence: {
        logicalActionId: nextClaim.actionKey,
        executionKey: nextClaim.executionKey,
        admissionRevision: nextClaim.admissionRevision,
        effect: 'COMPLETED',
        checkpointAcknowledged: true
      }
    });
    if (!completed || completed.status !== 'RECORDED' || completed.changed !== true) return null;
    nextAdmissionState = completed.state;
    nextClaim.status = 'COMMITTED';
    nextClaim.lastStage = 'RECEIPT_DELIVERED';
    nextClaim.receiptId = transition.receiptId;
  } else if (transition.kind === 'UNKNOWN') {
    const unknownState = applyUnknownAdmission(nextAdmissionState, nextClaim, transition.stage);
    if (!unknownState) return null;
    nextAdmissionState = unknownState;
    nextClaim.status = 'UNKNOWN';
    nextClaim.lastStage = transition.stage;
  } else {
    return null;
  }

  return {nextAdmissionState, nextClaim};
}

function buildTransitionRecord({
  storageVersion,
  previousRecord,
  kind,
  claim,
  publicSnapshot,
  transition
}) {
  const record = {
    storageVersion,
    parentStorageVersion: previousRecord ? previousRecord.storageVersion : 0,
    parentDigest: previousRecord ? previousRecord.digest : ROOT_DIGEST,
    kind,
    claimId: claim.claimId,
    actionKey: claim.actionKey,
    executionKey: claim.executionKey,
    publicRevision: publicSnapshot.revision,
    publicOid: publicSnapshot.oid,
    transitionDigest: transitionDigest(kind, transition),
    transition: clone(transition)
  };
  record.digest = recordDigest(record);
  return record;
}

function ensureTransitionChainCapacity(chain, nextRecord) {
  if (chain.length >= MAX_TRANSITION_CHAIN) {
    throw new Error('TRANSITION_CHAIN_CAPACITY_EXCEEDED');
  }
  const projectedBytes = bytes([...chain, nextRecord]);
  if (projectedBytes > MAX_CHAIN_BYTES) {
    throw new Error('TRANSITION_CHAIN_BYTES_EXCEEDED');
  }
}

function replayAndValidateEnvelope(envelope) {
  const chain = envelope.transitionChain;
  if (chain.length > MAX_TRANSITION_CHAIN || bytes(chain) > MAX_CHAIN_BYTES) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (chain.length === 0 && envelope.storageVersion !== 0) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (chain.length > 0 && chain[chain.length - 1].storageVersion !== envelope.storageVersion) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }

  const replay = {
    snapshot: {revision: 0, oid: 'root', chainValid: true},
    admissionState: createAdmissionRecordState({
      enabled: envelope.admissionState.enabled,
      totalQuota: envelope.admissionState.totalQuota
    }),
    claims: []
  };

  let previous = null;
  for (const item of chain) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !Number.isSafeInteger(item.storageVersion) || item.storageVersion < 1
      || !Number.isSafeInteger(item.parentStorageVersion) || item.parentStorageVersion < 0
      || typeof item.parentDigest !== 'string' || !HEX64.test(item.parentDigest)
      || typeof item.kind !== 'string'
      || typeof item.claimId !== 'string' || item.claimId.length === 0
      || !validKey(item.actionKey) || !validKey(item.executionKey)
      || !Number.isSafeInteger(item.publicRevision) || item.publicRevision < 0
      || typeof item.publicOid !== 'string' || item.publicOid.length === 0
      || typeof item.transitionDigest !== 'string' || !HEX64.test(item.transitionDigest)
      || typeof item.digest !== 'string' || !HEX64.test(item.digest)
      || !verifyTransitionShape(item.kind, item.transition)) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
    if (transitionDigest(item.kind, item.transition) !== item.transitionDigest
      || recordDigest(item) !== item.digest) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
    if (!previous) {
      if (item.parentStorageVersion !== 0 || item.parentDigest !== ROOT_DIGEST || item.storageVersion !== 1) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
    } else if (item.parentStorageVersion !== previous.storageVersion
      || item.parentDigest !== previous.digest
      || item.storageVersion !== previous.storageVersion + 1) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }

    if (item.kind === 'CLAIM_CREATED') {
      const transition = item.transition;
      if (transition.claimId !== item.claimId || transition.actionKey !== item.actionKey
        || transition.executionKey !== item.executionKey || !validOwner(transition.owner)
        || !Number.isSafeInteger(transition.createdAt)) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
      const admitted = reducer(replay.admissionState, {
        kind: 'SIMULATE_ADMISSION',
        expectedRevision: replay.admissionState.revision,
        expectedTotalQuota: replay.admissionState.totalQuota,
        logicalActionId: transition.actionKey,
        executionKey: transition.executionKey
      });
      if (!admitted || admitted.status !== 'ADMITTED' || admitted.changed !== true) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
      replay.admissionState = admitted.state;
      replay.claims.push({
        claimId: transition.claimId,
        actionKey: transition.actionKey,
        executionKey: transition.executionKey,
        owner: transition.owner,
        createdAt: transition.createdAt,
        admissionRevision: replay.admissionState.activeGate.admissionRevision,
        expectedRevision: replay.snapshot.revision,
        expectedOid: replay.snapshot.oid,
        storageVersion: item.storageVersion,
        status: 'CLAIMED',
        lastStage: 'CLAIMED'
      });
      if (item.publicRevision !== replay.snapshot.revision || item.publicOid !== replay.snapshot.oid) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
    } else {
      const claim = findClaim(replay.claims, item.executionKey);
      if (!claim || claim.claimId !== item.claimId || claim.actionKey !== item.actionKey
        || claim.storageVersion !== item.parentStorageVersion
        || claim.expectedRevision !== replay.snapshot.revision
        || claim.expectedOid !== replay.snapshot.oid
        || !canApplyTransition(claim, item.transition)) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
      const applied = applyTransitionMutation({
        admissionState: replay.admissionState,
        claim,
        transition: item.transition
      });
      if (!applied) throw new Error('INVALID_CANONICAL_ENVELOPE');
      replay.admissionState = applied.nextAdmissionState;
      replay.snapshot = {
        revision: item.publicRevision,
        oid: item.publicOid,
        chainValid: true
      };
      if (replay.snapshot.revision !== claim.expectedRevision + 1) {
        throw new Error('INVALID_CANONICAL_ENVELOPE');
      }
      applied.nextClaim.expectedRevision = replay.snapshot.revision;
      applied.nextClaim.expectedOid = replay.snapshot.oid;
      applied.nextClaim.storageVersion = item.storageVersion;
      const claimIndex = replay.claims.findIndex(entry => entry.executionKey === claim.executionKey);
      replay.claims[claimIndex] = applied.nextClaim;
    }

    previous = item;
  }

  const expectedClaims = replay.claims.sort((a, b) => a.executionKey.localeCompare(b.executionKey));
  const actualClaims = envelope.claims.map(clone).sort((a, b) => a.executionKey.localeCompare(b.executionKey));
  if (JSON.stringify(expectedClaims) !== JSON.stringify(actualClaims)
    || JSON.stringify(replay.admissionState) !== JSON.stringify(envelope.admissionState)
    || replay.snapshot.revision !== envelope.snapshot.revision
    || replay.snapshot.oid !== envelope.snapshot.oid
    || envelope.snapshot.chainValid !== true) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
}

function normalizeEnvelope(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_CANONICAL_ENVELOPE');
    const keys = ['storageVersion', 'snapshot', 'admissionState', 'claims', 'transitionChain'];
    if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
    if (!Number.isSafeInteger(input.storageVersion) || input.storageVersion < 0) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
    if (!validSnapshot(input.snapshot) || !Array.isArray(input.claims) || !Array.isArray(input.transitionChain)) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }

    const admissionState = clone(input.admissionState);
    const admissionProbe = reducer(admissionState, {
      kind: 'SIMULATE_ADMISSION',
      expectedRevision: admissionState.revision,
      expectedTotalQuota: admissionState.totalQuota,
      logicalActionId: 'a'.repeat(64),
      executionKey: 'b'.repeat(64)
    });
    if (!admissionProbe || typeof admissionProbe.status !== 'string') throw new Error('INVALID_CANONICAL_ENVELOPE');

    const claims = input.claims.map(entry => {
      const claim = clone(entry);
      if (!validClaim(claim)) throw new Error('INVALID_CANONICAL_ENVELOPE');
      return claim;
    });
    if (new Set(claims.map(claim => claim.executionKey)).size !== claims.length
      || new Set(claims.map(claim => claim.actionKey)).size !== claims.length
      || new Set(claims.map(claim => claim.claimId)).size !== claims.length) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }

    const envelope = {
      storageVersion: input.storageVersion,
      snapshot: clone(input.snapshot),
      admissionState,
      claims,
      transitionChain: input.transitionChain.map(entry => clone(entry))
    };
    replayAndValidateEnvelope(envelope);
    return Object.freeze(envelope);
  } catch {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
}

export function createAtomicRecordEnvelope({totalQuota = 3} = {}) {
  const admissionState = createAdmissionRecordState({enabled: true, totalQuota});
  return Object.freeze({
    storageVersion: 0,
    snapshot: Object.freeze({revision: 0, oid: 'root', chainValid: true}),
    admissionState,
    claims: Object.freeze([]),
    transitionChain: Object.freeze([])
  });
}

export function createAtomicRecordMemoryTransport({
  initialEnvelope = createAtomicRecordEnvelope(),
  afterReplace = null
} = {}) {
  let canonical = normalizeEnvelope(clone(initialEnvelope));
  return Object.freeze({
    async readCanonicalEnvelope() {
      return clone(canonical);
    },
    async replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope}) {
      if (!Number.isSafeInteger(expectedStorageVersion) || expectedStorageVersion < 0) {
        throw new Error('INVALID_EXPECTED_STORAGE_VERSION');
      }
      if (canonical.storageVersion !== expectedStorageVersion) {
        return Object.freeze({status: 'CONFLICT', storageVersion: canonical.storageVersion});
      }
      const normalized = normalizeEnvelope(clone(nextEnvelope));
      canonical = normalized;
      if (typeof afterReplace === 'function') {
        await afterReplace(clone(normalized));
      }
      return Object.freeze({status: 'REPLACED', storageVersion: canonical.storageVersion});
    }
  });
}

export function createCoordinatorAtomicRecordBackend({
  transport = null,
  now = Date.now
} = {}) {
  if (!transport || typeof transport.readCanonicalEnvelope !== 'function'
    || typeof transport.replaceCanonicalEnvelope !== 'function') {
    throw new Error('ATOMIC_RECORD_TRANSPORT_REQUIRED');
  }

  const immutableCommits = new Map();
  const transitionCounts = new Map();

  async function readEnvelope() {
    return normalizeEnvelope(await transport.readCanonicalEnvelope());
  }

  async function replaceEnvelope(expectedStorageVersion, nextEnvelope) {
    return transport.replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope});
  }

  function appendRecord(nextEnvelope, {kind, claim, transition, publicSnapshot}) {
    const previous = nextEnvelope.transitionChain.length > 0
      ? nextEnvelope.transitionChain[nextEnvelope.transitionChain.length - 1]
      : null;
    const record = buildTransitionRecord({
      storageVersion: nextEnvelope.storageVersion,
      previousRecord: previous,
      kind,
      claim,
      publicSnapshot,
      transition
    });
    ensureTransitionChainCapacity(nextEnvelope.transitionChain, record);
    nextEnvelope.transitionChain.push(record);
  }

  function validateCandidateEnvelope(nextEnvelope) {
    try {
      normalizeEnvelope(clone(nextEnvelope));
      return true;
    } catch {
      return false;
    }
  }

  const backend = {
    capabilities: Object.freeze({
      immutableCommits: true,
      validatedRevisionChain: true,
      atomicCreateOnlyClaims: true,
      atomicSingleWriterClaim: true,
      atomicPacketQuota: true,
      atomicExpectedOidCAS: true
    }),
    hostedAtomicityProven: false,

    async readSnapshot() {
      const envelope = await readEnvelope();
      return clone(envelope.snapshot);
    },

    async createOnlyClaim(input) {
      if (!input || input.maxActiveClaims !== 1 || input.maxPackets !== 3
        || !validKey(input.actionKey) || !validKey(input.executionKey) || !validKey(input.packetKey)
        || !validOwner(input.owner)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || typeof input.expectedOid !== 'string' || input.expectedOid.length === 0) {
        return Object.freeze({status: 'INVALID_LIMIT'});
      }

      const envelope = await readEnvelope();
      if (envelope.snapshot.revision !== input.expectedRevision || envelope.snapshot.oid !== input.expectedOid) {
        return Object.freeze({status: 'STALE_EXPECTATION'});
      }
      if (findClaim(envelope.claims, input.executionKey)) {
        return Object.freeze({status: 'EXISTS'});
      }

      const admitted = reducer(envelope.admissionState, {
        kind: 'SIMULATE_ADMISSION',
        expectedRevision: envelope.admissionState.revision,
        expectedTotalQuota: envelope.admissionState.totalQuota,
        logicalActionId: input.actionKey,
        executionKey: input.executionKey
      });
      if (!admitted) return Object.freeze({status: 'UNKNOWN'});
      if (admitted.status === 'BLOCKED') {
        return Object.freeze({status: mapAdmissionBlockToClaimStatus(admitted.reason)});
      }
      if (admitted.status !== 'ADMITTED' || admitted.changed !== true || !admitted.state.activeGate) {
        return Object.freeze({status: 'UNKNOWN'});
      }

      const nextEnvelope = clone(envelope);
      nextEnvelope.storageVersion += 1;
      nextEnvelope.admissionState = admitted.state;
      const claim = {
        claimId: makeClaimId(input.actionKey, input.executionKey,
          admitted.state.activeGate.admissionRevision, nextEnvelope.storageVersion),
        actionKey: input.actionKey,
        executionKey: input.executionKey,
        owner: input.owner,
        createdAt: Number.isSafeInteger(input.createdAt) ? input.createdAt : now(),
        admissionRevision: admitted.state.activeGate.admissionRevision,
        expectedRevision: nextEnvelope.snapshot.revision,
        expectedOid: nextEnvelope.snapshot.oid,
        storageVersion: nextEnvelope.storageVersion,
        status: 'CLAIMED',
        lastStage: 'CLAIMED'
      };
      nextEnvelope.claims.push(claim);
      try {
        appendRecord(nextEnvelope, {
          kind: 'CLAIM_CREATED',
          claim,
          transition: {
            actionKey: claim.actionKey,
            executionKey: claim.executionKey,
            owner: claim.owner,
            createdAt: claim.createdAt,
            claimId: claim.claimId
          },
          publicSnapshot: nextEnvelope.snapshot
        });
      } catch {
        return Object.freeze({status: 'UNKNOWN'});
      }
      if (!validateCandidateEnvelope(nextEnvelope)) return Object.freeze({status: 'UNKNOWN'});

      let replaced;
      try {
        replaced = await replaceEnvelope(envelope.storageVersion, nextEnvelope);
      } catch {
        return Object.freeze({status: 'UNKNOWN'});
      }
      if (replaced?.status !== 'REPLACED') {
        return Object.freeze({status: 'UNKNOWN'});
      }

      let readback;
      try {
        readback = await readEnvelope();
      } catch {
        return Object.freeze({status: 'UNKNOWN'});
      }
      const durable = findClaim(readback.claims, claim.executionKey);
      const applied = durable && durable.claimId === claim.claimId
        && durable.storageVersion === nextEnvelope.storageVersion
        && readback.storageVersion === nextEnvelope.storageVersion
        && readback.snapshot.revision === envelope.snapshot.revision
        && readback.snapshot.oid === envelope.snapshot.oid;
      return applied
        ? Object.freeze({status: 'CREATED', claimId: claim.claimId})
        : Object.freeze({status: 'UNKNOWN'});
    },

    async createImmutableCommit(input) {
      if (!input || !validKey(input.actionKey) || !validKey(input.executionKey)
        || typeof input.claimId !== 'string' || input.claimId.length === 0
        || typeof input.parentOid !== 'string' || input.parentOid.length === 0
        || !Number.isSafeInteger(input.revision) || input.revision < 1
        || typeof input.commitNonce !== 'string' || !/^[a-f0-9]{32}$/.test(input.commitNonce)
        || !input.transition || typeof input.transition !== 'object' || Array.isArray(input.transition)
        || bytes(input.transition) > MAX_TRANSITION_BYTES) {
        throw new Error('INVALID_IMMUTABLE_COMMIT');
      }
      const oid = `commit-${randomBytes(8).toString('hex')}`;
      immutableCommits.set(oid, clone(input));
      return Object.freeze({
        oid,
        parentOid: input.parentOid,
        revision: input.revision,
        commitNonce: input.commitNonce
      });
    },

    async compareAndSwapRef(input) {
      if (!input || typeof input !== 'object') return Object.freeze({status: 'CONFLICT'});
      const commit = immutableCommits.get(input.newOid);
      if (!commit || commit.claimId !== input.claimId || commit.actionKey !== input.actionKey
        || commit.executionKey !== input.executionKey || commit.parentOid !== input.expectedOid
        || commit.revision !== input.newRevision || input.newRevision !== input.expectedRevision + 1) {
        return Object.freeze({status: 'CONFLICT'});
      }

      const envelope = await readEnvelope();
      if (envelope.snapshot.oid !== input.expectedOid || envelope.snapshot.revision !== input.expectedRevision) {
        return Object.freeze({status: 'CONFLICT'});
      }
      const claim = findClaim(envelope.claims, input.executionKey);
      if (!claim || claim.claimId !== input.claimId || claim.actionKey !== input.actionKey
        || claim.storageVersion !== envelope.storageVersion
        || claim.expectedOid !== input.expectedOid || claim.expectedRevision !== input.expectedRevision
        || !canApplyTransition(claim, commit.transition)
        || !verifyTransitionShape(commit.transition.kind, commit.transition)) {
        return Object.freeze({status: 'CONFLICT'});
      }

      const applied = applyTransitionMutation({
        admissionState: envelope.admissionState,
        claim,
        transition: commit.transition
      });
      if (!applied) return Object.freeze({status: 'CONFLICT'});

      const nextEnvelope = clone(envelope);
      nextEnvelope.storageVersion += 1;
      nextEnvelope.admissionState = applied.nextAdmissionState;
      nextEnvelope.snapshot = {
        revision: input.newRevision,
        oid: input.newOid,
        chainValid: true
      };
      const nextClaim = applied.nextClaim;
      nextClaim.expectedRevision = input.newRevision;
      nextClaim.expectedOid = input.newOid;
      nextClaim.storageVersion = nextEnvelope.storageVersion;
      const claimIndex = nextEnvelope.claims.findIndex(entry => entry.executionKey === nextClaim.executionKey);
      if (claimIndex < 0) return Object.freeze({status: 'CONFLICT'});
      nextEnvelope.claims[claimIndex] = nextClaim;
      try {
        appendRecord(nextEnvelope, {
          kind: commit.transition.kind,
          claim: nextClaim,
          transition: commit.transition,
          publicSnapshot: nextEnvelope.snapshot
        });
      } catch {
        return Object.freeze({status: 'CONFLICT'});
      }
      if (!validateCandidateEnvelope(nextEnvelope)) return Object.freeze({status: 'CONFLICT'});

      const replaced = await replaceEnvelope(envelope.storageVersion, nextEnvelope);
      if (replaced?.status === 'CONFLICT') return Object.freeze({status: 'CONFLICT'});
      if (replaced?.status !== 'REPLACED') throw new Error('UNCERTAIN_WRITE_ACK');

      const readback = await readEnvelope();
      const durable = findClaim(readback.claims, nextClaim.executionKey);
      const durableApplied = durable && durable.claimId === nextClaim.claimId
        && durable.storageVersion === nextEnvelope.storageVersion
        && readback.storageVersion === nextEnvelope.storageVersion
        && readback.snapshot.revision === input.newRevision
        && readback.snapshot.oid === input.newOid;
      if (!durableApplied) throw new Error('WRITE_READBACK_MISMATCH');

      transitionCounts.set(commit.transition.kind, (transitionCounts.get(commit.transition.kind) || 0) + 1);
      return Object.freeze({status: 'COMMITTED', oid: input.newOid});
    },

    async readClaim(executionKey) {
      if (!validKey(executionKey)) return null;
      const envelope = await readEnvelope();
      const claim = findClaim(envelope.claims, executionKey);
      return claim ? clone(claim) : null;
    },

    async exportCanonicalEnvelope() {
      return clone(await readEnvelope());
    },

    committedTransitionCount(kind) {
      return transitionCounts.get(kind) || 0;
    }
  };

  return Object.freeze(backend);
}
