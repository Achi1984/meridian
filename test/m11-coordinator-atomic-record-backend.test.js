import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';
import {startReviewLifecycle, observeReviewLifecycle} from '../scripts/autonomy/m11-review-lifecycle.mjs';
import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';

const START = 1700000000000;
const END = START + 86400000;
const REPOSITORY = 'Achi1984/meridian';
const PR = 973;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;
const REVIEWER = Object.freeze({provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'});

function makeBackend({
  totalQuota = 3,
  beforeReplace = null,
  afterReplace = null
} = {}) {
  const raw = createAtomicRecordMemoryTransport({
    initialEnvelope: createAtomicRecordEnvelope({totalQuota}),
    afterReplace
  });
  let replaceCalls = 0;
  const transport = {
    readCanonicalEnvelope: (...args) => raw.readCanonicalEnvelope(...args),
    replaceCanonicalEnvelope: async payload => {
      replaceCalls += 1;
      if (typeof beforeReplace === 'function') {
        await beforeReplace(payload);
      }
      return raw.replaceCanonicalEnvelope(payload);
    }
  };
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START + 10});
  return {
    backend,
    transport,
    getReplaceCalls: () => replaceCalls
  };
}

function makeNonValidatingBackend({initialEnvelope, beforeReplace = null, afterReplace = null} = {}) {
  let canonical = structuredClone(initialEnvelope ?? createAtomicRecordEnvelope({totalQuota: 3}));
  let replaceCalls = 0;
  const transport = {
    async readCanonicalEnvelope() {
      return structuredClone(canonical);
    },
    async replaceCanonicalEnvelope(payload) {
      replaceCalls += 1;
      if (typeof beforeReplace === 'function') await beforeReplace(payload);
      if (!Number.isSafeInteger(payload?.expectedStorageVersion)
        || payload.expectedStorageVersion !== canonical.storageVersion) {
        return {status: 'CONFLICT', storageVersion: canonical.storageVersion};
      }
      canonical = structuredClone(payload.nextEnvelope);
      if (typeof afterReplace === 'function') await afterReplace(structuredClone(canonical));
      return {status: 'REPLACED', storageVersion: canonical.storageVersion};
    }
  };
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START + 10});
  return {
    backend,
    getReplaceCalls: () => replaceCalls
  };
}

function rebuildStoreFromEnvelope(envelope, {beforeReplace = null, afterReplace = null} = {}) {
  const raw = createAtomicRecordMemoryTransport({initialEnvelope: structuredClone(envelope), afterReplace});
  const transport = {
    readCanonicalEnvelope: (...args) => raw.readCanonicalEnvelope(...args),
    replaceCanonicalEnvelope: async payload => {
      if (typeof beforeReplace === 'function') await beforeReplace(payload);
      return raw.replaceCanonicalEnvelope(payload);
    }
  };
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START + 10});
  const store = createCoordinatorStateStore({backend, enabled: true});
  return {backend, store};
}

async function claimViaStore(store, {actionKey, executionKey, owner = 'writer-one'} = {}) {
  const before = await store.read();
  assert.equal(before.status, 'READY');
  return store.claim({
    actionKey,
    executionKey,
    packetKey: 'f'.repeat(64),
    expectedRevision: before.snapshot.revision,
    expectedOid: before.snapshot.oid,
    owner,
    now: START + 10
  });
}

