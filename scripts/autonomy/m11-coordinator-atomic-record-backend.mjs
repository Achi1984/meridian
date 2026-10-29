import {createHash, randomBytes} from 'node:crypto';
import {createAdmissionRecordState, reduceAdmissionRecord} from './m11-admission-record.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const MAX_TRANSITION_CHAIN = 1024;

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

export const ATOMIC_RECORD_BACKEND_LIMITS = Object.freeze({
  MAX_TRANSITION_CHAIN
});

function clone(value) {
  return structuredClone(value);
}

function validKey(value) {
  return typeof value === 'string' && HEX64.test(value);
}

function validOwner(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,100}$/.test(value);
}

function validSnapshot(value) {
  return value && Number.isSafeInteger(value.revision) && value.revision >= 0
    && typeof value.oid === 'string' && value.oid.length > 0 && value.chainValid === true;
}

function mapAdmissionBlockToClaimStatus(reason) {
  if (reason === 'QUOTA_EXHAUSTED') return 'BUDGET_EXHAUSTED';
  if (reason === 'DUPLICATE_EXECUTION_KEY' || reason === 'DUPLICATE_LOGICAL_ACTION') return 'EXISTS';
  if (reason === 'ACTIVE_GATE_HELD') return 'BUSY';
  return 'UNKNOWN';
}

function makeClaimId(actionKey, executionKey, admissionRevision, storageVersion) {
  return createHash('sha256').update([
    actionKey,
    executionKey,
    String(admissionRevision),
    String(storageVersion),
    randomBytes(8).toString('hex')
  ].join('|')).digest('hex').slice(0, 40);
}

function validClaim(claim) {
  return claim && validKey(claim.actionKey) && validKey(claim.executionKey)
    && typeof claim.claimId === 'string' && claim.claimId.length > 0
    && validOwner(claim.owner)
    && Number.isSafeInteger(claim.admissionRevision) && claim.admissionRevision > 0
    && Number.isSafeInteger(claim.expectedRevision) && claim.expectedRevision >= 0
    && typeof claim.expectedOid === 'string' && claim.expectedOid.length > 0
    && typeof claim.status === 'string' && typeof claim.lastStage === 'string'
    && Number.isSafeInteger(claim.storageVersion) && claim.storageVersion >= 1;
}

function normalizeEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_CANONICAL_ENVELOPE');
  const keys = ['storageVersion', 'snapshot', 'admissionState', 'claims', 'transitionChain'];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (!Number.isSafeInteger(input.storageVersion) || input.storageVersion < 0) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (!validSnapshot(input.snapshot)) throw new Error('INVALID_CANONICAL_ENVELOPE');
  if (!Array.isArray(input.claims) || !Array.isArray(input.transitionChain)
    || input.transitionChain.length > MAX_TRANSITION_CHAIN) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  const admissionState = clone(input.admissionState);
  const admissionProbe = reduceAdmissionRecord(admissionState, {
    kind: 'SIMULATE_ADMISSION',
    expectedRevision: admissionState.revision,
    expectedTotalQuota: admissionState.totalQuota,
    logicalActionId: 'a'.repeat(64),
    executionKey: 'b'.repeat(64)
  });
  if (!admissionProbe || typeof admissionProbe.status !== 'string') {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }

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
  const activeClaims = claims.filter(claim => ['CLAIMED', 'REVIEW_PENDING', 'REVIEWED', 'RECEIPT_POSTING', 'UNKNOWN']
    .includes(claim.status));
  if (activeClaims.length > 1) throw new Error('INVALID_CANONICAL_ENVELOPE');
  const unknownClaims = claims.filter(claim => claim.status === 'UNKNOWN');
  if (unknownClaims.length > 1) throw new Error('INVALID_CANONICAL_ENVELOPE');
  if (unknownClaims.length === 1 && admissionState.reconciliation?.status !== 'UNKNOWN') {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (unknownClaims.length === 0 && admissionState.reconciliation?.status === 'UNKNOWN') {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (activeClaims.length === 0 && admissionState.activeGate !== null) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }
  if (activeClaims.length === 1) {
    const active = activeClaims[0];
    if (!admissionState.activeGate
      || admissionState.activeGate.logicalActionId !== active.actionKey
      || admissionState.activeGate.executionKey !== active.executionKey
      || admissionState.activeGate.admissionRevision !== active.admissionRevision) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
  }

  const transitionChain = input.transitionChain.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Number.isSafeInteger(entry.storageVersion) || entry.storageVersion < 1
      || typeof entry.kind !== 'string' || entry.kind.length === 0
      || !Number.isSafeInteger(entry.publicRevision) || entry.publicRevision < 0
      || typeof entry.publicOid !== 'string' || entry.publicOid.length === 0
      || typeof entry.executionKey !== 'string' || entry.executionKey.length === 0
      || typeof entry.claimId !== 'string' || entry.claimId.length === 0) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
    return clone(entry);
  });
  for (let index = 1; index < transitionChain.length; index += 1) {
    if (transitionChain[index].storageVersion <= transitionChain[index - 1].storageVersion) {
      throw new Error('INVALID_CANONICAL_ENVELOPE');
    }
  }
  if (transitionChain.length > 0 && transitionChain[transitionChain.length - 1].storageVersion !== input.storageVersion) {
    throw new Error('INVALID_CANONICAL_ENVELOPE');
  }

  return Object.freeze({
    storageVersion: input.storageVersion,
    snapshot: clone(input.snapshot),
    admissionState,
    claims,
    transitionChain
  });
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

