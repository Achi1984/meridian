import {createCoordinatorAtomicRecordBackend} from './m11-coordinator-atomic-record-backend.mjs';
import {normalizeM11AgentStatus, validatePublicM11Url} from './m11-agent-status.mjs';

export const COORDINATOR_STATUS_PROJECTION_LIMITS = Object.freeze({
  envelopeBytes: 1048576,
  contextBytes: 32768,
  depth: 16,
  nodes: 50000,
  objectFields: 64,
  arrayItems: 1024,
  stringLength: 2048,
  rows: 50
});

function boundedJson(text, maxBytes) {
  const limits = COORDINATOR_STATUS_PROJECTION_LIMITS;
  if (typeof text !== 'string' || text.length > maxBytes
    || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error();
  const value = JSON.parse(text);
  const pending = [[value, 0]];
  let nodes = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (++nodes > limits.nodes || depth > limits.depth) throw new Error();
    if (typeof item === 'string' && item.length > limits.stringLength) throw new Error();
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error();
    if (item === null || typeof item !== 'object') continue;
    const keys = Object.keys(item);
    if (keys.length > (Array.isArray(item) ? limits.arrayItems : limits.objectFields)) throw new Error();
    for (const key of keys) {
      if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error();
      pending.push([item[key], depth + 1]);
    }
  }
  return value;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new Error();
  return ms;
}

function presentationContext(value, nowMs) {
  if (!exactKeys(value, ['schemaVersion', 'operations']) || value.schemaVersion !== 1
    || !Array.isArray(value.operations) || value.operations.length > 50) throw new Error();
  const entries = new Map();
  for (const entry of value.operations) {
    if (!exactKeys(entry, ['executionKey', 'taskUrl', 'observedAt', 'expiresAt'])
      || typeof entry.executionKey !== 'string' || !/^[a-f0-9]{64}$/.test(entry.executionKey)
      || entries.has(entry.executionKey)
      || typeof entry.taskUrl !== 'string' || entry.taskUrl.length > 512
      || validatePublicM11Url(entry.taskUrl) !== entry.taskUrl) throw new Error();
    const observedMs = timestamp(entry.observedAt);
    const expiresMs = timestamp(entry.expiresAt);
    if (observedMs > nowMs || expiresMs <= nowMs || observedMs >= expiresMs) throw new Error();
    entries.set(entry.executionKey, entry);
  }
  return entries;
}

function storedState(claim) {
  if (claim.status === 'COMMITTED' && claim.lastStage === 'RECEIPT_DELIVERED') {
    return {taskState: 'DONE', taskLabel: 'Stored receipt cycle completed; not runtime completion'};
  }
  if (claim.status === 'REVIEWED' && claim.completionState === 'REVISION_REQUIRED') {
    return {taskState: 'BLOCKED', taskLabel: 'Stored review requires revision; not a current runtime assessment'};
  }
  return {taskState: 'UNKNOWN', taskLabel: 'Stored operation state; current runtime unknown'};
}

// Inputs are offline snapshots, not a transport, heartbeat, or runtime attestation.
export async function projectCoordinatorStatus(envelopeJson, contextJson, nowMs) {
  let diagnostic = 'INVALID_CLOCK';
  let replaceAttempts = 0;
  try {
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new Error();
    diagnostic = 'INVALID_SOURCE';
    const input = boundedJson(envelopeJson, COORDINATOR_STATUS_PROJECTION_LIMITS.envelopeBytes);
    const transport = Object.freeze({
      async readCanonicalEnvelope() { return structuredClone(input); },
      async replaceCanonicalEnvelope() {
        replaceAttempts += 1;
        throw new Error('READ_ONLY');
      }
    });
    const backend = createCoordinatorAtomicRecordBackend({transport, now: () => nowMs});
    const envelope = await backend.exportCanonicalEnvelope();
    if (replaceAttempts !== 0) throw new Error();
    diagnostic = 'ROW_LIMIT_EXCEEDED';
    if (envelope.claims.length > COORDINATOR_STATUS_PROJECTION_LIMITS.rows) throw new Error();
    diagnostic = 'INVALID_SOURCE';
    if (envelope.snapshot.oid.length > 128) throw new Error();
    diagnostic = 'INVALID_CONTEXT';
    const context = presentationContext(
      boundedJson(contextJson, COORDINATOR_STATUS_PROJECTION_LIMITS.contextBytes), nowMs);
    if (context.size !== envelope.claims.length
      || envelope.claims.some(claim => !context.has(claim.executionKey))) throw new Error();
    const metadata = Object.freeze({
      storageVersion: envelope.storageVersion,
      publicRevision: envelope.snapshot.revision,
      publicOid: envelope.snapshot.oid,
      claimCount: envelope.claims.length,
      transitionCount: envelope.transitionChain.length,
      hostedAtomicityProven: false,
      replaceAttempts
    });
    if (envelope.claims.length === 0) return Object.freeze({status: 'EMPTY', metadata});
    diagnostic = 'PROJECTION_FAILED';
    const rows = [...envelope.claims].sort((a, b) => a.executionKey.localeCompare(b.executionKey)).map(claim => {
      const entry = context.get(claim.executionKey);
      return {
        agentId: claim.executionKey,
        agentName: 'stored coordinator operations',
        taskId: claim.executionKey,
        ...storedState(claim),
        coordinatorMode: 'UNKNOWN',
        providerRequested: 'UNKNOWN',
        providerVerified: 'UNKNOWN',
        modelRequested: 'UNKNOWN',
        modelVerified: 'UNKNOWN',
        providerEvidence: null,
        modelEvidence: null,
        coordinatorEvidence: null,
        taskUrl: entry.taskUrl,
        observedAt: entry.observedAt,
        expiresAt: entry.expiresAt,
        evidenceUrl: null,
        evidenceType: 'unknown',
        blocker: null,
        nextAction: 'Offline snapshot only; no dispatch, retry, or owner decision inferred',
        ownerDecisionRequired: false,
        ownerDecisionReason: null
      };
    });
    const dto = normalizeM11AgentStatus({schemaVersion: 1, rows}, {now: () => nowMs});
    if (replaceAttempts !== 0) throw new Error();
    return Object.freeze({status: 'READY', serializedDTO: JSON.stringify(dto), metadata});
  } catch {
    return Object.freeze({
      status: 'UNAVAILABLE',
      diagnostic: replaceAttempts === 0 ? diagnostic : 'READ_ONLY_VIOLATION'
    });
  }
}
