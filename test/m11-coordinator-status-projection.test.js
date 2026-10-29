import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {normalizeM11AgentStatus} from '../scripts/autonomy/m11-agent-status.mjs';
import {
  projectCoordinatorStatus,
  COORDINATOR_STATUS_PROJECTION_LIMITS as LIMITS
} from '../scripts/autonomy/m11-coordinator-status-projection.mjs';

const NOW = 1700000000000;
const iso = ms => new Date(ms).toISOString();
const key = n => n.toString(16).padStart(64, '0');

function fixture(totalQuota = 3) {
  const transport = createAtomicRecordMemoryTransport({initialEnvelope: createAtomicRecordEnvelope({totalQuota})});
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => NOW - 100000});
  const store = createCoordinatorStateStore({backend, enabled: true});
  return {backend, store};
}

async function claimNext(f, n = 1) {
  const {snapshot} = await f.store.read();
  const result = await f.store.claim({
    actionKey: key(n * 2), executionKey: key(n * 2 + 1), packetKey: key(999),
    expectedRevision: snapshot.revision, expectedOid: snapshot.oid, owner: 'test-owner', now: NOW - 100000
  });
  assert.equal(result.status, 'CLAIMED');
  return result.claim;
}

function path(completionState = 'COMPLETE', verdict = 'GREEN_LIGHT') {
  return [
    {
      kind: 'REVIEW_PENDING',
      actionKey: key(2), executionKey: key(3),
      reviewRequestId: 'r', sessionId: 's',
      reviewer: {provider: 'claude', agent: 'reviewer', model: 'model', transport: 'trusted-runtime'},
      repository: 'Achi1984/meridian', pullRequest: 1033,
      headSha: 'a', baseSha: 'b', diffDigest: 'd', changedPathDigest: 'p', changedPathCount: 1,
      runId: 1, runAttempt: 1, workflowId: 1, selectionRevision: 1, reviewDeadlineAt: NOW + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'r', sessionId: 's'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'REVIEW_RESULT', completionState, verdict, reviewRequestId: 'r', sessionId: 's', evidenceId: 'e'},
    {kind: 'RECEIPT_PREPARING', completionState, verdict},
    {kind: 'RECEIPT_POSTING'},
    {kind: 'RECEIPT_DELIVERED', receiptId: 'receipt', completionState, verdict}
  ];
}

async function commit(f, claim, transition) {
  const result = await f.store.commit({claim, transition});
  assert.equal(result.status, 'COMMITTED', transition.kind);
  return result.claim;
}

function context(envelope) {
  return {
    schemaVersion: 1,
    operations: envelope.claims.map(claim => ({
      executionKey: claim.executionKey,
      taskUrl: 'https://github.com/Achi1984/meridian/issues/1033',
      observedAt: iso(NOW - 1000), expiresAt: iso(NOW + 1000)
    }))
  };
}

function project(envelope, presentation = context(envelope), now = NOW) {
  return projectCoordinatorStatus(JSON.stringify(envelope), JSON.stringify(presentation), now);
}

function unavailable(result, diagnostic) {
  assert.deepEqual(result, {status: 'UNAVAILABLE', diagnostic});
  assert.equal(Object.hasOwn(result, 'serializedDTO'), false);
  assert.equal(Object.hasOwn(result, 'rows'), false);
  assert.equal(Object.hasOwn(result, 'metadata'), false);
}

