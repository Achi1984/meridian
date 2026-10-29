import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {startReviewLifecycle, observeReviewLifecycle} from '../scripts/autonomy/m11-review-lifecycle.mjs';
import {evaluateReviewBoundary} from '../scripts/autonomy/m11-review-boundary.mjs';
import {captureClaudeRuntimeCandidate, SUPPORTED_PARSER_CONTRACT_VERSION} from '../scripts/autonomy/m11-claude-runtime-capture.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';

const START = 1700000000000;
const END = START + 86400000;
const REPOSITORY = 'Achi1984/meridian';
const PR = 973;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;
const REVIEWER = Object.freeze({
  provider: 'claude',
  agent: 'claude-code-action',
  model: 'synthetic-model',
  transport: 'trusted-runtime'
});

function makeFixtureApi({headSha = HEAD, baseSha = BASE, authExpiresAtMs = START + 600000} = {}) {
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
      expiresAtMs: authExpiresAtMs
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
        text: 'diff --git a/scripts/autonomy/m11-review-lifecycle.mjs b/scripts/autonomy/m11-review-lifecycle.mjs\n+acceptance',
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

async function collectReady({nowMs = START + 100} = {}) {
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
    api: makeFixtureApi(),
    now: () => nowMs
  });
}

function createFacade({initialEnvelope = createAtomicRecordEnvelope({totalQuota: 1}), replaceHook = null} = {}) {
  const base = createAtomicRecordMemoryTransport({initialEnvelope});
  const transport = {
    readCanonicalEnvelope: (...args) => base.readCanonicalEnvelope(...args),
    replaceCanonicalEnvelope: async payload => {
      if (typeof replaceHook === 'function') {
        const decided = await replaceHook(payload);
        if (decided) return decided;
      }
      return base.replaceCanonicalEnvelope(payload);
    }
  };
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START + 10});
  const store = createCoordinatorStateStore({backend, enabled: true});
  return {backend, store};
}

function rebuildFacadeFromBackend(backend, options = {}) {
  return backend.exportCanonicalEnvelope()
    .then(envelope => createFacade({
      initialEnvelope: JSON.parse(JSON.stringify(envelope)),
      ...options
    }));
}

function makeCompletedObservation({start, collected, nowMs = START + 300, trustedRuntimeEvidence}) {
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
      verdict: 'GREEN_LIGHT',
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'complete'
    },
    trustedRuntimeEvidence
  };
}

function makeTrustedRuntimeEvidence({start, collected, nowMs = START + 300}) {
  return {
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
  };
}

async function startPendingLifecycle({store, collected, counters, nowMs = START + 200, reviewDeadlineMs = 300000}) {
  return startReviewLifecycle({
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview: async input => {
      counters.dispatch += 1;
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    revalidate: async () => collected,
    now: () => nowMs,
    reviewDeadlineMs,
    expiresAt: END
  });
}

test('1) exact pair collection to durable dispatch ACK persists one claim and expected private/public versions', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const {backend, store} = createFacade();
  const started = await startPendingLifecycle({store, collected, counters});

  assert.equal(started.status, 'REVIEW_PENDING');
  assert.equal(counters.dispatch, 1);
  const envelope = await backend.exportCanonicalEnvelope();
  assert.equal(envelope.storageVersion, 3);
  assert.equal(envelope.snapshot.revision, 2);
  assert.equal(envelope.claims.length, 1);
  assert.equal(envelope.admissionState.consumedQuota, 1);
  assert.equal(envelope.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(envelope.claims[0].status, 'REVIEW_PENDING');
  assert.equal(envelope.claims[0].lastStage, 'DISPATCH_ACKED');
  assert.deepEqual(envelope.transitionChain.map(record => record.kind), [
    'CLAIM_CREATED',
    'REVIEW_PENDING',
    'DISPATCH_ACKED'
  ]);
});

test('2) pending entry survives JSON restart and 400s advance without re-dispatch or new reservation', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const initial = createFacade();
  const started = await startPendingLifecycle({
    store: initial.store,
    collected,
    counters,
    nowMs: START + 200,
    reviewDeadlineMs: 500000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const restarted = await rebuildFacadeFromBackend(initial.backend);
  const freshCollected = await collectReady({nowMs: START + 400200});
  assert.equal(freshCollected.status, 'READY');

  const observed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected: freshCollected,
    store: restarted.store,
    observeReview: async () => {
      counters.observe += 1;
      return {status: 'PENDING'};
    },
    revalidate: async () => freshCollected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run in pending path');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run in pending path');
      }
    },
    now: () => START + 400200,
    expiresAt: END
  });

  assert.equal(observed.status, 'REVIEW_PENDING');
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});
  const envelope = await restarted.backend.exportCanonicalEnvelope();
  assert.equal(envelope.claims.length, 1);
  assert.equal(envelope.admissionState.consumedQuota, 1);
  assert.equal(envelope.transitionChain.filter(record => record.kind === 'CLAIM_CREATED').length, 1);
  assert.deepEqual(envelope.transitionChain.map(record => record.kind), [
    'CLAIM_CREATED',
    'REVIEW_PENDING',
    'DISPATCH_ACKED',
    'OBSERVE_PREPARING',
    'OBSERVE_PENDING'
  ]);
});

