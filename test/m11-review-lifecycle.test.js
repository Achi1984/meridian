import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';
import {startReviewLifecycle, observeReviewLifecycle} from '../scripts/autonomy/m11-review-lifecycle.mjs';

const REPOSITORY = 'Achi1984/meridian';
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;
const SELECTION_REVISION = 20;
const PR = 973;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const START = 1700000000000;
const END = START + 86400000;
const REVIEWER = Object.freeze({
  provider: 'claude',
  agent: 'claude-code-action',
  model: 'synthetic-model',
  transport: 'trusted-runtime'
});

function collectConfig() {
  return {
    enabled: true,
    repository: REPOSITORY,
    pullRequests: [PR],
    actors: ['Achi1984'],
    startsAt: START,
    expiresAt: END,
    maxPages: 5,
    maxRuntimeMs: 1000
  };
}

function runData({headSha = HEAD, baseSha = BASE} = {}) {
  return {
    id: RUN_ID,
    repository: REPOSITORY,
    workflowId: WORKFLOW_ID,
    workflowPath: '.github/workflows/backend-safety.yml',
    runAttempt: RUN_ATTEMPT,
    runNumber: SELECTION_REVISION,
    status: 'completed',
    conclusion: 'success',
    headSha,
    baseSha,
    pullRequests: [PR],
    actor: 'Achi1984',
    triggeringActor: 'Achi1984'
  };
}