function checkDTO(result, expectedStates) {
  assert.equal(result.status, 'READY');
  assert.equal(result.metadata.replaceAttempts, 0);
  assert.equal(result.metadata.hostedAtomicityProven, false);
  const dto = JSON.parse(result.serializedDTO);
  assert.deepEqual(normalizeM11AgentStatus(dto, {now: () => NOW}), dto);
  assert.deepEqual(dto.rows.map(row => row.taskState), expectedStates);
  assert.equal(dto.freshness, 'UNKNOWN');
  for (const row of dto.rows) {
    assert.match(row.agentId, /^[a-f0-9]{64}$/);
    assert.equal(row.taskId, row.agentId);
    assert.equal(row.agentName, 'stored coordinator operations');
    for (const field of ['providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
      'coordinatorMode', 'freshness']) assert.equal(row[field], 'UNKNOWN', field);
    for (const field of ['providerEvidence', 'modelEvidence', 'coordinatorEvidence', 'evidenceUrl',
      'blocker', 'ownerDecisionReason']) assert.equal(row[field], null, field);
    assert.equal(row.evidenceType, 'unknown');
    assert.equal(row.ownerDecisionRequired, false);
    assert.match(row.nextAction, /no dispatch, retry, or owner decision inferred/);
    assert.equal(Object.hasOwn(row, 'storageVersion'), false);
  }
  return dto;
}

test('every successful source stage remains stored-only, including reviewer session and green verdict', async () => {
  const f = fixture();
  let claim = await claimNext(f);
  let envelope = await f.backend.exportCanonicalEnvelope();
  checkDTO(await project(envelope), ['UNKNOWN']);
  const stages = path();
  stages.splice(3, 0, {kind: 'OBSERVE_PENDING'}, {kind: 'OBSERVE_PREPARING'});
  for (const transition of stages) {
    claim = await commit(f, claim, transition);
    envelope = await f.backend.exportCanonicalEnvelope();
    const done = transition.kind === 'RECEIPT_DELIVERED';
    const dto = checkDTO(await project(envelope), [done ? 'DONE' : 'UNKNOWN']);
    assert.equal(dto.rows[0].agentId, claim.executionKey);
    assert.equal(dto.rows[0].observedAt, iso(NOW - 1000));
    if (done) assert.equal(dto.rows[0].taskLabel, 'Stored receipt cycle completed; not runtime completion');
    else assert.equal(dto.rows[0].taskLabel, 'Stored operation state; current runtime unknown');
    assert.equal(resultContainsRuntimeIdentity(dto), false);
  }
});

function resultContainsRuntimeIdentity(dto) {
  return /trusted-runtime|reviewer|GREEN_LIGHT|sessionId/.test(JSON.stringify(dto));
}

test('stored revision-required review is BLOCKED only while REVIEWED, receipt completion means stored cycle only', async () => {
  const f = fixture();
  let claim = await claimNext(f);
  for (const transition of path('REVISION_REQUIRED', 'REVISION_REQUIRED')) {
    claim = await commit(f, claim, transition);
    const envelope = await f.backend.exportCanonicalEnvelope();
    const state = envelope.claims[0].status;
    const expected = state === 'REVIEWED' ? 'BLOCKED' : state === 'COMMITTED' ? 'DONE' : 'UNKNOWN';
    const dto = checkDTO(await project(envelope), [expected]);
    if (expected === 'BLOCKED') {
      assert.equal(dto.rows[0].taskLabel, 'Stored review requires revision; not a current runtime assessment');
    }
  }
});

test('incomplete and UNKNOWN source records never imply review or running agents', async () => {
  for (const stage of ['STALE_BEFORE_DISPATCH', 'DISPATCH_ACK_UNKNOWN', 'OBSERVE_UNKNOWN', 'RECEIPT_DELIVERY_UNKNOWN']) {
    const f = fixture();
    let claim = await claimNext(f);
    claim = await commit(f, claim, {kind: 'UNKNOWN', stage, reason: 'sensitive untrusted source reason'});
    const envelope = await f.backend.exportCanonicalEnvelope();
    const result = await project(envelope);
    checkDTO(result, ['UNKNOWN']);
    assert.equal(result.serializedDTO.includes('sensitive'), false);
  }
  const f = fixture();
  let claim = await claimNext(f);
  for (const transition of path('INCOMPLETE', 'NEEDS_MORE_EVIDENCE').slice(0, 4)) {
    claim = await commit(f, claim, transition);
  }
  checkDTO(await project(await f.backend.exportCanonicalEnvelope()), ['UNKNOWN']);
  await commit(f, claim, {kind: 'UNKNOWN', stage: 'STALE_BEFORE_RECEIPT'});
  const result = await project(await f.backend.exportCanonicalEnvelope());
  checkDTO(result, ['UNKNOWN']);
  assert.equal(resultContainsRuntimeIdentity(JSON.parse(result.serializedDTO)), false);
});

