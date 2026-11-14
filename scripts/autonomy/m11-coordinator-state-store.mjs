import {randomBytes} from 'node:crypto';

const REQUIRED_CAPABILITIES = Object.freeze([
  'immutableCommits',
  'validatedRevisionChain',
  'atomicCreateOnlyClaims',
  'atomicSingleWriterClaim',
  'atomicPacketQuota',
  'atomicExpectedOidCAS'
]);
const MAX_TRANSITION_BYTES = 16384;

function encodedSize(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : Infinity;
  } catch {
    return Infinity;
  }
}

function validKey(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validOwner(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,100}$/.test(value);
}

function unavailable(reason) {
  return Object.freeze({status: 'BLOCKED', reason});
}

function signalAborted(signal) {
  return signal?.aborted === true;
}

function supportsRequiredSemantics(backend) {
  return backend && backend.capabilities
    && REQUIRED_CAPABILITIES.every(capability => backend.capabilities[capability] === true)
    && ['readSnapshot', 'createOnlyClaim', 'createImmutableCommit',
      'compareAndSwapRef', 'readClaim'].every(method => typeof backend[method] === 'function');
}

export function createCoordinatorStateStore({backend = null, enabled = false} = {}) {
  const available = enabled === true && supportsRequiredSemantics(backend);
  const disabledReason = enabled !== true ? 'DISABLED'
    : supportsRequiredSemantics(backend) ? null : 'ATOMIC_BACKEND_CAPABILITIES_UNPROVEN';

  async function read({signal} = {}) {
    if (!available) return unavailable(disabledReason);
    if (signalAborted(signal)) return unavailable('STATE_READ_ABORTED');
    try {
      const snapshot = signal
        ? await backend.readSnapshot({signal})
        : await backend.readSnapshot();
      if (signalAborted(signal)) return unavailable('STATE_READ_ABORTED');
      if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
        || typeof snapshot.oid !== 'string' || snapshot.oid.length < 1
        || snapshot.chainValid !== true) return unavailable('STATE_CHAIN_INVALID');
      return Object.freeze({status: 'READY', snapshot});
    } catch {
      if (signalAborted(signal)) return unavailable('STATE_READ_ABORTED');
      return unavailable('STATE_READ_FAILED');
    }
  }

  async function claim({actionKey, executionKey, packetKey, maxPackets = 3,
    expectedRevision, expectedOid, owner, now, signal}) {
    if (!available) return unavailable(disabledReason);
    if (signalAborted(signal)) return Object.freeze({status: 'CLAIM_UNKNOWN'});
    if (!validKey(actionKey) || !validKey(executionKey) || !validKey(packetKey) || maxPackets !== 3
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || typeof expectedOid !== 'string' || expectedOid.length < 1
      || !validOwner(owner) || !Number.isSafeInteger(now)) return unavailable('INVALID_CLAIM');
    try {
      const claimResult = await backend.createOnlyClaim({
        actionKey,
        executionKey,
        packetKey,
        maxPackets,
        maxActiveClaims: 1,
        owner,
        expectedRevision,
        expectedOid,
        createdAt: now,
        ...(signal ? {signal} : {})
      });
      if (signalAborted(signal)) return Object.freeze({status: 'CLAIM_UNKNOWN'});
      if (!claimResult || claimResult.status !== 'CREATED'
        || typeof claimResult.claimId !== 'string' || claimResult.claimId.length === 0) {
        if (claimResult?.status === 'BUDGET_EXHAUSTED') return Object.freeze({status: 'BUDGET_EXHAUSTED'});
        return Object.freeze({status: claimResult?.status === 'EXISTS' ? 'ALREADY_CLAIMED' : 'CLAIM_UNKNOWN'});
      }
      return Object.freeze({
        status: 'CLAIMED',
        claim: Object.freeze({
          actionKey,
          executionKey,
          claimId: claimResult.claimId,
          owner,
          expectedRevision,
          expectedOid
        })
      });
    } catch {
      return Object.freeze({status: 'CLAIM_UNKNOWN'});
    }
  }

  async function commit({claim, transition, signal}) {
    if (!available) return unavailable(disabledReason);
    if (signalAborted(signal)) return Object.freeze({status: 'UNKNOWN_RECONCILE'});
    if (!claim || !validKey(claim.actionKey) || !validKey(claim.executionKey)
      || typeof claim.claimId !== 'string' || claim.claimId.length === 0 || !validOwner(claim.owner)
      || !Number.isSafeInteger(claim.expectedRevision) || claim.expectedRevision < 0
      || typeof claim.expectedOid !== 'string' || claim.expectedOid.length === 0
      || transition === null || typeof transition !== 'object' || Array.isArray(transition)
      || encodedSize(transition) > MAX_TRANSITION_BYTES) return unavailable('INVALID_TRANSITION');
    try {
      const commit = await backend.createImmutableCommit({
        parentOid: claim.expectedOid,
        revision: claim.expectedRevision + 1,
        actionKey: claim.actionKey,
        executionKey: claim.executionKey,
        claimId: claim.claimId,
        commitNonce: randomBytes(16).toString('hex'),
        transition,
        ...(signal ? {signal} : {})
      });
      if (signalAborted(signal)) return Object.freeze({status: 'UNKNOWN_RECONCILE'});
      if (!commit || typeof commit.oid !== 'string' || commit.parentOid !== claim.expectedOid
        || commit.revision !== claim.expectedRevision + 1
        || typeof commit.commitNonce !== 'string' || !/^[a-f0-9]{32}$/.test(commit.commitNonce)) {
        return unavailable('IMMUTABLE_COMMIT_INVALID');
      }
      const result = await backend.compareAndSwapRef({
        expectedOid: claim.expectedOid,
        expectedRevision: claim.expectedRevision,
        newOid: commit.oid,
        newRevision: claim.expectedRevision + 1,
        actionKey: claim.actionKey,
        executionKey: claim.executionKey,
        claimId: claim.claimId,
        ...(signal ? {signal} : {})
      });
      if (signalAborted(signal)) return Object.freeze({status: 'UNKNOWN_RECONCILE'});
      return result?.status === 'COMMITTED' && result.oid === commit.oid
        ? Object.freeze({
          status: 'COMMITTED',
          oid: commit.oid,
          revision: claim.expectedRevision + 1,
          claim: Object.freeze({...claim, expectedOid: commit.oid, expectedRevision: claim.expectedRevision + 1})
        })
        : Object.freeze({status: 'CONFLICT_RECONCILE'});
    } catch {
      return Object.freeze({status: 'UNKNOWN_RECONCILE'});
    }
  }

  async function reconcile(executionKey, {signal} = {}) {
    if (!available) return unavailable(disabledReason);
    if (!validKey(executionKey)) return unavailable('INVALID_EXECUTION_KEY');
    if (signalAborted(signal)) return Object.freeze({status: 'UNKNOWN', claim: null});
    try {
      const durableClaim = signal
        ? await backend.readClaim(executionKey, {signal})
        : await backend.readClaim(executionKey);
      if (signalAborted(signal)) return Object.freeze({status: 'UNKNOWN', claim: durableClaim || null});
      if (!durableClaim || durableClaim.executionKey !== executionKey
        || !validKey(durableClaim.actionKey) || typeof durableClaim.claimId !== 'string'
        || durableClaim.claimId.length === 0 || typeof durableClaim.status !== 'string'
        || typeof durableClaim.lastStage !== 'string') {
        return Object.freeze({status: 'UNKNOWN', claim: durableClaim || null});
      }
      return Object.freeze({status: 'READY', claim: durableClaim});
    } catch {
      return Object.freeze({status: 'UNKNOWN', claim: null});
    }
  }

  return Object.freeze({
    available,
    disabledReason,
    read,
    claim,
    commit,
    reconcile
  });
}
