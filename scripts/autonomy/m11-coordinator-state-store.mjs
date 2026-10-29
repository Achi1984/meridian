const REQUIRED_CAPABILITIES = Object.freeze([
  'immutableCommits',
  'atomicCreateOnlyClaims',
  'atomicPacketQuota',
  'atomicExpectedOidCAS',
  'durableFencing'
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

function validActionKey(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validOwner(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{3,100}$/.test(value);
}

function unavailable(reason) {
  return Object.freeze({status: 'BLOCKED', reason});
}

function supportsRequiredSemantics(backend) {
  return backend && backend.capabilities
    && REQUIRED_CAPABILITIES.every(capability => backend.capabilities[capability] === true)
    && ['readSnapshot', 'acquireLease', 'createOnlyClaim', 'createImmutableCommit',
      'compareAndSwapRef', 'readClaim', 'releaseLease'].every(method => typeof backend[method] === 'function');
}

export function createCoordinatorStateStore({backend = null, enabled = false} = {}) {
  const available = enabled === true && supportsRequiredSemantics(backend);
  const disabledReason = enabled !== true ? 'DISABLED'
    : supportsRequiredSemantics(backend) ? null : 'ATOMIC_BACKEND_CAPABILITIES_UNPROVEN';

  async function read() {
    if (!available) return unavailable(disabledReason);
    try {
      const snapshot = await backend.readSnapshot();
      if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
        || !Number.isSafeInteger(snapshot.fencingToken) || snapshot.fencingToken < 0
        || typeof snapshot.oid !== 'string' || snapshot.oid.length < 1) return unavailable('INVALID_SNAPSHOT');
      return Object.freeze({status: 'READY', snapshot});
    } catch {
      return unavailable('STATE_READ_FAILED');
    }
  }

  async function claim({actionKey, packetKey, maxPackets = 3, expectedRevision, expectedOid, expectedFence,
    owner, leaseExpiresAt, now}) {
    if (!available) return unavailable(disabledReason);
    if (!validActionKey(actionKey) || !validActionKey(packetKey) || maxPackets !== 3
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || typeof expectedOid !== 'string' || expectedOid.length < 1
      || !Number.isSafeInteger(expectedFence) || expectedFence < 0 || !validOwner(owner)
      || !Number.isSafeInteger(now) || !Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt <= now) {
      return unavailable('INVALID_CLAIM');
    }
    try {
      const lease = await backend.acquireLease({
        expectedRevision, expectedOid, expectedFence, owner, leaseExpiresAt, now
      });
      if (!lease || lease.status !== 'ACQUIRED' || !Number.isSafeInteger(lease.fencingToken)
        || lease.fencingToken <= expectedFence) return unavailable(lease?.reason || 'LEASE_NOT_ACQUIRED');
      const claimResult = await backend.createOnlyClaim({
        actionKey,
        packetKey,
        maxPackets,
        owner,
        fencingToken: lease.fencingToken,
        expectedRevision,
        expectedOid,
        createdAt: now
      });
      if (!claimResult || claimResult.status !== 'CREATED') {
        if (claimResult?.status === 'BUDGET_EXHAUSTED') return Object.freeze({status: 'BUDGET_EXHAUSTED'});
        return Object.freeze({status: claimResult?.status === 'EXISTS' ? 'ALREADY_CLAIMED' : 'CLAIM_UNKNOWN'});
      }
      return Object.freeze({
        status: 'CLAIMED',
        lease: Object.freeze({
          actionKey, owner, fencingToken: lease.fencingToken, expectedRevision, expectedOid
        })
      });
    } catch {
      return Object.freeze({status: 'CLAIM_UNKNOWN'});
    }
  }

  async function commit({lease, transition}) {
    if (!available) return unavailable(disabledReason);
    if (!lease || !validActionKey(lease.actionKey) || !validOwner(lease.owner)
      || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1
      || !Number.isSafeInteger(lease.expectedRevision) || typeof lease.expectedOid !== 'string'
      || transition === null || typeof transition !== 'object' || Array.isArray(transition)
      || encodedSize(transition) > MAX_TRANSITION_BYTES) return unavailable('INVALID_TRANSITION');
    try {
      const commit = await backend.createImmutableCommit({
        parentOid: lease.expectedOid,
        revision: lease.expectedRevision + 1,
        actionKey: lease.actionKey,
        fencingToken: lease.fencingToken,
        transition
      });
      if (!commit || typeof commit.oid !== 'string' || commit.parentOid !== lease.expectedOid) {
        return unavailable('IMMUTABLE_COMMIT_INVALID');
      }
      const result = await backend.compareAndSwapRef({
        expectedOid: lease.expectedOid,
        expectedRevision: lease.expectedRevision,
        expectedFence: lease.fencingToken,
        newOid: commit.oid,
        newRevision: lease.expectedRevision + 1,
        actionKey: lease.actionKey
      });
      return result?.status === 'COMMITTED'
        ? Object.freeze({
          status: 'COMMITTED',
          oid: commit.oid,
          revision: lease.expectedRevision + 1,
          lease: Object.freeze({...lease, expectedOid: commit.oid, expectedRevision: lease.expectedRevision + 1})
        })
        : Object.freeze({status: 'CONFLICT_RECONCILE'});
    } catch {
      return Object.freeze({status: 'UNKNOWN_RECONCILE'});
    }
  }

  async function reconcile(actionKey) {
    if (!available) return unavailable(disabledReason);
    if (!validActionKey(actionKey)) return unavailable('INVALID_ACTION_KEY');
    try {
      const claimResult = await backend.readClaim(actionKey);
      return Object.freeze({
        status: claimResult?.status === 'COMMITTED' ? 'APPLIED'
          : claimResult?.status === 'NOT_COMMITTED' ? 'NOT_APPLIED'
            : 'UNKNOWN',
        claim: claimResult || null
      });
    } catch {
      return Object.freeze({status: 'UNKNOWN'});
    }
  }

  async function release(lease) {
    if (!available) return unavailable(disabledReason);
    if (!lease || !validActionKey(lease.actionKey) || !validOwner(lease.owner)
      || !Number.isSafeInteger(lease.fencingToken) || !Number.isSafeInteger(lease.expectedRevision)
      || typeof lease.expectedOid !== 'string') return unavailable('INVALID_LEASE');
    try {
      const result = await backend.releaseLease({
        actionKey: lease.actionKey,
        owner: lease.owner,
        fencingToken: lease.fencingToken,
        expectedRevision: lease.expectedRevision,
        expectedOid: lease.expectedOid
      });
      return result?.status === 'RELEASED'
        ? Object.freeze({status: 'RELEASED'})
        : Object.freeze({status: 'CONFLICT_RECONCILE'});
    } catch {
      return Object.freeze({status: 'UNKNOWN_RECONCILE'});
    }
  }

  return Object.freeze({
    available,
    disabledReason,
    read,
    claim,
    commit,
    reconcile,
    release
  });
}