test('EMPTY contains no DTO or stale rows and still validates explicit context and clock', async () => {
  const envelope = await fixture().backend.exportCanonicalEnvelope();
  const result = await project(envelope);
  assert.deepEqual(result, {
    status: 'EMPTY',
    metadata: {
      storageVersion: 0, publicRevision: 0, publicOid: 'root', claimCount: 0,
      transitionCount: 0, hostedAtomicityProven: false, replaceAttempts: 0
    }
  });
  unavailable(await project(envelope, {schemaVersion: 2, operations: []}), 'INVALID_CONTEXT');
  unavailable(await projectCoordinatorStatus(JSON.stringify(envelope), '{}'), 'INVALID_CLOCK');
});

test('actual backend replay rejects corrupt chain and claim/admission/snapshot mismatch without partial output', async () => {
  const f = fixture();
  const claim = await claimNext(f);
  await commit(f, claim, path()[0]);
  const envelope = await f.backend.exportCanonicalEnvelope();
  for (const mutate of [
    e => { e.transitionChain[1].parentDigest = 'f'.repeat(64); },
    e => { e.transitionChain[0].transition.owner = 'tampered'; },
    e => { e.claims[0].status = 'COMMITTED'; },
    e => { e.claims[0].reviewer.model = 'tampered'; },
    e => { e.admissionState.consumedQuota = 0; },
    e => { e.snapshot.oid = 'unmatched'; },
    e => { e.storageVersion += 1; },
    e => { e.claims.push(structuredClone(e.claims[0])); }
  ]) {
    const bad = structuredClone(envelope);
    mutate(bad);
    unavailable(await project(bad, context(envelope)), 'INVALID_SOURCE');
  }
});

test('context v1 rejects duplicate, unmatched, omitted or non-exact mappings', async () => {
  const f = fixture();
  await claimNext(f);
  const envelope = await f.backend.exportCanonicalEnvelope();
  for (const mutate of [
    c => { c.operations.push(structuredClone(c.operations[0])); },
    c => { c.operations[0].executionKey = key(888); },
    c => { c.operations = []; },
    c => { c.operations.push({...c.operations[0], executionKey: key(888)}); },
    c => { c.schemaVersion = 2; },
    c => { c.heartbeat = true; },
    c => { c.operations[0].providerVerified = 'claude'; },
    c => { delete c.operations[0].expiresAt; },
    c => { c.operations[0].executionKey = c.operations[0].executionKey.toUpperCase().replace(/0/, 'A'); }
  ]) {
    const bad = context(envelope);
    mutate(bad);
    unavailable(await project(envelope, bad), 'INVALID_CONTEXT');
  }
});