async function strictCompleteTransitionPath(store, claim) {
  let current = claim;
  for (const transition of [
    {
      kind: 'REVIEW_PENDING',
      actionKey: current.actionKey,
      executionKey: current.executionKey,
      reviewRequestId: 'req-1',
      sessionId: 'sess-1',
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'req-1', sessionId: 'sess-1'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT',
      reviewRequestId: 'req-1', sessionId: 'sess-1'},
    {kind: 'RECEIPT_PREPARING', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'},
    {kind: 'RECEIPT_POSTING'},
    {kind: 'RECEIPT_DELIVERED', receiptId: 'receipt-1', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  ]) {
    const result = await store.commit({claim: current, transition});
    assert.equal(result.status, 'COMMITTED', transition.kind);
    current = result.claim;
  }
  return current;
}

async function moveToObservePreparing(store, claim, {reviewRequestId = 'req-loop', sessionId = 'sess-loop'} = {}) {
  let current = claim;
  for (const transition of [
    {
      kind: 'REVIEW_PENDING',
      actionKey: current.actionKey,
      executionKey: current.executionKey,
      reviewRequestId,
      sessionId,
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId, sessionId},
    {kind: 'OBSERVE_PREPARING'}
  ]) {
    const result = await store.commit({claim: current, transition});
    assert.equal(result.status, 'COMMITTED', transition.kind);
    current = result.claim;
  }
  return current;
}

function fixtureApi({headSha = HEAD, baseSha = BASE} = {}) {
  const run = {
    id: RUN_ID,
    repository: REPOSITORY,
    workflowId: WORKFLOW_ID,
    workflowPath: '.github/workflows/backend-safety.yml',
    runAttempt: RUN_ATTEMPT,
    runNumber: 20,
    status: 'completed',
    conclusion: 'success',
    headSha,
    baseSha,
    pullRequests: [PR],
    actor: 'Achi1984',
    triggeringActor: 'Achi1984'
  };
  return {
    authenticated: true,
    authenticationEvidence: Object.freeze({
      evidenceId: 'fixture-auth-1',
      principal: 'synthetic-principal',
      host: 'api.github.com',
      scheme: 'https',
      tls: true,
      verifiedAtMs: START,
      expiresAtMs: START + 600000
    }),
    async getWorkflowRun() { return run; },
    async getPullRequest() {
      return {
        repository: REPOSITORY,
        number: PR,
        state: 'open',
        isFork: false,
        headRepository: REPOSITORY,
        baseRepository: REPOSITORY,
        headSha,
        baseSha
      };
    },
    async getPullRequestDiff() {
      return {
        headSha,
        baseSha,
        complete: true,
        truncated: false,
        text: 'diff --git a/scripts/autonomy/m11-review-lifecycle.mjs b/scripts/autonomy/m11-review-lifecycle.mjs\n+integration',
        changedPaths: ['scripts/autonomy/m11-review-lifecycle.mjs']
      };
    },
    async listWorkflowRuns() {
      return {items: [run], totalCount: 1, hasNextPage: false};
    },
    async listWorkflowJobs() {
      return {
        items: [{
          id: 81,
          name: 'syntax',
          runId: RUN_ID,
          runAttempt: RUN_ATTEMPT,
          workflowId: WORKFLOW_ID,
          status: 'completed',
          conclusion: 'success',
          steps: [{name: 'Research and auth regression tests', status: 'completed', conclusion: 'success'}]
        }],
        totalCount: 1,
        hasNextPage: false
      };
    }
  };
}

async function collectReady() {
  return collectExactPair({
    hint: {
      eventName: 'workflow_run',
      repository: REPOSITORY,
      workflowRunId: RUN_ID,
      workflowRunAttempt: RUN_ATTEMPT
    },
    config: {
      enabled: true,
      repository: REPOSITORY,
      pullRequests: [PR],
      actors: ['Achi1984'],
      startsAt: START,
      expiresAt: END,
      maxPages: 5,
      maxRuntimeMs: 1000
    },
    api: fixtureApi(),
    now: () => START + 100
  });
}

function buildCompletedObservation({start, collected, nowMs = START + 200, verdict = 'GREEN_LIGHT', completionState = 'COMPLETE'}) {
  const pair = completionState === 'COMPLETE'
    ? {completionState, verdict: 'GREEN_LIGHT'}
    : completionState === 'REVISION_REQUIRED'
      ? {completionState, verdict: 'REVISION_REQUIRED'}
      : {completionState: 'INCOMPLETE', verdict: 'NEEDS_MORE_EVIDENCE'};
  const finalVerdict = verdict || pair.verdict;
  return {
    status: 'COMPLETED',
    observedAtMs: nowMs,
    ci: {
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      selectionRevision: collected.selectionRevision
    },
    modelOutput: {
      reviewRequestId: start.reviewRequestId,
      sessionId: start.sessionId,
      reviewer: {...REVIEWER},
      coverageParts: [...REQUIRED_REVIEW_PARTS],
      verdict: finalVerdict,
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'complete'
    },
    trustedRuntimeEvidence: {
      evidenceId: 'runtime-1',
      provider: 'runtime',
      observedAtMs: nowMs - 10,
      expiresAtMs: nowMs + 60000,
      runtime: {
        reviewRequestId: start.reviewRequestId,
        sessionId: start.sessionId,
        reviewer: {...REVIEWER},
        repository: collected.repository,
        pullRequest: collected.pullRequest,
        headSha: collected.headSha,
        baseSha: collected.baseSha,
        diffDigest: collected.diffDigest,
        terminalState: 'completed',
        stopReason: 'end_turn',
        truncated: false,
        turnLimit: false,
        coverageParts: [...REQUIRED_REVIEW_PARTS],
        changedPaths: [...collected.changedPaths]
      }
    }
  };
}

test('private storageVersion mutates on claim and public pair mutates only on commit transition', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claim = await claimViaStore(store, {actionKey: '1'.repeat(64), executionKey: '2'.repeat(64)});
  assert.equal(claim.status, 'CLAIMED');

  const afterClaim = await backend.exportCanonicalEnvelope();
  assert.equal(afterClaim.storageVersion, 1);
  assert.equal(afterClaim.snapshot.revision, 0);
  assert.equal(afterClaim.snapshot.oid, 'root');

  const pending = await store.commit({
    claim: claim.claim,
    transition: {
      kind: 'REVIEW_PENDING',
      actionKey: claim.claim.actionKey,
      executionKey: claim.claim.executionKey,
      reviewRequestId: 'req',
      sessionId: 'sess',
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    }
  });
  assert.equal(pending.status, 'COMMITTED');
  const afterCommit = await backend.exportCanonicalEnvelope();
  assert.equal(afterCommit.storageVersion, 2);
  assert.equal(afterCommit.snapshot.revision, 1);
  assert.equal(afterCommit.snapshot.oid, pending.oid);
});

test('strict FSM fences reject shortcuts and verdict/completion mismatches', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claimed = await claimViaStore(store, {actionKey: '3'.repeat(64), executionKey: '4'.repeat(64)});
  assert.equal(claimed.status, 'CLAIMED');
  const baseline = await backend.exportCanonicalEnvelope();

  const kindOnlyPending = await store.commit({claim: claimed.claim, transition: {kind: 'REVIEW_PENDING'}});
  assert.equal(kindOnlyPending.status, 'CONFLICT_RECONCILE');
  const afterKindOnly = await backend.exportCanonicalEnvelope();
  assert.equal(afterKindOnly.storageVersion, baseline.storageVersion);
  assert.equal(afterKindOnly.snapshot.revision, baseline.snapshot.revision);
  assert.equal(afterKindOnly.snapshot.oid, baseline.snapshot.oid);
  assert.equal(afterKindOnly.admissionState.consumedQuota, baseline.admissionState.consumedQuota);
  assert.equal(afterKindOnly.admissionState.activeGate.executionKey, baseline.admissionState.activeGate.executionKey);

  const reviewShortcut = await store.commit({
    claim: claimed.claim,
    transition: {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT', reviewRequestId: 'r', sessionId: 's'}
  });
  assert.equal(reviewShortcut.status, 'CONFLICT_RECONCILE');

  let claim = claimed.claim;
  for (const transition of [
    {
      kind: 'REVIEW_PENDING',
      actionKey: claim.actionKey,
      executionKey: claim.executionKey,
      reviewRequestId: 'r1',
      sessionId: 's1',
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'r1', sessionId: 's1'},
    {kind: 'OBSERVE_PREPARING'}
  ]) {
    const next = await store.commit({claim, transition});
    assert.equal(next.status, 'COMMITTED');
    claim = next.claim;
  }

  const invalidPair = await store.commit({
    claim,
    transition: {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'REVISION_REQUIRED', reviewRequestId: 'r1', sessionId: 's1'}
  });
  assert.equal(invalidPair.status, 'CONFLICT_RECONCILE');

  const reviewed = await store.commit({
    claim,
    transition: {kind: 'REVIEW_RESULT', completionState: 'REVISION_REQUIRED', verdict: 'REVISION_REQUIRED', reviewRequestId: 'r1', sessionId: 's1'}
  });
  assert.equal(reviewed.status, 'COMMITTED');

  const postingShortcut = await store.commit({claim: reviewed.claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(postingShortcut.status, 'CONFLICT_RECONCILE');

  const prepared = await store.commit({
    claim: reviewed.claim,
    transition: {kind: 'RECEIPT_PREPARING', completionState: 'REVISION_REQUIRED', verdict: 'REVISION_REQUIRED'}
  });
  assert.equal(prepared.status, 'COMMITTED');

  const posted = await store.commit({claim: prepared.claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(posted.status, 'COMMITTED');

  const mismatchedDelivered = await store.commit({
    claim: posted.claim,
    transition: {kind: 'RECEIPT_DELIVERED', receiptId: 'x1', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  });
  assert.equal(mismatchedDelivered.status, 'CONFLICT_RECONCILE');

  const {backend: incompleteBackend} = makeBackend();
  const incompleteStore = createCoordinatorStateStore({backend: incompleteBackend, enabled: true});
  const incompleteClaimed = await claimViaStore(incompleteStore, {actionKey: 'c'.repeat(64), executionKey: 'd'.repeat(64)});
  let incompleteClaim = incompleteClaimed.claim;
  for (const transition of [
    {
      kind: 'REVIEW_PENDING',
      actionKey: incompleteClaim.actionKey,
      executionKey: incompleteClaim.executionKey,
      reviewRequestId: 'ri',
      sessionId: 'si',
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'ri', sessionId: 'si'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'REVIEW_RESULT', completionState: 'INCOMPLETE', verdict: 'NEEDS_MORE_EVIDENCE',
      reason: 'REVIEW_DEADLINE_EXPIRED'}
  ]) {
    const next = await incompleteStore.commit({claim: incompleteClaim, transition});
    assert.equal(next.status, 'COMMITTED');
    incompleteClaim = next.claim;
  }
  const beforeInvalidReceipt = await incompleteBackend.exportCanonicalEnvelope();
  const invalidReceipt = await incompleteStore.commit({
    claim: incompleteClaim,
    transition: {kind: 'RECEIPT_PREPARING', completionState: 'INCOMPLETE', verdict: 'NEEDS_MORE_EVIDENCE'}
  });
  assert.equal(invalidReceipt.status, 'CONFLICT_RECONCILE');
  const afterInvalidReceipt = await incompleteBackend.exportCanonicalEnvelope();
  assert.equal(afterInvalidReceipt.storageVersion, beforeInvalidReceipt.storageVersion);
  assert.equal(afterInvalidReceipt.snapshot.revision, beforeInvalidReceipt.snapshot.revision);
  assert.equal(afterInvalidReceipt.snapshot.oid, beforeInvalidReceipt.snapshot.oid);
  assert.equal(afterInvalidReceipt.admissionState.activeGate.executionKey,
    beforeInvalidReceipt.admissionState.activeGate.executionKey);
  assert.equal(afterInvalidReceipt.admissionState.consumedQuota, beforeInvalidReceipt.admissionState.consumedQuota);
});

test('duplicate logical action is rejected after completion and UNKNOWN never resumes', async () => {
  const {backend} = makeBackend({totalQuota: 2});
  const store = createCoordinatorStateStore({backend, enabled: true});
  const first = await claimViaStore(store, {actionKey: '5'.repeat(64), executionKey: '6'.repeat(64)});
  assert.equal(first.status, 'CLAIMED');
  await strictCompleteTransitionPath(store, first.claim);

  const duplicateLogical = await claimViaStore(store, {actionKey: '5'.repeat(64), executionKey: '7'.repeat(64)});
  assert.equal(duplicateLogical.status, 'ALREADY_CLAIMED');

  const second = await claimViaStore(store, {actionKey: '8'.repeat(64), executionKey: '9'.repeat(64)});
  assert.equal(second.status, 'CLAIMED');
  const unknown = await store.commit({
    claim: second.claim,
    transition: {kind: 'UNKNOWN', stage: 'OBSERVE_UNKNOWN', reviewRequestId: 'r2', sessionId: 's2'}
  });
  assert.equal(unknown.status, 'COMMITTED');

  const resume = await store.commit({
    claim: unknown.claim,
    transition: {kind: 'OBSERVE_PREPARING'}
  });
  assert.equal(resume.status, 'CONFLICT_RECONCILE');
});

test('canonical reconstruction rejects chain parent/digest/public tip tampering and claim projection removal', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claim = await claimViaStore(store, {actionKey: 'a'.repeat(64), executionKey: 'b'.repeat(64)});
  await strictCompleteTransitionPath(store, claim.claim);

  const envelope = await backend.exportCanonicalEnvelope();

  const tamperedSnapshot = JSON.parse(JSON.stringify(envelope));
  tamperedSnapshot.snapshot.oid = 'tampered-oid';
  assert.throws(() => createAtomicRecordMemoryTransport({initialEnvelope: tamperedSnapshot}), /INVALID_CANONICAL_ENVELOPE/);

  const removedClaim = JSON.parse(JSON.stringify(envelope));
  removedClaim.claims = [];
  assert.throws(() => createAtomicRecordMemoryTransport({initialEnvelope: removedClaim}), /INVALID_CANONICAL_ENVELOPE/);

  const brokenParent = JSON.parse(JSON.stringify(envelope));
  brokenParent.transitionChain[1].parentDigest = 'f'.repeat(64);
  assert.throws(() => createAtomicRecordMemoryTransport({initialEnvelope: brokenParent}), /INVALID_CANONICAL_ENVELOPE/);

  const wrongPublicTip = JSON.parse(JSON.stringify(envelope));
  wrongPublicTip.transitionChain[wrongPublicTip.transitionChain.length - 1].publicRevision += 1;
  assert.throws(() => createAtomicRecordMemoryTransport({initialEnvelope: wrongPublicTip}), /INVALID_CANONICAL_ENVELOPE/);
});

test('backend rejects chain capacity/byte exhaustion before replace even with nonvalidating transport', async () => {
  const seed = makeBackend({totalQuota: 1024});
  const seedStore = createCoordinatorStateStore({backend: seed.backend, enabled: true});
  const claimed = await claimViaStore(seedStore, {actionKey: '1'.repeat(64), executionKey: 'a'.repeat(64)});
  let claim = await moveToObservePreparing(seedStore, claimed.claim, {reviewRequestId: 'req-cap', sessionId: 'sess-cap'});
  let boundaryEnvelope = await seed.backend.exportCanonicalEnvelope();
  let blockedTransition = {kind: 'OBSERVE_PENDING'};
  let blockedClaim = claim;
  let exhausted = false;
  for (let index = 0; index < 5000; index += 1) {
    const toPending = await seedStore.commit({claim, transition: {kind: 'OBSERVE_PENDING'}});
    if (toPending.status !== 'COMMITTED') {
      exhausted = true;
      blockedClaim = claim;
      blockedTransition = {kind: 'OBSERVE_PENDING'};
      break;
    }
    claim = toPending.claim;
    boundaryEnvelope = await seed.backend.exportCanonicalEnvelope();
    const toPreparing = await seedStore.commit({claim, transition: {kind: 'OBSERVE_PREPARING'}});
    if (toPreparing.status !== 'COMMITTED') {
      exhausted = true;
      blockedClaim = claim;
      blockedTransition = {kind: 'OBSERVE_PREPARING'};
      break;
    }
    claim = toPreparing.claim;
    boundaryEnvelope = await seed.backend.exportCanonicalEnvelope();
  }
  assert.equal(exhausted, true);
  const nonValidating = makeNonValidatingBackend({initialEnvelope: boundaryEnvelope});
  const store = createCoordinatorStateStore({backend: nonValidating.backend, enabled: true});

  const before = await nonValidating.backend.exportCanonicalEnvelope();
  const exhaustedCommit = await store.commit({
    claim: (await store.reconcile(blockedClaim.executionKey)).claim,
    transition: blockedTransition
  });
  assert.equal(exhaustedCommit.status, 'CONFLICT_RECONCILE');
  assert.equal(nonValidating.getReplaceCalls(), 0);
  const after = await nonValidating.backend.exportCanonicalEnvelope();
  assert.equal(after.storageVersion, before.storageVersion);
  assert.equal(after.snapshot.revision, before.snapshot.revision);
  assert.equal(after.snapshot.oid, before.snapshot.oid);
  assert.equal(after.transitionChain.length, before.transitionChain.length);
});

test('one replace attempt only: unknown response without write fails closed, and ACK-loss after write stays uncertain without replay', async () => {
  const noWrite = makeBackend({
    beforeReplace: async () => {
      throw new Error('TRANSPORT_UNCERTAIN_BEFORE_WRITE');
    }
  });
  const noWriteStore = createCoordinatorStateStore({backend: noWrite.backend, enabled: true});
  const unknownClaim = await claimViaStore(noWriteStore, {actionKey: 'c'.repeat(64), executionKey: 'd'.repeat(64)});
  assert.equal(unknownClaim.status, 'CLAIM_UNKNOWN');
  assert.equal(noWrite.getReplaceCalls(), 1);

  let failOnce = true;
  const lostAck = makeBackend({
    afterReplace: async envelope => {
      const last = envelope.transitionChain[envelope.transitionChain.length - 1];
      if (failOnce && last?.kind === 'RECEIPT_POSTING') {
        failOnce = false;
        throw new Error('ACK_LOST_AFTER_WRITE');
      }
    }
  });
  const store = createCoordinatorStateStore({backend: lostAck.backend, enabled: true});
  const claimed = await claimViaStore(store, {actionKey: 'e'.repeat(64), executionKey: 'f'.repeat(64)});
  let claim = claimed.claim;
  for (const transition of [
    {
      kind: 'REVIEW_PENDING',
      actionKey: claim.actionKey,
      executionKey: claim.executionKey,
      reviewRequestId: 'r3',
      sessionId: 's3',
      reviewer: REVIEWER,
      repository: REPOSITORY,
      pullRequest: PR,
      headSha: HEAD,
      baseSha: BASE,
      diffDigest: 'd'.repeat(64),
      changedPathDigest: 'e'.repeat(64),
      changedPathCount: 1,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      workflowId: WORKFLOW_ID,
      selectionRevision: 20,
      reviewDeadlineAt: START + 1000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'r3', sessionId: 's3'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT', reviewRequestId: 'r3', sessionId: 's3'},
    {kind: 'RECEIPT_PREPARING', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  ]) {
    const next = await store.commit({claim, transition});
    assert.equal(next.status, 'COMMITTED');
    claim = next.claim;
  }
  const lost = await store.commit({claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(lost.status, 'UNKNOWN_RECONCILE');
  assert.equal(lostAck.getReplaceCalls(), 7);

  const replay = await store.commit({claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(replay.status, 'CONFLICT_RECONCILE');
  assert.equal(lostAck.getReplaceCalls(), 7);
});

test('lifecycle composition: final write failure before replacement leaves durable posting and restart readback-only without repost', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  let failFinalBeforeReplace = true;
  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const {backend} = makeBackend({
    totalQuota: 1,
    beforeReplace: async ({nextEnvelope}) => {
      const last = nextEnvelope.transitionChain[nextEnvelope.transitionChain.length - 1];
      if (failFinalBeforeReplace && last?.kind === 'RECEIPT_DELIVERED') {
        failFinalBeforeReplace = false;
        throw new Error('FAIL_BEFORE_REPLACE');
      }
    }
  });
  const store = createCoordinatorStateStore({backend, enabled: true});

  const start = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview: async input => {
      counters.dispatch += 1;
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    revalidate: async () => collected,
    now: () => START + 200,
    expiresAt: END
  });
  assert.equal(start.status, 'REVIEW_PENDING');

  const duplicateStart = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview: async () => {
      counters.dispatch += 1;
      return {status: 'ACKNOWLEDGED'};
    },
    revalidate: async () => collected,
    now: () => START + 210,
    expiresAt: END
  });
  assert.equal(duplicateStart.status, 'WAITING');
  assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');

  const firstObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => {
      counters.observe += 1;
      return buildCompletedObservation({start, collected});
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-before'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-before']};
      }
    },
    now: () => START + 300,
    expiresAt: END
  });
  assert.equal(firstObserve.status, 'UNKNOWN');
  assert.equal(firstObserve.reason, 'RECEIPT_STATE_COMMIT_UNKNOWN');

  const postedEnvelope = await backend.exportCanonicalEnvelope();
  const postedClaim = postedEnvelope.claims.find(item => item.executionKey === collected.executionKey);
  assert.equal(postedClaim.status, 'RECEIPT_POSTING');
  assert.equal(postedClaim.lastStage, 'RECEIPT_POSTING');
  assert.equal(postedEnvelope.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(postedEnvelope.admissionState.consumedQuota, 1);
  const reconstructed = JSON.parse(JSON.stringify(postedEnvelope));
  const restartedFacade = rebuildStoreFromEnvelope(reconstructed);

  const restarted = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restartedFacade.store,
    observeReview: async () => {
      counters.observe += 1;
      return {status: 'PENDING'};
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-replay'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-before']};
      }
    },
    now: () => START + 400,
    expiresAt: END
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'RECEIPT_FOUND_RECONCILE_REQUIRED');

  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 1, readback: 2});
});