function findClaim(envelope, executionKey) {
  return envelope.claims.find(entry => entry.executionKey === executionKey) || null;
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
  if (transition.kind === 'REVIEW_PENDING') return claim.lastStage === 'CLAIMED' && claim.status === 'CLAIMED';
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
    return claim.status === 'CLAIMED' || (claim.status === 'REVIEW_PENDING' && claim.lastStage === 'OBSERVE_PREPARING');
  }
  if (transition.kind === 'RECEIPT_PREPARING') {
    return claim.status === 'REVIEWED' && claim.lastStage === 'REVIEW_RESULT'
      && claim.lastStage !== 'RECEIPT_PREPARING';
  }
  if (transition.kind === 'RECEIPT_POSTING') {
    return claim.status === 'REVIEWED'
      && (claim.lastStage === 'REVIEW_RESULT' || claim.lastStage === 'RECEIPT_PREPARING');
  }
  if (transition.kind === 'RECEIPT_DELIVERED') {
    return claim.status === 'RECEIPT_POSTING' && claim.lastStage === 'RECEIPT_POSTING'
      && typeof transition.receiptId === 'string' && transition.receiptId.length > 0;
  }
  return false;
}

function applyUnknownAdmission(admissionState, claim, stage) {
  const mappedStage = UNKNOWN_STAGE_MAP[stage] || 'CHECKPOINT';
  const reduced = reduceAdmissionRecord(admissionState, {
    kind: 'MARK_UNKNOWN',
    logicalActionId: claim.actionKey,
    executionKey: claim.executionKey,
    stage: mappedStage
  });
  if (reduced.status !== 'UNKNOWN' || reduced.changed !== true) return null;
  return reduced.state;
}