test('invalid public URLs, clocks, future snapshots and exact expiry fail closed', async () => {
  const f = fixture();
  await claimNext(f);
  const envelope = await f.backend.exportCanonicalEnvelope();
  for (const taskUrl of [
    'https://example.com/o/r/issues/1', 'http://github.com/o/r/issues/1',
    '******github.com/o/r/issues/1', 'https://github.com/o/r/issues/1?secret=raw',
    'https://github.com/o/r/issues/1#unsafe', 'javascript:alert(1)',
    'https://github.com/o/r', 'https://github.com:444/o/r/issues/1', ' https://github.com/o/r/issues/1'
  ]) {
    const bad = context(envelope);
    bad.operations[0].taskUrl = taskUrl;
    unavailable(await project(envelope, bad), 'INVALID_CONTEXT');
  }
  for (const now of [NaN, Infinity, -Infinity, null, '1700000000000', {}, () => NOW]) {
    unavailable(await project(envelope, context(envelope), now), 'INVALID_CLOCK');
  }
  for (const [observed, expires] of [
    [NOW + 1, NOW + 1000], [NOW - 1000, NOW], [NOW - 1000, NOW - 1],
    [NOW, NOW], [NOW, NOW - 1]
  ]) {
    const bad = context(envelope);
    bad.operations[0].observedAt = iso(observed);
    bad.operations[0].expiresAt = iso(expires);
    unavailable(await project(envelope, bad), 'INVALID_CONTEXT');
  }
  for (const field of ['observedAt', 'expiresAt']) {
    for (const value of ['not-a-date', '2023-02-30T00:00:00.000Z', NOW, null]) {
      const bad = context(envelope);
      bad.operations[0][field] = value;
      unavailable(await project(envelope, bad), 'INVALID_CONTEXT');
    }
  }
  const exactObserved = context(envelope);
  exactObserved.operations[0].observedAt = iso(NOW);
  checkDTO(await project(envelope, exactObserved), ['UNKNOWN']);
});

test('JSON byte, depth, field, array, string and numeric bounds have fixed diagnostics with no raw input', async () => {
  const envelope = await fixture().backend.exportCanonicalEnvelope();
  const goodEnvelope = JSON.stringify(envelope);
  const goodContext = JSON.stringify(context(envelope));
  const invalid = [
    undefined, null, {}, 'raw-secret', '{', 'null', '[]',
    ' '.repeat(LIMITS.envelopeBytes + 1),
    JSON.stringify('é'.repeat(LIMITS.envelopeBytes / 2)),
    '['.repeat(18) + '0' + ']'.repeat(18),
    JSON.stringify(Object.fromEntries(Array.from({length: 65}, (_, n) => [`k${n}`, n]))),
    JSON.stringify(Array(1025).fill(null)),
    JSON.stringify(Array.from({length: 50}, () => Array(1000).fill(0))),
    JSON.stringify('x'.repeat(LIMITS.stringLength + 1)),
    '{"value":1e999}',
    '{"__proto__":{"secret":"raw-secret"}}'
  ];
  for (const input of invalid) {
    unavailable(await projectCoordinatorStatus(input, goodContext, NOW), 'INVALID_SOURCE');
  }
  for (const input of [...invalid, ' '.repeat(LIMITS.contextBytes + 1)]) {
    unavailable(await projectCoordinatorStatus(goodEnvelope, input, NOW), 'INVALID_CONTEXT');
  }
});

test('projection is deterministic, leaves input unchanged, makes zero writes, and separates bounded revisions', async () => {
  const f = fixture();
  let claim = await claimNext(f);
  const created = await f.backend.exportCanonicalEnvelope();
  assert.equal(created.storageVersion, 1);
  assert.equal(created.snapshot.revision, 0);
  const initial = await project(created);
  assert.equal(initial.metadata.storageVersion, 1);
  assert.equal(initial.metadata.publicRevision, 0);
  claim = await commit(f, claim, path()[0]);
  const envelope = await f.backend.exportCanonicalEnvelope();
  const presentation = context(envelope);
  const before = JSON.stringify({envelope, presentation});
  const result = await project(envelope, presentation);
  assert.deepEqual(await project(envelope, presentation), result);
  assert.equal(JSON.stringify({envelope, presentation}), before);
  assert.deepEqual(await f.backend.exportCanonicalEnvelope(), envelope);
  checkDTO(result, ['UNKNOWN']);
  assert.equal(result.metadata.storageVersion, 2);
  assert.equal(result.metadata.publicRevision, 1);
  assert.equal(result.metadata.publicOid, envelope.snapshot.oid);
  assert.ok(result.metadata.publicOid.length <= 128);
  assert.equal(Object.hasOwn(JSON.parse(result.serializedDTO), 'metadata'), false);
  unavailable(await project(envelope, presentation, NOW + 1000), 'INVALID_CONTEXT');
  assert.deepEqual(await project(await fixture().backend.exportCanonicalEnvelope()), {
    status: 'EMPTY',
    metadata: {
      storageVersion: 0, publicRevision: 0, publicOid: 'root', claimCount: 0,
      transitionCount: 0, hostedAtomicityProven: false, replaceAttempts: 0
    }
  });
});