test('lifecycle composition: ACK-loss after persisted delivered resumes as authoritative COMPLETE without repost', async () => {
  const collected = await collectReady();
  let failAfterPersistedFinal = true;
  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};

  const {backend} = makeBackend({
    totalQuota: 1,
    afterReplace: async envelope => {
      const last = envelope.transitionChain[envelope.transitionChain.length - 1];
      if (failAfterPersistedFinal && last?.kind === 'RECEIPT_DELIVERED') {
        failAfterPersistedFinal = false;
        throw new Error('ACK_LOSS_AFTER_PERSISTED_DELIVERED');
      }
    }
  });
  const store = createCoordinatorStateStore({backend, enabled: true});

  const start = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview: async input => {
      counters.dispatch += 1;
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    revalidate: async () => collected,
    now: () => START + 500,
    expiresAt: END
  });
  assert.equal(start.status, 'REVIEW_PENDING');

  const firstObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => {
      counters.observe += 1;
      return buildCompletedObservation({start, collected});
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-after'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-after']};
      }
    },
    now: () => START + 600,
    expiresAt: END
  });
  assert.equal(firstObserve.status, 'UNKNOWN');
  assert.equal(firstObserve.reason, 'RECEIPT_STATE_COMMIT_UNKNOWN');

  const durable = await backend.exportCanonicalEnvelope();
  const durableClaim = durable.claims.find(item => item.executionKey === collected.executionKey);
  assert.equal(durableClaim.status, 'COMMITTED');
  assert.equal(durableClaim.lastStage, 'RECEIPT_DELIVERED');
  assert.equal(durable.admissionState.activeGate, null);
  const reconstructed = JSON.parse(JSON.stringify(durable));
  const restartedFacade = rebuildStoreFromEnvelope(reconstructed);

  const resumed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restartedFacade.store,
    observeReview: async () => {
      counters.observe += 1;
      return {status: 'PENDING'};
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-unexpected'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-after']};
      }
    },
    now: () => START + 700,
    expiresAt: END
  });
  assert.equal(resumed.status, 'COMPLETE');
  assert.equal(counters.post, 1);
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 1, readback: 1});

  const quotaBlocked = await claimViaStore(restartedFacade.store, {actionKey: '9'.repeat(64), executionKey: '0'.repeat(64)});
  assert.equal(quotaBlocked.status, 'BUDGET_EXHAUSTED');
});

