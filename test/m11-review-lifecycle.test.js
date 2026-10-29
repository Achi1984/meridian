import test from 'node:test';
import assert from 'node:assert/strict';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';
import {createAdmissionRecordState, reduceAdmissionRecord} from '../scripts/autonomy/m11-admission-record.mjs';
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

function runData({headSha = HEAD, baseSha = BASE, runId = RUN_ID, runAttempt = RUN_ATTEMPT, runNumber = SELECTION_REVISION} = {}) {
  return {
    id: runId,
    repository: REPOSITORY,
    workflowId: WORKFLOW_ID,
    workflowPath: '.github/workflows/backend-safety.yml',
    runAttempt,
    runNumber,
    status: 'completed',
    conclusion: 'success',
    headSha,
    baseSha,
    pullRequests: [PR],
    actor: 'Achi1984',
    triggeringActor: 'Achi1984'
  };
}

function fixtureApi({headSha = HEAD, baseSha = BASE, runId = RUN_ID, runAttempt = RUN_ATTEMPT, runNumber = SELECTION_REVISION} = {}) {
  const run = runData({headSha, baseSha, runId, runAttempt, runNumber});
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
          runId: run.id,
          runAttempt: run.runAttempt,
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

async function collectReady({
  headSha = HEAD,
  baseSha = BASE,
  nowMs = START + 100,
  runId = RUN_ID,
  runAttempt = RUN_ATTEMPT,
  runNumber = SELECTION_REVISION
} = {}) {
  return collectExactPair({
    hint: {
      eventName: 'workflow_run',
      repository: REPOSITORY,
      workflowRunId: runId,
      workflowRunAttempt: runAttempt
    },
    config: collectConfig(),
    api: fixtureApi({headSha, baseSha, runId, runAttempt, runNumber}),
    now: () => nowMs
  });
}

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

class DurableLifecycleBackend {
  constructor({failTransitionKinds = [], quota = 3} = {}) {
    this.capabilities = {
      immutableCommits: true,
      validatedRevisionChain: true,
      atomicCreateOnlyClaims: true,
      atomicSingleWriterClaim: true,
      atomicPacketQuota: true,
      atomicExpectedOidCAS: true
    };
    this.snapshot = {revision: 0, oid: 'root', chainValid: true};
    this.admissionState = createAdmissionRecordState({enabled: true, totalQuota: quota});
    this.claims = new Map();
    this.commits = new Map();
    this.nextCommit = 0;
    this.failTransitionKinds = new Set(failTransitionKinds);
    this.failedKinds = new Set();
  }

  claimByIdentity(actionKey, executionKey) {
    return this.claims.get(executionKey) || [...this.claims.values()]
      .find(claim => claim.actionKey === actionKey && claim.executionKey === executionKey) || null;
  }

  admissionEventResult(event) {
    return reduceAdmissionRecord(this.admissionState, event);
  }

  applyUnknownAdmission(claim, stage) {
    const mappedStage = UNKNOWN_STAGE_MAP[stage] || 'CHECKPOINT';
    const result = this.admissionEventResult({
      kind: 'MARK_UNKNOWN',
      logicalActionId: claim.actionKey,
      executionKey: claim.executionKey,
      stage: mappedStage
    });
    if (result.changed === true) this.admissionState = result.state;
  }

  async readSnapshot() {
    return structuredClone(this.snapshot);
  }

  async createOnlyClaim(input) {
    if (input.maxActiveClaims !== 1 || input.maxPackets !== 3) return {status: 'INVALID_LIMIT'};
    if (input.expectedRevision !== this.snapshot.revision || input.expectedOid !== this.snapshot.oid) {
      return {status: 'STALE_EXPECTATION'};
    }
    if (this.claims.has(input.executionKey)) return {status: 'EXISTS'};
    const admission = this.admissionEventResult({
      kind: 'SIMULATE_ADMISSION',
      expectedRevision: this.admissionState.revision,
      expectedTotalQuota: this.admissionState.totalQuota,
      logicalActionId: input.actionKey,
      executionKey: input.executionKey
    });
    if (admission.status === 'BLOCKED') {
      if (admission.reason === 'QUOTA_EXHAUSTED') return {status: 'BUDGET_EXHAUSTED'};
      if (admission.reason === 'DUPLICATE_EXECUTION_KEY') return {status: 'EXISTS'};
      if (admission.reason === 'ACTIVE_GATE_HELD') return {status: 'BUSY'};
      return {status: 'UNKNOWN'};
    }
    this.admissionState = admission.state;
    const claimId = `claim-${this.claims.size + 1}`;
    this.claims.set(input.executionKey, {
      status: 'CLAIMED',
      lastStage: 'CLAIMED',
      claimId,
      actionKey: input.actionKey,
      executionKey: input.executionKey,
      owner: input.owner,
      expectedRevision: input.expectedRevision,
      expectedOid: input.expectedOid,
      admissionRevision: this.admissionState.activeGate?.admissionRevision
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
    const claim = this.claimByIdentity(input.actionKey, input.executionKey);
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
      claim.changedPathDigest = transition.changedPathDigest;
      claim.changedPathCount = transition.changedPathCount;
      claim.runId = transition.runId;
      claim.runAttempt = transition.runAttempt;
      claim.workflowId = transition.workflowId;
      claim.selectionRevision = transition.selectionRevision;
      claim.reviewDeadlineAt = transition.reviewDeadlineAt;
    } else if (transition.kind === 'REVIEW_RESULT') {
      const observed = this.admissionEventResult({
        kind: 'EFFECT_OBSERVED',
        logicalActionId: claim.actionKey,
        executionKey: claim.executionKey,
        admissionRevision: claim.admissionRevision
      });
      if (observed.changed === true) this.admissionState = observed.state;
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
      const observed = this.admissionEventResult({
        kind: 'EFFECT_OBSERVED',
        logicalActionId: claim.actionKey,
        executionKey: claim.executionKey,
        admissionRevision: claim.admissionRevision
      });
      if (observed.changed === true) this.admissionState = observed.state;
      const completed = this.admissionEventResult({
        kind: 'TERMINAL_COMPLETION',
        evidence: {
          logicalActionId: claim.actionKey,
          executionKey: claim.executionKey,
          admissionRevision: claim.admissionRevision,
          effect: 'COMPLETED',
          checkpointAcknowledged: true
        }
      });
      if (completed.changed === true) this.admissionState = completed.state;
      claim.status = 'COMMITTED';
      claim.lastStage = 'RECEIPT_DELIVERED';
      claim.receiptId = transition.receiptId;
      claim.completionState = transition.completionState;
      claim.verdict = transition.verdict;
    } else if (transition.kind === 'UNKNOWN') {
      this.applyUnknownAdmission(claim, transition.stage);
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

test('reducer-backed store composition enforces quota=3, single-active gate, duplicate/restart, and stale revision conflict', async () => {
  const backend = new DurableLifecycleBackend({quota: 3});
  const store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const receipt = {
    postOnce: async () => ({status: 'CREATED', receiptId: 'receipt-q'}),
    lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-q']})
  };

  const firstCollected = await collectReady({nowMs: clock.value, runId: RUN_ID, runAttempt: 1, runNumber: 20});
  const first = await startReviewLifecycle({
    ...lifecycleInput({
      collected: firstCollected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => firstCollected,
      receipt
    })
  });
  assert.equal(first.status, 'REVIEW_PENDING');

  const secondAttemptWhileGateHeld = await startReviewLifecycle({
    ...lifecycleInput({
      collected: await collectReady({nowMs: clock.value, runId: RUN_ID + 1, runAttempt: 2, runNumber: 21}),
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collectReady({nowMs: clock.value, runId: RUN_ID + 1, runAttempt: 2, runNumber: 21}),
      receipt
    })
  });
  assert.equal(secondAttemptWhileGateHeld.reason, 'CLAIM_OUTCOME_UNKNOWN');
  assert.equal(backend.admissionState.activeGate.executionKey, firstCollected.executionKey);

  const completeObserved = makeBoundaryCompletion({
    reviewRequestId: first.reviewRequestId,
    sessionId: first.sessionId,
    collected: firstCollected,
    nowMs: clock.value
  });
  const completeFirst = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: firstCollected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => completeObserved,
      revalidate: async () => firstCollected,
      receipt
    }),
    executionKey: firstCollected.executionKey
  });
  assert.equal(completeFirst.status, 'COMPLETE');

  const secondCollected = await collectReady({
    nowMs: clock.value,
    runId: RUN_ID + 2,
    runAttempt: 2,
    runNumber: 21,
    headSha: 'c'.repeat(40),
    baseSha: 'd'.repeat(40)
  });
  const second = await startReviewLifecycle({
    ...lifecycleInput({
      collected: secondCollected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => secondCollected,
      receipt
    })
  });
  assert.equal(second.status, 'REVIEW_PENDING');
  const completeSecond = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: secondCollected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: second.reviewRequestId,
        sessionId: second.sessionId,
        collected: secondCollected,
        nowMs: clock.value
      }),
      revalidate: async () => secondCollected,
      receipt
    }),
    executionKey: secondCollected.executionKey
  });
  assert.equal(completeSecond.status, 'COMPLETE');

  const thirdCollected = await collectReady({
    nowMs: clock.value,
    runId: RUN_ID + 3,
    runAttempt: 3,
    runNumber: 22,
    headSha: 'e'.repeat(40),
    baseSha: 'f'.repeat(40)
  });
  const third = await startReviewLifecycle({
    ...lifecycleInput({
      collected: thirdCollected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => thirdCollected,
      receipt
    })
  });
  assert.equal(third.status, 'REVIEW_PENDING');
  const completeThird = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: thirdCollected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: third.reviewRequestId,
        sessionId: third.sessionId,
        collected: thirdCollected,
        nowMs: clock.value
      }),
      revalidate: async () => thirdCollected,
      receipt
    }),
    executionKey: thirdCollected.executionKey
  });
  assert.equal(completeThird.status, 'COMPLETE');

  const quotaExceededCollected = await collectReady({
    nowMs: clock.value,
    runId: RUN_ID + 4,
    runAttempt: 4,
    runNumber: 23,
    headSha: '1'.repeat(40),
    baseSha: '2'.repeat(40)
  });
  const quotaExceeded = await startReviewLifecycle({
    ...lifecycleInput({
      collected: quotaExceededCollected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => quotaExceededCollected,
      receipt
    })
  });
  assert.equal(quotaExceeded.reason, 'BUDGET_EXHAUSTED');

  const duplicateRestart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: firstCollected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => firstCollected,
      receipt
    })
  });
  assert.equal(duplicateRestart.reason, 'ALREADY_CLAIMED');

  const staleClaim = backend.claims.get(thirdCollected.executionKey);
  const staleCommit = await store.commit({
    claim: {...staleClaim, expectedRevision: staleClaim.expectedRevision - 1},
    transition: {kind: 'UNKNOWN', stage: 'RECEIPT_DELIVERY_UNKNOWN'}
  });
  assert.equal(staleCommit.status, 'CONFLICT_RECONCILE');
});