function applyTransitionMutation({envelope, claim, transition}) {
  const nextEnvelope = clone(envelope);
  const nextClaim = clone(claim);
  let nextAdmissionState = nextEnvelope.admissionState;

  if (transition.kind === 'REVIEW_PENDING') {
    nextClaim.status = 'REVIEW_PENDING';
    nextClaim.lastStage = 'REVIEW_PENDING';
    if (typeof transition.reviewRequestId === 'string' && transition.reviewRequestId.length > 0) {
      nextClaim.reviewRequestId = transition.reviewRequestId;
    }
    if (typeof transition.sessionId === 'string' && transition.sessionId.length > 0) {
      nextClaim.sessionId = transition.sessionId;
    }
    if (transition.reviewer && typeof transition.reviewer === 'object' && !Array.isArray(transition.reviewer)) {
      nextClaim.reviewer = clone(transition.reviewer);
    }
    for (const key of ['repository', 'pullRequest', 'headSha', 'baseSha', 'diffDigest',
      'changedPathDigest', 'changedPathCount', 'runId', 'runAttempt', 'workflowId',
      'selectionRevision', 'reviewDeadlineAt']) {
      if (Object.hasOwn(transition, key)) nextClaim[key] = clone(transition[key]);
    }
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
    const observed = reduceAdmissionRecord(nextAdmissionState, {
      kind: 'EFFECT_OBSERVED',
      logicalActionId: nextClaim.actionKey,
      executionKey: nextClaim.executionKey,
      admissionRevision: nextClaim.admissionRevision
    });
    if (observed.status !== 'RECORDED' || observed.changed !== true) return null;
    nextAdmissionState = observed.state;
    nextClaim.status = 'REVIEWED';
    nextClaim.lastStage = 'REVIEW_RESULT';
    if (typeof transition.completionState === 'string') nextClaim.completionState = transition.completionState;
    if (typeof transition.verdict === 'string') nextClaim.verdict = transition.verdict;
    if (typeof transition.reason === 'string') nextClaim.reason = transition.reason;
    if (typeof transition.evidenceId === 'string') nextClaim.evidenceId = transition.evidenceId;
  } else if (transition.kind === 'RECEIPT_PREPARING') {
    if (Object.hasOwn(transition, 'completionState')
      && transition.completionState !== nextClaim.completionState) return null;
    if (Object.hasOwn(transition, 'verdict')
      && transition.verdict !== nextClaim.verdict) return null;
    nextClaim.lastStage = 'RECEIPT_PREPARING';
  } else if (transition.kind === 'RECEIPT_POSTING') {
    nextClaim.status = 'RECEIPT_POSTING';
    nextClaim.lastStage = 'RECEIPT_POSTING';
  } else if (transition.kind === 'RECEIPT_DELIVERED') {
    const completed = reduceAdmissionRecord(nextAdmissionState, {
      kind: 'TERMINAL_COMPLETION',
      evidence: {
        logicalActionId: nextClaim.actionKey,
        executionKey: nextClaim.executionKey,
        admissionRevision: nextClaim.admissionRevision,
        effect: 'COMPLETED',
        checkpointAcknowledged: true
      }
    });
    if (completed.status !== 'RECORDED' || completed.changed !== true) return null;
    nextAdmissionState = completed.state;
    nextClaim.status = 'COMMITTED';
    nextClaim.lastStage = 'RECEIPT_DELIVERED';
    nextClaim.receiptId = transition.receiptId;
    if (typeof transition.completionState === 'string') nextClaim.completionState = transition.completionState;
    if (typeof transition.verdict === 'string') nextClaim.verdict = transition.verdict;
  } else if (transition.kind === 'UNKNOWN') {
    const unknownState = applyUnknownAdmission(nextAdmissionState, nextClaim, transition.stage);
    if (!unknownState) return null;
    nextAdmissionState = unknownState;
    nextClaim.status = 'UNKNOWN';
    nextClaim.lastStage = transition.stage;
  } else {
    return null;
  }

  nextEnvelope.admissionState = nextAdmissionState;
  const claimIndex = nextEnvelope.claims.findIndex(entry => entry.executionKey === nextClaim.executionKey);
  if (claimIndex < 0) return null;
  nextEnvelope.claims[claimIndex] = nextClaim;
  return {nextEnvelope, nextClaim};
}