function fixtureApi({headSha = HEAD, baseSha = BASE} = {}) {
  const run = runData({headSha, baseSha});
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
    async getWorkflowRun() {
      return run;
    },
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
        text: 'diff --git a/scripts/autonomy/m11-review-lifecycle.mjs b/scripts/autonomy/m11-review-lifecycle.mjs\n+integration'
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

async function collectReady({headSha = HEAD, baseSha = BASE, nowMs = START + 100} = {}) {
  return collectExactPair({
    hint: {
      eventName: 'workflow_run',
      repository: REPOSITORY,
      workflowRunId: RUN_ID,
      workflowRunAttempt: RUN_ATTEMPT
    },
    config: collectConfig(),
    api: fixtureApi({headSha, baseSha}),
    now: () => nowMs
  });
}

class DurableLifecycleBackend {
  constructor({failTransitionKinds = []} = {}) {
    this.capabilities = {
      immutableCommits: true,
      validatedRevisionChain: true,
      atomicCreateOnlyClaims: true,
      atomicSingleWriterClaim: true,
      atomicPacketQuota: true,
      atomicExpectedOidCAS: true
    };
    this.snapshot = {revision: 0, oid: 'root', chainValid: true};
    this.claims = new Map();
    this.commits = new Map();
    this.nextCommit = 0;
    this.failTransitionKinds = new Set(failTransitionKinds);
    this.failedKinds = new Set();
  }

  async readSnapshot() {
    return structuredClone(this.snapshot);
  }

  async createOnlyClaim(input) {
    if (input.maxActiveClaims !== 1 || input.maxPackets !== 3) return {status: 'INVALID_LIMIT'};
    if (this.claims.has(input.executionKey)) return {status: 'EXISTS'};
    if ([...this.claims.values()].some(claim => claim.status !== 'COMMITTED')) return {status: 'BUSY'};
    if (input.expectedRevision !== this.snapshot.revision || input.expectedOid !== this.snapshot.oid) {
      return {status: 'STALE_EXPECTATION'};
    }
    const claimId = `claim-${this.claims.size + 1}`;
    this.claims.set(input.executionKey, {
      status: 'CLAIMED',
      lastStage: 'CLAIMED',
      claimId,
      actionKey: input.actionKey,
      executionKey: input.executionKey,
      owner: input.owner,
      expectedRevision: input.expectedRevision,
      expectedOid: input.expectedOid
    });
    return {status: 'CREATED', claimId};
  }

  async createImmutableCommit(input) {
    const oid = `commit-${++this.nextCommit}`;
    this.commits.set(oid, structuredClone(input));
    return {
      oid,
      parentOid: input.parentOid,
      revision: input.revision,
      commitNonce: input.commitNonce
    };
  }

  async compareAndSwapRef(input) {
    const claim = this.claims.get(input.executionKey);
    const current = this.snapshot;
    const commit = this.commits.get(input.newOid);
    if (!claim || !commit || claim.claimId !== input.claimId || claim.actionKey !== input.actionKey
      || current.oid !== input.expectedOid || current.revision !== input.expectedRevision
      || commit.parentOid !== current.oid || commit.revision !== input.newRevision) {
      return {status: 'CONFLICT'};
    }
    if (this.failTransitionKinds.has(commit.transition.kind)
      && !this.failedKinds.has(commit.transition.kind)) {
      this.failedKinds.add(commit.transition.kind);
      return {status: 'CONFLICT'};
    }
    current.oid = input.newOid;
    current.revision = input.newRevision;
    claim.expectedOid = input.newOid;
    claim.expectedRevision = input.newRevision;
    const transition = commit.transition;
    if (transition.kind === 'REVIEW_PENDING') {
      claim.status = 'REVIEW_PENDING';
      claim.lastStage = 'REVIEW_PENDING';
      claim.reviewRequestId = transition.reviewRequestId;
      claim.sessionId = transition.sessionId;
      claim.reviewer = transition.reviewer;
      claim.repository = transition.repository;
      claim.pullRequest = transition.pullRequest;
      claim.headSha = transition.headSha;
      claim.baseSha = transition.baseSha;
      claim.diffDigest = transition.diffDigest;
      claim.runId = transition.runId;
      claim.runAttempt = transition.runAttempt;
      claim.workflowId = transition.workflowId;
      claim.selectionRevision = transition.selectionRevision;
      claim.reviewDeadlineAt = transition.reviewDeadlineAt;
    } else if (transition.kind === 'REVIEW_RESULT') {
      claim.status = 'REVIEWED';
      claim.lastStage = 'REVIEW_RESULT';
      claim.completionState = transition.completionState;
      claim.verdict = transition.verdict;
      if (transition.evidenceId) claim.evidenceId = transition.evidenceId;
      if (transition.reason) claim.reason = transition.reason;
    } else if (transition.kind === 'RECEIPT_POSTING') {
      claim.status = 'RECEIPT_POSTING';
      claim.lastStage = 'RECEIPT_POSTING';
    } else if (transition.kind === 'RECEIPT_DELIVERED') {
      claim.status = 'COMMITTED';
      claim.lastStage = 'RECEIPT_DELIVERED';
      claim.receiptId = transition.receiptId;
      claim.completionState = transition.completionState;
      claim.verdict = transition.verdict;
    } else if (transition.kind === 'UNKNOWN') {
      claim.status = 'UNKNOWN';
      claim.lastStage = transition.stage;
    }
    return {status: 'COMMITTED', oid: input.newOid};
  }

  async readClaim(executionKey) {
    const claim = this.claims.get(executionKey);
    return claim ? structuredClone(claim) : null;
  }
}

function makeBoundaryCompletion({reviewRequestId, sessionId, collected, nowMs, reviewer = REVIEWER, coverageParts = REQUIRED_REVIEW_PARTS}) {
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
      reviewRequestId,
      sessionId,
      reviewer: {...reviewer},
      coverageParts: [...coverageParts],
      verdict: 'GREEN_LIGHT',
      complete: true,
      truncated: false,
      turnLimit: false,
      summary: 'Synthetic complete review'
    },
    trustedRuntimeEvidence: {
      evidenceId: 'runtime-evidence-1',
      provider: 'runtime-gateway',
      observedAtMs: nowMs - 1000,
      expiresAtMs: nowMs + 60000,
      runtime: {
        reviewRequestId,
        sessionId,
        reviewer: {...reviewer},
        repository: collected.repository,
        pullRequest: collected.pullRequest,
        headSha: collected.headSha,
        baseSha: collected.baseSha,
        diffDigest: collected.diffDigest,
        terminalState: 'completed',
        stopReason: 'end_turn',
        truncated: false,
        turnLimit: false,
        coverageParts: [...coverageParts],
        changedPaths: ['scripts/autonomy/m11-review-lifecycle.mjs']
      }
    }
  };
}

function lifecycleInput({collected, store, clock, dispatchReview, observeReview, revalidate, receipt}) {
  return {
    enabled: true,
    collected,
    store,
    reviewerIdentity: REVIEWER,
    dispatchReview,
    observeReview,
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    revalidate,
    receipt,
    now: () => clock.value,
    expiresAt: END
  };
}