test('multiple complete histories preserve exact row identity and reject a single bad context without partial DTO', async () => {
  const f = fixture();
  for (const n of [2, 1]) {
    let claim = await claimNext(f, n);
    for (const transition of path()) {
      if (transition.kind === 'REVIEW_PENDING') {
        transition.actionKey = claim.actionKey;
        transition.executionKey = claim.executionKey;
      }
      claim = await commit(f, claim, transition);
    }
  }
  const envelope = await f.backend.exportCanonicalEnvelope();
  const presentation = context(envelope);
  const first = await project(envelope, presentation);
  const dto = checkDTO(first, ['DONE', 'DONE']);
  assert.deepEqual(dto.rows.map(row => row.agentId), [key(3), key(5)]);
  presentation.operations.reverse();
  envelope.claims.reverse();
  assert.deepEqual(await project(envelope, presentation), first);
  presentation.operations[1].expiresAt = iso(NOW);
  unavailable(await project(envelope, presentation), 'INVALID_CONTEXT');
});

test('more than 50 claims are rejected by count precheck, not presented as replay-valid history', async () => {
  const f = fixture();
  await claimNext(f);
  const envelope = await f.backend.exportCanonicalEnvelope();
  const oversized = structuredClone(envelope);
  oversized.claims = Array.from({length: 51}, (_, n) => ({
    ...envelope.claims[0], executionKey: key(n + 100)
  }));
  oversized.transitionChain = [];
  unavailable(await projectCoordinatorStatus(JSON.stringify(oversized), 'invalid-context', NOW), 'ROW_LIMIT_EXCEEDED');
  oversized.claims.length = 50;
  unavailable(await project(oversized, context(envelope)), 'INVALID_SOURCE');
  const oversizedContext = context(envelope);
  oversizedContext.operations = Array.from({length: 51}, (_, n) => ({
    ...oversizedContext.operations[0], executionKey: key(n + 100)
  }));
  unavailable(await project(envelope, oversizedContext), 'INVALID_CONTEXT');
  checkDTO(await project(envelope), ['UNKNOWN']);
});

test('synthetic DTO-only normalizer boundary accepts 50 rows and rejects 51; not a projection history fixture', async () => {
  const f = fixture();
  await claimNext(f);
  const projected = await project(await f.backend.exportCanonicalEnvelope());
  const [template] = checkDTO(projected, ['UNKNOWN']).rows;
  const syntheticRows = Array.from({length: 51}, (_, n) => ({
    ...template, agentId: key(n + 100), taskId: key(n + 100)
  }));
  const dto = normalizeM11AgentStatus({schemaVersion: 1, rows: syntheticRows.slice(0, 50)}, {now: () => NOW});
  assert.equal(dto.rows.length, 50);
  assert.deepEqual(normalizeM11AgentStatus(JSON.parse(JSON.stringify(dto)), {now: () => NOW}), dto);
  assert.equal(dto.freshness, 'UNKNOWN');
  assert.deepEqual(dto.rows.map(row => row.agentId), syntheticRows.slice(0, 50).map(row => row.agentId));
  assert.throws(
    () => normalizeM11AgentStatus({schemaVersion: 1, rows: syntheticRows}, {now: () => NOW}),
    /rows must be a non-empty array up to 50 items/
  );
});