function appendTransitionChain(envelope, {kind, claim}) {
  const chain = envelope.transitionChain;
  const entry = Object.freeze({
    storageVersion: envelope.storageVersion,
    kind,
    executionKey: claim.executionKey,
    claimId: claim.claimId,
    publicRevision: envelope.snapshot.revision,
    publicOid: envelope.snapshot.oid
  });
  chain.push(entry);
  if (chain.length > MAX_TRANSITION_CHAIN) chain.shift();
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
      for (let attempts = 0; attempts < 5; attempts += 1) {
        const envelope = await readEnvelope();
        if (envelope.snapshot.revision !== input.expectedRevision || envelope.snapshot.oid !== input.expectedOid) {
          return Object.freeze({status: 'STALE_EXPECTATION'});
        }
        if (findClaim(envelope, input.executionKey)) return Object.freeze({status: 'EXISTS'});

        const admission = reduceAdmissionRecord(envelope.admissionState, {
          kind: 'SIMULATE_ADMISSION',
          expectedRevision: envelope.admissionState.revision,
          expectedTotalQuota: envelope.admissionState.totalQuota,
          logicalActionId: input.actionKey,
          executionKey: input.executionKey
        });
        if (admission.status === 'BLOCKED') {
          return Object.freeze({status: mapAdmissionBlockToClaimStatus(admission.reason)});
        }
        if (admission.status !== 'ADMITTED' || admission.changed !== true) {
          return Object.freeze({status: 'UNKNOWN'});
        }

        const nextEnvelope = clone(envelope);
        nextEnvelope.storageVersion += 1;
        nextEnvelope.admissionState = admission.state;
        const claim = {
          claimId: makeClaimId(input.actionKey, input.executionKey,
            nextEnvelope.admissionState.activeGate.admissionRevision, nextEnvelope.storageVersion),
          actionKey: input.actionKey,
          executionKey: input.executionKey,
          owner: input.owner,
          createdAt: Number.isSafeInteger(input.createdAt) ? input.createdAt : now(),
          admissionRevision: nextEnvelope.admissionState.activeGate.admissionRevision,
          expectedRevision: nextEnvelope.snapshot.revision,
          expectedOid: nextEnvelope.snapshot.oid,
          storageVersion: nextEnvelope.storageVersion,
          status: 'CLAIMED',
          lastStage: 'CLAIMED'
        };
        nextEnvelope.claims.push(claim);
        appendTransitionChain(nextEnvelope, {kind: 'CLAIM_CREATED', claim});

        const replace = await replaceEnvelope(envelope.storageVersion, nextEnvelope);
        if (replace?.status === 'REPLACED') {
          return Object.freeze({status: 'CREATED', claimId: claim.claimId});
        }
      }
      return Object.freeze({status: 'UNKNOWN'});
    },

    async createImmutableCommit(input) {
      if (!input || !validKey(input.actionKey) || !validKey(input.executionKey)
        || typeof input.claimId !== 'string' || input.claimId.length === 0
        || typeof input.parentOid !== 'string' || input.parentOid.length === 0
        || !Number.isSafeInteger(input.revision) || input.revision < 1
        || typeof input.commitNonce !== 'string' || !/^[a-f0-9]{32}$/.test(input.commitNonce)
        || !input.transition || typeof input.transition !== 'object' || Array.isArray(input.transition)) {
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

      for (let attempts = 0; attempts < 5; attempts += 1) {
        const envelope = await readEnvelope();
        if (envelope.snapshot.oid !== input.expectedOid || envelope.snapshot.revision !== input.expectedRevision) {
          return Object.freeze({status: 'CONFLICT'});
        }
        const claim = findClaim(envelope, input.executionKey);
        if (!claim || claim.claimId !== input.claimId || claim.actionKey !== input.actionKey) {
          return Object.freeze({status: 'CONFLICT'});
        }
        if (claim.storageVersion !== envelope.storageVersion) {
          return Object.freeze({status: 'CONFLICT'});
        }
        if (claim.expectedOid !== input.expectedOid || claim.expectedRevision !== input.expectedRevision) {
          return Object.freeze({status: 'CONFLICT'});
        }
        if (!canApplyTransition(claim, commit.transition)) {
          return Object.freeze({status: 'CONFLICT'});
        }

        const mutation = applyTransitionMutation({envelope, claim, transition: commit.transition});
        if (!mutation) return Object.freeze({status: 'CONFLICT'});
        const nextEnvelope = mutation.nextEnvelope;
        const nextClaim = mutation.nextClaim;
        nextEnvelope.storageVersion += 1;
        nextEnvelope.snapshot = {
          revision: input.newRevision,
          oid: input.newOid,
          chainValid: true
        };
        nextClaim.expectedRevision = input.newRevision;
        nextClaim.expectedOid = input.newOid;
        nextClaim.storageVersion = nextEnvelope.storageVersion;
        appendTransitionChain(nextEnvelope, {kind: commit.transition.kind, claim: nextClaim});

        const replaced = await replaceEnvelope(envelope.storageVersion, nextEnvelope);
        if (replaced?.status === 'REPLACED') {
          transitionCounts.set(commit.transition.kind, (transitionCounts.get(commit.transition.kind) || 0) + 1);
          return Object.freeze({status: 'COMMITTED', oid: input.newOid});
        }
      }
      return Object.freeze({status: 'CONFLICT'});
    },

    async readClaim(executionKey) {
      if (!validKey(executionKey)) return null;
      const envelope = await readEnvelope();
      const claim = findClaim(envelope, executionKey);
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