test('composition: async start->pending->restart->observe->boundary->receipt and fail-closed matrix', async () => {
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  assert.equal(collected.status, 'READY');

  const backend = new DurableLifecycleBackend();
  let store = createCoordinatorStateStore({backend, enabled: true});
  let dispatchCalls = 0;
  let observeCalls = 0;
  let receiptPosts = 0;
  let receiptLookups = 0;
  const observedQueue = [{status: 'PENDING'}];
  const receiptIds = [];
  const revalidate = async () => collectReady({nowMs: clock.value});
  const start = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => {
        dispatchCalls++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => ({status: 'PENDING'}),
      revalidate,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 30000
  });
  assert.equal(start.status, 'REVIEW_PENDING');
  assert.equal(dispatchCalls, 1);
  assert.equal(backend.claims.get(collected.executionKey).lastStage, 'REVIEW_PENDING');

  const serialized = JSON.stringify({executionKey: collected.executionKey});
  const reconstructed = JSON.parse(serialized);
  store = createCoordinatorStateStore({backend, enabled: true});
  clock.value += 15001;
  observedQueue.push(makeBoundaryCompletion({
    reviewRequestId: start.reviewRequestId,
    sessionId: start.sessionId,
    collected,
    nowMs: clock.value
  }));

  const pending = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return observedQueue.shift() || {status: 'PENDING'};
      },
      revalidate,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          const receiptId = 'receipt-1';
          receiptIds.push(receiptId);
          return {status: 'CREATED', receiptId};
        },
        lookupByActionKey: async () => {
          receiptLookups++;
          return {status: 'FOUND', complete: true, receiptIds: [...receiptIds]};
        }
      }
    }),
    executionKey: reconstructed.executionKey
  });
  assert.equal(pending.status, 'REVIEW_PENDING');

  const completed = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return observedQueue.shift() || {status: 'PENDING'};
      },
      revalidate,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          const receiptId = 'receipt-1';
          receiptIds.push(receiptId);
          return {status: 'CREATED', receiptId};
        },
        lookupByActionKey: async () => {
          receiptLookups++;
          return {status: 'FOUND', complete: true, receiptIds: ['receipt-1']};
        }
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(completed.status, 'COMPLETE');
  assert.equal(completed.completionState, 'COMPLETE');
  assert.equal(receiptPosts, 1);
  assert.equal(receiptLookups, 1);

  const duplicateObservation = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return {status: 'PENDING'};
      },
      revalidate,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'receipt-2'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-2']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(duplicateObservation.status, 'COMPLETE');
  assert.equal(receiptPosts, 1);

  const driftBackend = new DurableLifecycleBackend();
  const driftStore = createCoordinatorStateStore({backend: driftBackend, enabled: true});
  const driftCollected = await collectReady({nowMs: clock.value});
  const driftStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: driftCollected,
      store: driftStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => driftCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(driftStart.status, 'REVIEW_PENDING');
  const driftObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: driftCollected,
      store: driftStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collectReady({headSha: 'c'.repeat(40), baseSha: BASE, nowMs: clock.value}),
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    executionKey: driftCollected.executionKey
  });
  assert.equal(driftObserve.status, 'UNKNOWN');
  assert.equal(driftObserve.reason, 'STALE_OR_UNKNOWN_BEFORE_OBSERVE');

  const wrongSessionBackend = new DurableLifecycleBackend();
  const wrongSessionStore = createCoordinatorStateStore({backend: wrongSessionBackend, enabled: true});
  const wrongCollected = await collectReady({nowMs: clock.value});
  const wrongStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: wrongCollected,
      store: wrongSessionStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => wrongCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(wrongStart.status, 'REVIEW_PENDING');
  const wrongSession = makeBoundaryCompletion({
    reviewRequestId: wrongStart.reviewRequestId,
    sessionId: 'wrong-session',
    collected: wrongCollected,
    nowMs: clock.value
  });
  wrongSession.ci.runId = RUN_ID + 5;
  wrongSession.modelOutput.reviewer.model = 'different-model';
  const wrongObserved = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: wrongCollected,
      store: wrongSessionStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => wrongSession,
      revalidate: async () => wrongCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    executionKey: wrongCollected.executionKey
  });
  assert.equal(wrongObserved.status, 'UNKNOWN');
  assert.equal(wrongObserved.reason, 'OBSERVED_RUN_IDENTITY_MISMATCH');

  const coverageBackend = new DurableLifecycleBackend();
  const coverageStore = createCoordinatorStateStore({backend: coverageBackend, enabled: true});
  const coverageCollected = await collectReady({nowMs: clock.value});
  const coverageStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: coverageCollected,
      store: coverageStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => coverageCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(coverageStart.status, 'REVIEW_PENDING');
  const missingCoverage = makeBoundaryCompletion({
    reviewRequestId: coverageStart.reviewRequestId,
    sessionId: coverageStart.sessionId,
    collected: coverageCollected,
    nowMs: clock.value,
    coverageParts: REQUIRED_REVIEW_PARTS.slice(0, -1)
  });
  const missingCoverageResult = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: coverageCollected,
      store: coverageStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => missingCoverage,
      revalidate: async () => coverageCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    executionKey: coverageCollected.executionKey
  });
  assert.equal(missingCoverageResult.status, 'UNKNOWN');
  assert.equal(missingCoverageResult.reason, 'BOUNDARY_REJECTED');

  const dispatchBackend = new DurableLifecycleBackend();
  const dispatchStore = createCoordinatorStateStore({backend: dispatchBackend, enabled: true});
  const dispatchCollected = await collectReady({nowMs: clock.value});
  let dispatchAttempts = 0;
  const lostDispatch = await startReviewLifecycle({
    ...lifecycleInput({
      collected: dispatchCollected,
      store: dispatchStore,
      clock,
      dispatchReview: async () => {
        dispatchAttempts++;
        throw new Error('ack lost');
      },
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => dispatchCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(lostDispatch.status, 'UNKNOWN');
  assert.equal(lostDispatch.reason, 'DISPATCH_ACK_UNKNOWN');
  const noRedispatch = await startReviewLifecycle({
    ...lifecycleInput({
      collected: dispatchCollected,
      store: dispatchStore,
      clock,
      dispatchReview: async () => {
        dispatchAttempts++;
        return {status: 'ACKNOWLEDGED'};
      },
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => dispatchCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(noRedispatch.status, 'WAITING');
  assert.equal(noRedispatch.reason, 'ALREADY_CLAIMED');
  assert.equal(dispatchAttempts, 1);

  const persistBackend = new DurableLifecycleBackend({failTransitionKinds: ['REVIEW_PENDING']});
  const persistStore = createCoordinatorStateStore({backend: persistBackend, enabled: true});
  const persistCollected = await collectReady({nowMs: clock.value});
  const lostPersist = await startReviewLifecycle({
    ...lifecycleInput({
      collected: persistCollected,
      store: persistStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => persistCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(lostPersist.status, 'UNKNOWN');
  assert.equal(lostPersist.reason, 'PENDING_STATE_COMMIT_UNKNOWN');

  const deadlineBackend = new DurableLifecycleBackend();
  const deadlineStore = createCoordinatorStateStore({backend: deadlineBackend, enabled: true});
  const deadlineCollected = await collectReady({nowMs: START + 200});
  clock.value = START + 200;
  const deadlineStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: deadlineCollected,
      store: deadlineStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => deadlineCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    reviewDeadlineMs: 5000
  });
  assert.equal(deadlineStart.status, 'REVIEW_PENDING');
  clock.value = START + 6200;
  const late = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: deadlineCollected,
      store: deadlineStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: deadlineStart.reviewRequestId,
        sessionId: deadlineStart.sessionId,
        collected: deadlineCollected,
        nowMs: clock.value
      }),
      revalidate: async () => deadlineCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    executionKey: deadlineCollected.executionKey
  });
  assert.equal(late.status, 'INCOMPLETE');
  assert.equal(late.reason, 'REVIEW_DEADLINE_EXPIRED');

  const unknownReceiptBackend = new DurableLifecycleBackend();
  const unknownReceiptStore = createCoordinatorStateStore({backend: unknownReceiptBackend, enabled: true});
  const unknownReceiptCollected = await collectReady({nowMs: clock.value});
  const unknownReceiptStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: unknownReceiptCollected,
      store: unknownReceiptStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => unknownReceiptCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(unknownReceiptStart.status, 'REVIEW_PENDING');
  let unknownReceiptPosts = 0;
  const unknownReceipt = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: unknownReceiptCollected,
      store: unknownReceiptStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: unknownReceiptStart.reviewRequestId,
        sessionId: unknownReceiptStart.sessionId,
        collected: unknownReceiptCollected,
        nowMs: clock.value
      }),
      revalidate: async () => unknownReceiptCollected,
      receipt: {
        postOnce: async () => {
          unknownReceiptPosts++;
          throw new Error('delivery unknown');
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    executionKey: unknownReceiptCollected.executionKey
  });
  assert.equal(unknownReceipt.status, 'UNKNOWN');
  assert.equal(unknownReceipt.reason, 'RECEIPT_DELIVERY_UNKNOWN');
  const duplicateUnknownObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: unknownReceiptCollected,
      store: unknownReceiptStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: unknownReceiptStart.reviewRequestId,
        sessionId: unknownReceiptStart.sessionId,
        collected: unknownReceiptCollected,
        nowMs: clock.value
      }),
      revalidate: async () => unknownReceiptCollected,
      receipt: {
        postOnce: async () => {
          unknownReceiptPosts++;
          return {status: 'CREATED', receiptId: 'retry'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['retry']})
      }
    }),
    executionKey: unknownReceiptCollected.executionKey
  });
  assert.equal(duplicateUnknownObserve.status, 'UNKNOWN');
  assert.equal(duplicateUnknownObserve.reason, 'TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
  assert.equal(unknownReceiptPosts, 1);
});