test('3) captured UNVERIFIED runtime candidate is rejected by boundary and lifecycle, then restart remains terminal UNKNOWN', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const fixturePath = '/home/runner/work/meridian/meridian/test/fixtures/m11-coordinator-core-acceptance/claude-runtime.json';
  const runtimeBytes = await readFile(fixturePath);
  const capture = captureClaudeRuntimeCandidate(runtimeBytes, {
    parserContractVersion: SUPPORTED_PARSER_CONTRACT_VERSION,
    requestedModel: REVIEWER.model
  });
  assert.equal(capture.status, 'UNVERIFIED');
  assert.equal(capture.promotesTrustedRuntime, false);
  assert.equal(capture.diagnostic, 'CAPTURED_UNVERIFIED');
  assert.equal(capture.candidate.stopReason, 'UNKNOWN');
  assert.equal(capture.candidate.truncated, 'UNKNOWN');
  assert.equal(capture.candidate.provenance, 'UNKNOWN');

  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const first = createFacade();
  const started = await startPendingLifecycle({store: first.store, collected, counters, nowMs: START + 500});
  assert.equal(started.status, 'REVIEW_PENDING');

  const boundary = evaluateReviewBoundary({
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    trustedRuntimeEvidence: capture.candidate,
    modelOutput: {
      reviewRequestId: started.reviewRequestId,
      sessionId: started.sessionId,
      reviewer: {...REVIEWER},
      coverageParts: [...REQUIRED_REVIEW_PARTS],
      verdict: 'GREEN_LIGHT',
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'candidate-only runtime capture'
    },
    expectedIdentity: {
      reviewRequestId: started.reviewRequestId,
      sessionId: started.sessionId,
      reviewer: {...REVIEWER},
      repository: collected.repository,
      pullRequest: collected.pullRequest,
      headSha: collected.headSha,
      baseSha: collected.baseSha,
      diffDigest: collected.diffDigest,
      changedPaths: [...collected.changedPaths]
    },
    now: () => START + 520
  });
  assert.notEqual(boundary.status, 'ADMITTED');

  const observed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: first.store,
    observeReview: async () => {
      counters.observe += 1;
      return makeCompletedObservation({
        start: started,
        collected,
        nowMs: START + 530,
        trustedRuntimeEvidence: capture.candidate
      });
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must never run on boundary rejection');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must never run on boundary rejection');
      }
    },
    now: () => START + 530,
    expiresAt: END
  });

  assert.equal(observed.status, 'UNKNOWN');
  assert.equal(observed.reason, 'BOUNDARY_REJECTED');
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});

  const durable = await first.backend.exportCanonicalEnvelope();
  assert.equal(durable.admissionState.consumedQuota, 1);
  assert.equal(durable.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(durable.claims[0].status, 'UNKNOWN');
  assert.equal(durable.claims[0].lastStage, 'BOUNDARY_REJECTED');

  const restarted = await rebuildFacadeFromBackend(first.backend);
  const resumed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restarted.store,
    observeReview: async () => {
      counters.observe += 1;
      throw new Error('observe should not run after terminal UNKNOWN fence');
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run after terminal UNKNOWN fence');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run after terminal UNKNOWN fence');
      }
    },
    now: () => START + 540,
    expiresAt: END
  });
  assert.equal(resumed.status, 'UNKNOWN');
  assert.equal(resumed.reason, 'TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});
});