test('lifecycle composition: boundary-derived NEEDS_MORE_EVIDENCE persists durable INCOMPLETE and duplicate resume is readback-only', async () => {
  const collected = await collectReady();
  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const {backend} = makeBackend({totalQuota: 1});
  const store = createCoordinatorStateStore({backend, enabled: true});

  const start = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview: async input => {
      counters.dispatch += 1;
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    revalidate: async () => collected,
    now: () => START + 800,
    expiresAt: END
  });
  assert.equal(start.status, 'REVIEW_PENDING');

  const firstObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => {
      counters.observe += 1;
      return buildCompletedObservation({
        start,
        collected,
        completionState: 'INCOMPLETE',
        verdict: 'NEEDS_MORE_EVIDENCE'
      });
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-unexpected'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-unexpected']};
      }
    },
    now: () => START + 900,
    expiresAt: END
  });
  assert.equal(firstObserve.status, 'INCOMPLETE');
  assert.equal(firstObserve.completionState, 'INCOMPLETE');
  assert.equal(firstObserve.verdict, 'NEEDS_MORE_EVIDENCE');

  const durable = await backend.exportCanonicalEnvelope();
  const durableClaim = durable.claims.find(item => item.executionKey === collected.executionKey);
  assert.equal(durableClaim.status, 'REVIEWED');
  assert.equal(durableClaim.lastStage, 'REVIEW_RESULT');
  assert.equal(durableClaim.completionState, 'INCOMPLETE');
  assert.equal(durableClaim.verdict, 'NEEDS_MORE_EVIDENCE');
  assert.equal(durable.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(durable.admissionState.consumedQuota, 1);
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});

  const restartedFacade = rebuildStoreFromEnvelope(JSON.parse(JSON.stringify(durable)));
  const resumed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restartedFacade.store,
    observeReview: async () => {
      counters.observe += 1;
      return {status: 'PENDING'};
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        return {status: 'CREATED', receiptId: 'receipt-replay'};
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        return {status: 'FOUND', complete: true, receiptIds: ['receipt-replay']};
      }
    },
    now: () => START + 1000,
    expiresAt: END
  });
  assert.equal(resumed.status, 'INCOMPLETE');
  assert.equal(resumed.completionState, 'INCOMPLETE');
  assert.equal(resumed.verdict, 'NEEDS_MORE_EVIDENCE');
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});
  const afterResumeEnvelope = await restartedFacade.backend.exportCanonicalEnvelope();
  assert.equal(afterResumeEnvelope.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(afterResumeEnvelope.admissionState.consumedQuota, 1);
});
