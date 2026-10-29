import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';

let lifecycle = null;
try {
  lifecycle = await import('../scripts/autonomy/m11-review-lifecycle.mjs');
} catch {
  lifecycle = null;
}

const START = 1700000000000;
const END = START + 86400000;
const REPOSITORY = 'Achi1984/meridian';
const PR = 973;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;

function makeBackend({totalQuota = 3, afterReplace = null} = {}) {
  const transport = createAtomicRecordMemoryTransport({
    initialEnvelope: createAtomicRecordEnvelope({totalQuota}),
    afterReplace
  });
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START + 10});
  return {transport, backend};
}

async function claimViaStore(store, {actionKey, executionKey, owner = 'writer-one'} = {}) {
  const before = await store.read();
  assert.equal(before.status, 'READY');
  const claim = await store.claim({
    actionKey,
    executionKey,
    packetKey: 'f'.repeat(64),
    expectedRevision: before.snapshot.revision,
    expectedOid: before.snapshot.oid,
    owner,
    now: START + 10
  });
  return claim;
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

test('claim mutates private storageVersion only; public pair advances only on commit transition', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claimed = await claimViaStore(store, {
    actionKey: '1'.repeat(64),
    executionKey: '2'.repeat(64)
  });
  assert.equal(claimed.status, 'CLAIMED');

  const afterClaim = await backend.exportCanonicalEnvelope();
  assert.equal(afterClaim.storageVersion, 1);
  assert.equal(afterClaim.snapshot.revision, 0);
  assert.equal(afterClaim.snapshot.oid, 'root');

  const committed = await store.commit({
    claim: claimed.claim,
    transition: {kind: 'REVIEW_PENDING', reviewRequestId: 'r1', sessionId: 's1'}
  });
  assert.equal(committed.status, 'COMMITTED');
  const afterCommit = await backend.exportCanonicalEnvelope();
  assert.equal(afterCommit.storageVersion, 2);
  assert.equal(afterCommit.snapshot.revision, 1);
  assert.equal(afterCommit.snapshot.oid, committed.oid);
});

test('competing claims produce one winner and stale expectation does not mutate state', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const before = await backend.exportCanonicalEnvelope();

  const results = await Promise.all([
    claimViaStore(store, {actionKey: '3'.repeat(64), executionKey: '4'.repeat(64), owner: 'writer-a'}),
    claimViaStore(store, {actionKey: '5'.repeat(64), executionKey: '6'.repeat(64), owner: 'writer-b'})
  ]);
  assert.equal(results.filter(item => item.status === 'CLAIMED').length, 1);

  const stale = await backend.createOnlyClaim({
    actionKey: '7'.repeat(64),
    executionKey: '8'.repeat(64),
    packetKey: 'f'.repeat(64),
    maxPackets: 3,
    maxActiveClaims: 1,
    owner: 'writer-c',
    expectedRevision: before.snapshot.revision,
    expectedOid: before.snapshot.oid,
    createdAt: START + 20
  });
  assert.equal(stale.status, 'BUSY');
  const after = await backend.exportCanonicalEnvelope();
  assert.equal(after.storageVersion, 1);
});