test('4) pending claim crossing deadline persists INCOMPLETE and restart remains read-only with retained gate/quota', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  const first = createFacade();
  const started = await startPendingLifecycle({
    store: first.store,
    collected,
    counters,
    nowMs: START + 600,
    reviewDeadlineMs: 1000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const expired = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: first.store,
    observeReview: async () => {
      counters.observe += 1;
      throw new Error('observe should not be called after deadline expiry');
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run on INCOMPLETE timeout');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run on INCOMPLETE timeout');
      }
    },
    now: () => START + 2000,
    expiresAt: END
  });

  assert.equal(expired.status, 'INCOMPLETE');
  assert.equal(expired.reason, 'REVIEW_DEADLINE_EXPIRED');
  assert.equal(expired.completionState, 'INCOMPLETE');
  assert.deepEqual(counters, {dispatch: 1, observe: 0, post: 0, readback: 0});

  const durable = await first.backend.exportCanonicalEnvelope();
  assert.equal(durable.admissionState.consumedQuota, 1);
  assert.equal(durable.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(durable.claims[0].status, 'REVIEWED');
  assert.equal(durable.claims[0].lastStage, 'REVIEW_RESULT');
  assert.equal(durable.claims[0].completionState, 'INCOMPLETE');

  const restarted = await rebuildFacadeFromBackend(first.backend);
  const resumed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restarted.store,
    observeReview: async () => {
      counters.observe += 1;
      throw new Error('observe should not run after persisted INCOMPLETE');
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run after persisted INCOMPLETE');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run after persisted INCOMPLETE');
      }
    },
    now: () => START + 2500,
    expiresAt: END
  });

  assert.equal(resumed.status, 'INCOMPLETE');
  assert.equal(resumed.completionState, 'INCOMPLETE');
  assert.deepEqual(counters, {dispatch: 1, observe: 0, post: 0, readback: 0});
});

test('5) ambiguous CAS at observe fence fails closed without retry and restart cannot advance retained fence', async () => {
  const collected = await collectReady();
  assert.equal(collected.status, 'READY');

  const counters = {dispatch: 0, observe: 0, post: 0, readback: 0};
  let conflictInjected = false;
  const first = createFacade({
    replaceHook: async ({nextEnvelope}) => {
      const last = nextEnvelope.transitionChain[nextEnvelope.transitionChain.length - 1];
      if (!conflictInjected && last?.kind === 'OBSERVE_PENDING') {
        conflictInjected = true;
        return {status: 'CONFLICT', storageVersion: nextEnvelope.storageVersion - 1};
      }
      return null;
    }
  });

  const started = await startPendingLifecycle({store: first.store, collected, counters, nowMs: START + 700});
  assert.equal(started.status, 'REVIEW_PENDING');

  const uncertain = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: first.store,
    observeReview: async () => {
      counters.observe += 1;
      return {status: 'PENDING'};
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run in CAS ambiguity path');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run in CAS ambiguity path');
      }
    },
    now: () => START + 710,
    expiresAt: END
  });

  assert.equal(uncertain.status, 'UNKNOWN');
  assert.equal(uncertain.reason, 'OBSERVE_PENDING_STATE_UNKNOWN');
  assert.equal(conflictInjected, true);
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});

  const durable = await first.backend.exportCanonicalEnvelope();
  assert.equal(durable.claims[0].lastStage, 'OBSERVE_PREPARING');
  assert.equal(durable.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(durable.admissionState.consumedQuota, 1);

  const restarted = await rebuildFacadeFromBackend(first.backend);
  const resumed = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store: restarted.store,
    observeReview: async () => {
      counters.observe += 1;
      throw new Error('observe must not run without durable proof beyond OBSERVE_PREPARING');
    },
    revalidate: async () => collected,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => {
        counters.post += 1;
        throw new Error('receipt callbacks must not run after nonadvancing fence');
      },
      lookupByActionKey: async () => {
        counters.readback += 1;
        throw new Error('receipt callbacks must not run after nonadvancing fence');
      }
    },
    now: () => START + 720,
    expiresAt: END
  });

  assert.equal(resumed.status, 'UNKNOWN');
  assert.equal(resumed.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
  assert.deepEqual(counters, {dispatch: 1, observe: 1, post: 0, readback: 0});
});