test('composition: async start->pending->restart->observe->boundary->receipt and fail-closed matrix', async () => {
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  assert.equal(collected.status, 'READY');

  const missingRevalidateStart = await startReviewLifecycle({
    enabled: true,
    collected,
    store: createCoordinatorStateStore({backend: new DurableLifecycleBackend(), enabled: true}),
    reviewerIdentity: REVIEWER,
    dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(missingRevalidateStart.reason, 'START_ADAPTER_UNAVAILABLE');

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

  const missingRevalidateObserve = await observeReviewLifecycle({
    enabled: true,
    executionKey: collected.executionKey,
    collected,
    store,
    observeReview: async () => ({status: 'PENDING'}),
    trustedRuntimeSeam: {verifyRuntimeEvidence: value => value},
    receipt: {
      postOnce: async () => ({status: 'CREATED', receiptId: 'nope'}),
      lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
    },
    now: () => clock.value,
    expiresAt: END
  });
  assert.equal(missingRevalidateObserve.reason, 'OBSERVE_ADAPTER_UNAVAILABLE');

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

  const witnessBackend = new DurableLifecycleBackend();
  const witnessStore = createCoordinatorStateStore({backend: witnessBackend, enabled: true});
  const witnessCollected = await collectReady({nowMs: clock.value});
  const witnessStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: witnessCollected,
      store: witnessStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => witnessCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    })
  });
  assert.equal(witnessStart.status, 'REVIEW_PENDING');
  const missingWitness = makeBoundaryCompletion({
    reviewRequestId: witnessStart.reviewRequestId,
    sessionId: witnessStart.sessionId,
    collected: witnessCollected,
    nowMs: clock.value
  });
  missingWitness.trustedRuntimeEvidence.runtime.changedPaths = [];
  const missingWitnessResult = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: witnessCollected,
      store: witnessStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => missingWitness,
      revalidate: async () => witnessCollected,
      receipt: {postOnce: async () => ({status: 'CREATED', receiptId: 'x'}), lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['x']})}
    }),
    executionKey: witnessCollected.executionKey
  });
  assert.equal(missingWitnessResult.status, 'UNKNOWN');
  assert.equal(missingWitnessResult.reason, 'BOUNDARY_REJECTED');

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
  assert.equal(duplicateUnknownObserve.reason, 'RECEIPT_FOUND_RECONCILE_REQUIRED');
  assert.equal(unknownReceiptPosts, 1);
});