test('duplicate execution/logical identities are rejected and claims are retained with permanent consumed quota across restart', async () => {
  const {backend} = makeBackend({totalQuota: 1});
  const store = createCoordinatorStateStore({backend, enabled: true});
  const first = await claimViaStore(store, {
    actionKey: '9'.repeat(64),
    executionKey: 'a'.repeat(64)
  });
  assert.equal(first.status, 'CLAIMED');

  const dupExec = await backend.createOnlyClaim({
    actionKey: 'b'.repeat(64),
    executionKey: 'a'.repeat(64),
    packetKey: 'f'.repeat(64),
    maxPackets: 3,
    maxActiveClaims: 1,
    owner: 'writer-z',
    expectedRevision: 0,
    expectedOid: 'root',
    createdAt: START + 20
  });
  assert.equal(dupExec.status, 'EXISTS');

  let claim = first.claim;
  for (const transition of [
    {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'},
    {kind: 'RECEIPT_POSTING'},
    {kind: 'RECEIPT_DELIVERED', receiptId: 'receipt-1', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  ]) {
    const result = await store.commit({claim, transition});
    assert.equal(result.status, 'COMMITTED');
    claim = result.claim;
  }

  const serialized = JSON.stringify(await backend.exportCanonicalEnvelope());
  const reconstructedBackend = createCoordinatorAtomicRecordBackend({
    transport: createAtomicRecordMemoryTransport({initialEnvelope: JSON.parse(serialized)}),
    now: () => START + 50
  });
  const restartedStore = createCoordinatorStateStore({backend: reconstructedBackend, enabled: true});
  const retained = await restartedStore.reconcile('a'.repeat(64));
  assert.equal(retained.status, 'READY');
  assert.equal(retained.claim.status, 'COMMITTED');

  const exhausted = await claimViaStore(restartedStore, {
    actionKey: 'c'.repeat(64),
    executionKey: 'd'.repeat(64)
  });
  assert.equal(exhausted.status, 'BUDGET_EXHAUSTED');
});

test('invalid canonical reconstruction rejects inconsistent chain and reducer/projection mismatch', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claimed = await claimViaStore(store, {
    actionKey: 'e'.repeat(64),
    executionKey: 'f'.repeat(64)
  });
  assert.equal(claimed.status, 'CLAIMED');

  const envelope = await backend.exportCanonicalEnvelope();
  const badChain = JSON.parse(JSON.stringify(envelope));
  badChain.transitionChain[0].storageVersion = 999;
  assert.throws(() => createCoordinatorAtomicRecordBackend({
    transport: createAtomicRecordMemoryTransport({initialEnvelope: badChain}),
    now: () => START
  }), /INVALID_CANONICAL_ENVELOPE/);

  const badProjection = JSON.parse(JSON.stringify(envelope));
  badProjection.admissionState.activeGate = null;
  assert.throws(() => createCoordinatorAtomicRecordBackend({
    transport: createAtomicRecordMemoryTransport({initialEnvelope: badProjection}),
    now: () => START
  }), /(INVALID_CANONICAL_ENVELOPE|STATE_INVALID)/);
});

test('dispatch/observe/receipt transition fences are strict and duplicate receipt preparation is rejected', async () => {
  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claimed = await claimViaStore(store, {
    actionKey: '0'.repeat(64),
    executionKey: '1'.repeat(64)
  });
  assert.equal(claimed.status, 'CLAIMED');

  const illegalFirst = await store.commit({claim: claimed.claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(illegalFirst.status, 'CONFLICT_RECONCILE');

  let claim = claimed.claim;
  for (const transition of [
    {kind: 'REVIEW_PENDING', reviewRequestId: 'req-1', sessionId: 'sess-1'},
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'req-1', sessionId: 'sess-1'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'OBSERVE_PENDING'},
    {kind: 'OBSERVE_PREPARING'},
    {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'},
    {kind: 'RECEIPT_PREPARING', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  ]) {
    const result = await store.commit({claim, transition});
    assert.equal(result.status, 'COMMITTED', transition.kind);
    claim = result.claim;
  }

  const duplicatePreparing = await store.commit({
    claim,
    transition: {kind: 'RECEIPT_PREPARING', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  });
  assert.equal(duplicatePreparing.status, 'CONFLICT_RECONCILE');

  const posting = await store.commit({claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(posting.status, 'COMMITTED');
  const delivered = await store.commit({
    claim: posting.claim,
    transition: {kind: 'RECEIPT_DELIVERED', receiptId: 'receipt-xyz', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}
  });
  assert.equal(delivered.status, 'COMMITTED');

  const resumeFromUnknown = await store.commit({
    claim: {...posting.claim, expectedRevision: posting.revision, expectedOid: posting.oid},
    transition: {kind: 'UNKNOWN', stage: 'RECEIPT_DELIVERY_UNKNOWN'}
  });
  assert.equal(resumeFromUnknown.status, 'CONFLICT_RECONCILE');
});

test('lost write ACK yields unknown reconcile and replay does not reapply', async () => {
  let failOnce = true;
  const {backend} = makeBackend({
    afterReplace: async envelope => {
      const last = envelope.transitionChain[envelope.transitionChain.length - 1];
      if (failOnce && last?.kind === 'RECEIPT_POSTING') {
        failOnce = false;
        throw new Error('ACK_LOST_AFTER_WRITE');
      }
    }
  });
  const store = createCoordinatorStateStore({backend, enabled: true});
  const claimed = await claimViaStore(store, {
    actionKey: '2'.repeat(64),
    executionKey: '3'.repeat(64)
  });
  let claim = claimed.claim;
  const review = await store.commit({claim, transition: {kind: 'REVIEW_RESULT', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'}});
  assert.equal(review.status, 'COMMITTED');
  claim = review.claim;

  const unknown = await store.commit({claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(unknown.status, 'UNKNOWN_RECONCILE');

  const replay = await store.commit({claim, transition: {kind: 'RECEIPT_POSTING'}});
  assert.equal(replay.status, 'CONFLICT_RECONCILE');
  const envelope = await backend.exportCanonicalEnvelope();
  assert.equal(envelope.transitionChain.filter(item => item.kind === 'RECEIPT_POSTING').length, 1);
});

test('accepted lifecycle restart/review/single-receipt and post-success/final-commit-failure readback-only', {skip: lifecycle === null}, async () => {
  const {startReviewLifecycle, observeReviewLifecycle} = lifecycle;
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const {backend} = makeBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  let posted = 0;
  const receipts = [];

  const start = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
    dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
    observeReview: async () => ({status: 'PENDING'}),
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    revalidate: async () => collected,
    receipt: {
      postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
      lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(start.status, 'REVIEW_PENDING');

  const observedComplete = {
    status: 'COMPLETED',
    observedAtMs: clock.value + 100,
    ci: {
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      selectionRevision: collected.selectionRevision
    },
    modelOutput: {
      reviewRequestId: start.reviewRequestId,
      sessionId: start.sessionId,
      reviewer: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
      coverageParts: ['scope', 'safety', 'tests', 'diff-anchoring', 'policy'],
      verdict: 'GREEN_LIGHT',
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'complete'
    },
    trustedRuntimeEvidence: {
      evidenceId: 'runtime-1',
      provider: 'runtime',
      observedAtMs: clock.value,
      expiresAtMs: clock.value + 60000,
      runtime: {
        reviewRequestId: start.reviewRequestId,
        sessionId: start.sessionId,
        reviewer: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
        repository: collected.repository,
        pullRequest: collected.pullRequest,
        headSha: collected.headSha,
        baseSha: collected.baseSha,
        diffDigest: collected.diffDigest,
        terminalState: 'completed',
        stopReason: 'end_turn',
        truncated: false,
        turnLimit: false,
        coverageParts: ['scope', 'safety', 'tests', 'diff-anchoring', 'policy'],
        changedPaths: [...collected.changedPaths]
      }
    }
  };

  const completed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => observedComplete,
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        posted++;
        receipts.push('receipt-1');
        return {status: 'CREATED', receiptId: 'receipt-1'};
      },
      lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: [...receipts]})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(completed.status, 'COMPLETE');
  assert.equal(posted, 1);

  const noReplay = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => ({status: 'PENDING'}),
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        posted++;
        return {status: 'CREATED', receiptId: 'receipt-2'};
      },
      lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-2']})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(noReplay.status, 'COMPLETE');
  assert.equal(posted, 1);
});

test('accepted lifecycle post-success/final-commit-failure resumes readback-only without repost', {skip: lifecycle === null}, async () => {
  const {startReviewLifecycle, observeReviewLifecycle} = lifecycle;
  const collected = await collectReady();
  let failFinalCommitOnce = true;
  const {backend} = makeBackend({
    afterReplace: async envelope => {
      const last = envelope.transitionChain[envelope.transitionChain.length - 1];
      if (failFinalCommitOnce && last?.kind === 'RECEIPT_DELIVERED') {
        failFinalCommitOnce = false;
        throw new Error('FINAL_COMMIT_ACK_LOST');
      }
    }
  });
  const store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 200};
  let posted = 0;

  const start = await startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
    dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
    observeReview: async () => ({status: 'PENDING'}),
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    revalidate: async () => collected,
    receipt: {
      postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
      lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(start.status, 'REVIEW_PENDING');

  const boundary = {
    status: 'COMPLETED',
    observedAtMs: clock.value,
    ci: {
      runId: collected.runId,
      runAttempt: collected.runAttempt,
      workflowId: collected.workflowId,
      selectionRevision: collected.selectionRevision
    },
    modelOutput: {
      reviewRequestId: start.reviewRequestId,
      sessionId: start.sessionId,
      reviewer: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
      coverageParts: ['scope', 'safety', 'tests', 'diff-anchoring', 'policy'],
      verdict: 'GREEN_LIGHT',
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'ok'
    },
    trustedRuntimeEvidence: {
      evidenceId: 'runtime-2',
      provider: 'runtime',
      observedAtMs: clock.value,
      expiresAtMs: clock.value + 60000,
      runtime: {
        reviewRequestId: start.reviewRequestId,
        sessionId: start.sessionId,
        reviewer: {provider: 'claude', agent: 'agent', model: 'model', transport: 'trusted-runtime'},
        repository: collected.repository,
        pullRequest: collected.pullRequest,
        headSha: collected.headSha,
        baseSha: collected.baseSha,
        diffDigest: collected.diffDigest,
        terminalState: 'completed',
        stopReason: 'end_turn',
        truncated: false,
        turnLimit: false,
        coverageParts: ['scope', 'safety', 'tests', 'diff-anchoring', 'policy'],
        changedPaths: [...collected.changedPaths]
      }
    }
  };

  const firstObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => boundary,
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        posted++;
        return {status: 'CREATED', receiptId: 'receipt-final'};
      },
      lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-final']})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(firstObserve.status, 'UNKNOWN');

  const replayObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => ({status: 'PENDING'}),
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        posted++;
        return {status: 'CREATED', receiptId: 'receipt-replay'};
      },
      lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-final']})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(replayObserve.status, 'UNKNOWN');
  assert.equal(replayObserve.reason, 'RECEIPT_FOUND_RECONCILE_REQUIRED');
  assert.equal(posted, 1);
});
