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

function fixtureApi({
  headSha = HEAD,
  baseSha = BASE,
  runId = RUN_ID,
  runAttempt = RUN_ATTEMPT,
  runNumber = SELECTION_REVISION,
  authEvidenceId = 'fixture-auth-1',
  authVerifiedAtMs = START,
  authExpiresAtMs = START + 600000
} = {}) {
  const run = runData({headSha, baseSha, runId, runAttempt, runNumber});
  return {
    authenticated: true,
    authenticationEvidence: Object.freeze({
      evidenceId: authEvidenceId,
      principal: 'synthetic-principal',
      host: 'api.github.com',
      scheme: 'https',
      tls: true,
      verifiedAtMs: authVerifiedAtMs,
      expiresAtMs: authExpiresAtMs
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
  runNumber = SELECTION_REVISION,
  authEvidenceId = 'fixture-auth-1',
  authVerifiedAtMs = START,
  authExpiresAtMs = START + 600000
} = {}) {
  return collectExactPair({
    hint: {
      eventName: 'workflow_run',
      repository: REPOSITORY,
      workflowRunId: runId,
      workflowRunAttempt: runAttempt
    },
    config: collectConfig(),
    api: fixtureApi({
      headSha,
      baseSha,
      runId,
      runAttempt,
      runNumber,
      authEvidenceId,
      authVerifiedAtMs,
      authExpiresAtMs
    }),
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
    this.transitionCounts = new Map();
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
    if (result.changed !== true || result.status !== 'UNKNOWN') return null;
    this.admissionState = result.state;
    return result.state;
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
    const transition = commit.transition;
    let nextAdmissionState = this.admissionState;
    if (transition.kind === 'REVIEW_PENDING') {
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
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
    } else if (transition.kind === 'DISPATCH_ACKED') {
      if (transition.reviewRequestId !== claim.reviewRequestId
        || transition.sessionId !== claim.sessionId) return {status: 'CONFLICT'};
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      claim.status = 'REVIEW_PENDING';
      claim.lastStage = 'DISPATCH_ACKED';
    } else if (transition.kind === 'REVIEW_RESULT') {
      const observed = reduceAdmissionRecord(this.admissionState, {
        kind: 'EFFECT_OBSERVED',
        logicalActionId: claim.actionKey,
        executionKey: claim.executionKey,
        admissionRevision: claim.admissionRevision
      });
      if (observed.status !== 'RECORDED' || observed.changed !== true) return {status: 'CONFLICT'};
      nextAdmissionState = observed.state;
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      this.admissionState = nextAdmissionState;
      claim.status = 'REVIEWED';
      claim.lastStage = 'REVIEW_RESULT';
      claim.completionState = transition.completionState;
      claim.verdict = transition.verdict;
      if (transition.evidenceId) claim.evidenceId = transition.evidenceId;
      if (transition.reason) claim.reason = transition.reason;
    } else if (transition.kind === 'OBSERVE_PREPARING') {
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      claim.lastStage = 'OBSERVE_PREPARING';
    } else if (transition.kind === 'OBSERVE_PENDING') {
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      claim.lastStage = 'OBSERVE_PENDING';
    } else if (transition.kind === 'RECEIPT_PREPARING') {
      if (transition.completionState !== claim.completionState || transition.verdict !== claim.verdict) {
        return {status: 'CONFLICT'};
      }
      if (claim.lastStage === 'RECEIPT_PREPARING') {
        return {status: 'CONFLICT'};
      }
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      claim.lastStage = 'RECEIPT_PREPARING';
    } else if (transition.kind === 'RECEIPT_POSTING') {
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      claim.status = 'RECEIPT_POSTING';
      claim.lastStage = 'RECEIPT_POSTING';
    } else if (transition.kind === 'RECEIPT_DELIVERED') {
      const completed = reduceAdmissionRecord(this.admissionState, {
        kind: 'TERMINAL_COMPLETION',
        evidence: {
          logicalActionId: claim.actionKey,
          executionKey: claim.executionKey,
          admissionRevision: claim.admissionRevision,
          effect: 'COMPLETED',
          checkpointAcknowledged: true
        }
      });
      if (completed.status !== 'RECORDED' || completed.changed !== true) return {status: 'CONFLICT'};
      nextAdmissionState = completed.state;
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      this.admissionState = nextAdmissionState;
      claim.status = 'COMMITTED';
      claim.lastStage = 'RECEIPT_DELIVERED';
      claim.receiptId = transition.receiptId;
      claim.completionState = transition.completionState;
      claim.verdict = transition.verdict;
    } else if (transition.kind === 'UNKNOWN') {
      const unknownState = this.applyUnknownAdmission(claim, transition.stage);
      if (!unknownState) return {status: 'CONFLICT'};
      nextAdmissionState = unknownState;
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
      this.admissionState = nextAdmissionState;
      claim.status = 'UNKNOWN';
      claim.lastStage = transition.stage;
    } else {
      current.oid = input.newOid;
      current.revision = input.newRevision;
      claim.expectedOid = input.newOid;
      claim.expectedRevision = input.newRevision;
    }
    this.transitionCounts.set(transition.kind, (this.transitionCounts.get(transition.kind) || 0) + 1);
    return {status: 'COMMITTED', oid: input.newOid};
  }

  async readClaim(executionKey) {
    const claim = this.claims.get(executionKey);
    return claim ? structuredClone(claim) : null;
  }

  committedTransitionCount(kind) {
    return this.transitionCounts.get(kind) || 0;
  }

  toSerializableRecords() {
    return Object.freeze({
      snapshot: structuredClone(this.snapshot),
      admissionState: structuredClone(this.admissionState),
      claims: [...this.claims.entries()].map(([key, value]) => [key, structuredClone(value)]),
      commits: [...this.commits.entries()].map(([key, value]) => [key, structuredClone(value)]),
      nextCommit: this.nextCommit,
      failedKinds: [...this.failedKinds],
      failTransitionKinds: [...this.failTransitionKinds],
      transitionCounts: [...this.transitionCounts.entries()]
    });
  }

  static fromSerializableRecords(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      throw new Error('INVALID_RECORDS');
    }
    const keys = ['snapshot', 'admissionState', 'claims', 'commits', 'nextCommit', 'failedKinds', 'failTransitionKinds', 'transitionCounts'];
    if (Object.keys(records).length !== keys.length || keys.some(key => !Object.hasOwn(records, key))) {
      throw new Error('INVALID_RECORDS');
    }
    const snapshot = records.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || typeof snapshot.oid !== 'string' || typeof snapshot.chainValid !== 'boolean') {
      throw new Error('INVALID_RECORDS');
    }
    const claims = records.claims;
    const commits = records.commits;
    if (!Array.isArray(claims) || !Array.isArray(commits)
      || !Number.isSafeInteger(records.nextCommit) || records.nextCommit < 0
      || !Array.isArray(records.failedKinds)
      || !Array.isArray(records.failTransitionKinds)
      || !Array.isArray(records.transitionCounts)) {
      throw new Error('INVALID_RECORDS');
    }
    const backend = new DurableLifecycleBackend({
      failTransitionKinds: records.failTransitionKinds
    });
    backend.snapshot = structuredClone(snapshot);
    backend.admissionState = structuredClone(records.admissionState);
    backend.claims = new Map(claims.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !entry[1] || typeof entry[1] !== 'object' || Array.isArray(entry[1])) {
        throw new Error('INVALID_RECORDS');
      }
      return [entry[0], structuredClone(entry[1])];
    }));
    backend.commits = new Map(commits.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !entry[1] || typeof entry[1] !== 'object' || Array.isArray(entry[1])) {
        throw new Error('INVALID_RECORDS');
      }
      return [entry[0], structuredClone(entry[1])];
    }));
    backend.nextCommit = records.nextCommit;
    backend.failedKinds = new Set(records.failedKinds);
    backend.transitionCounts = new Map(records.transitionCounts.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !Number.isSafeInteger(entry[1]) || entry[1] < 0) {
        throw new Error('INVALID_RECORDS');
      }
      return [entry[0], entry[1]];
    }));

    const validation = reduceAdmissionRecord(backend.admissionState, {
      kind: 'SIMULATE_ADMISSION',
      expectedRevision: backend.admissionState.revision,
      expectedTotalQuota: backend.admissionState.totalQuota,
      logicalActionId: 'a'.repeat(64),
      executionKey: 'b'.repeat(64)
    });
    if (!validation || typeof validation.status !== 'string') throw new Error('INVALID_RECORDS');
    for (const [key, claim] of backend.claims.entries()) {
      if (!claim || claim.executionKey !== key || typeof claim.actionKey !== 'string' || claim.actionKey.length !== 64) {
        throw new Error('INVALID_RECORDS');
      }
    }
    return backend;
  }
}

function reconstructBackendFromJson(backend) {
  const serialized = JSON.stringify(backend.toSerializableRecords());
  const parsed = JSON.parse(serialized);
  return DurableLifecycleBackend.fromSerializableRecords(parsed);
}

function makeBoundaryCompletion({
  reviewRequestId,
  sessionId,
  collected,
  nowMs,
  reviewer = REVIEWER,
  coverageParts = REQUIRED_REVIEW_PARTS,
  verdict = 'GREEN_LIGHT'
}) {
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
      verdict,
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
  assert.equal(backend.claims.get(collected.executionKey).lastStage, 'DISPATCH_ACKED');

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
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);

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
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);

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

test('restart after STALE_BEFORE_DISPATCH remains UNKNOWN and never posts receipt', async () => {
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const backend = new DurableLifecycleBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  let validations = 0;
  const staleBeforeDispatch = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => {
        validations++;
        if (validations === 1) return collected;
        return collectReady({nowMs: clock.value, headSha: 'c'.repeat(40), baseSha: BASE});
      },
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'should-not-happen'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(staleBeforeDispatch.status, 'UNKNOWN');
  assert.equal(staleBeforeDispatch.reason, 'STALE_OR_UNKNOWN_BEFORE_DISPATCH');
  const retained = await store.reconcile(collected.executionKey);
  assert.equal(retained.status, 'READY');
  assert.equal(retained.claim.status, 'UNKNOWN');
  assert.equal(retained.claim.lastStage, 'STALE_BEFORE_DISPATCH');

  const restartedStore = createCoordinatorStateStore({backend, enabled: true});
  let receiptPosts = 0;
  const observeAfterRestart = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store: restartedStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: retained.claim.reviewRequestId,
        sessionId: retained.claim.sessionId,
        collected,
        nowMs: clock.value
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'retry'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['retry']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(observeAfterRestart.status, 'UNKNOWN');
  assert.equal(observeAfterRestart.reason, 'TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
  assert.equal(receiptPosts, 0);
});

test('fresh collection with rotated auth after old auth expiry works after restart without old brand revival', async () => {
  let backend = new DurableLifecycleBackend();
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const initialCollected = await collectReady({
    nowMs: clock.value,
    authEvidenceId: 'fixture-auth-old',
    authVerifiedAtMs: START,
    authExpiresAtMs: START + 1000
  });
  assert.equal(initialCollected.status, 'READY');
  let dispatchCount = 0;
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected: initialCollected,
      store,
      clock,
      dispatchReview: async input => {
        dispatchCount++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => initialCollected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 600000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const serialized = JSON.stringify(backend.toSerializableRecords());
  backend = DurableLifecycleBackend.fromSerializableRecords(JSON.parse(serialized));
  store = createCoordinatorStateStore({backend, enabled: true});
  const reconstructed = {executionKey: initialCollected.executionKey};
  clock.value = START + 400000;

  const oldBrandObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: initialCollected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => initialCollected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'bad'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    executionKey: reconstructed.executionKey
  });
  assert.equal(oldBrandObserve.status, 'WAITING');
  assert.equal(oldBrandObserve.reason, 'FRESH_COLLECTION_REQUIRED');

  const freshCollected = await collectReady({
    nowMs: clock.value,
    authEvidenceId: 'fixture-auth-new',
    authVerifiedAtMs: clock.value - 1000,
    authExpiresAtMs: clock.value + 600000
  });
  assert.equal(freshCollected.status, 'READY');
  assert.notEqual(freshCollected.provenance.authenticationEvidence.evidenceId, initialCollected.provenance.authenticationEvidence.evidenceId);

  let receiptCount = 0;
  const completed = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: freshCollected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected: freshCollected,
        nowMs: clock.value
      }),
      revalidate: async () => freshCollected,
      receipt: {
        postOnce: async () => {
          receiptCount++;
          return {status: 'CREATED', receiptId: 'receipt-rotated'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-rotated']})
      }
    }),
    executionKey: reconstructed.executionKey
  });
  assert.equal(completed.status, 'COMPLETE');
  assert.equal(dispatchCount, 1);
  assert.equal(receiptCount, 1);
  assert.equal(backend.admissionState.consumedQuota, 1);
  assert.equal(backend.admissionState.claims.length, 1);
  assert.equal(backend.admissionState.activeGate, null);
  assert.equal(backend.admissionState.claims[0].status, 'COMPLETED_ACKED');

  const malformed = JSON.parse(serialized);
  malformed.snapshot.revision = -1;
  assert.throws(
    () => DurableLifecycleBackend.fromSerializableRecords(malformed),
    /INVALID_RECORDS/
  );
});

test('receipt posted then final commit failure restarts into readback-only path without repost', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_DELIVERED']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  let postCount = 0;
  const firstObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected,
        nowMs: clock.value
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          postCount++;
          return {status: 'CREATED', receiptId: 'receipt-crash'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-crash']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(firstObserve.status, 'UNKNOWN');
  assert.equal(firstObserve.reason, 'RECEIPT_STATE_COMMIT_UNKNOWN');
  assert.equal(postCount, 1);

  const persisted = await store.reconcile(collected.executionKey);
  assert.equal(persisted.status, 'READY');
  assert.equal(persisted.claim.lastStage, 'RECEIPT_POSTING');

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          postCount++;
          return {status: 'CREATED', receiptId: 'receipt-retry'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-crash']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'RECEIPT_FOUND_RECONCILE_REQUIRED');
  assert.equal(postCount, 1);
  assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
});

test('durable COMPLETE review result resumes receipt after restart without re-observe even after deadline when receipt preparation never began', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_PREPARING']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 2000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  let receiptPosts = 0;
  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected,
        nowMs: clock.value
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'should-not-post-yet'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['should-not-post-yet']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'RECEIPT_PREPARING_STATE_UNKNOWN');
  assert.equal(receiptPosts, 0);

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  clock.value = started.reviewDeadlineAt + 5000;

  let observeCalls = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'receipt-complete-resume'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-complete-resume']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'COMPLETE');
  assert.equal(restarted.completionState, 'COMPLETE');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 1);
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);
});

test('durable REVISION_REQUIRED review result resumes receipt after restart without re-observe even after deadline when receipt preparation never began', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_PREPARING']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 2000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  let receiptPosts = 0;
  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected,
        nowMs: clock.value,
        coverageParts: REQUIRED_REVIEW_PARTS,
        verdict: 'REVISION_REQUIRED'
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'should-not-post-yet'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['should-not-post-yet']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'RECEIPT_PREPARING_STATE_UNKNOWN');
  assert.equal(receiptPosts, 0);

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  clock.value = started.reviewDeadlineAt + 5000;

  let observeCalls = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'receipt-revision-resume'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-revision-resume']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'COMPLETE');
  assert.equal(restarted.completionState, 'REVISION_REQUIRED');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 1);
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);
});

test('restart with unresolved dispatch acknowledgement uncertainty cannot advance completion', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});

  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => {
        throw new Error('network');
      },
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(started.status, 'UNKNOWN');
  assert.equal(started.reason, 'DISPATCH_ACK_UNKNOWN');

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});

  let observeCalls = 0;
  let receiptPosts = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return makeBoundaryCompletion({
          reviewRequestId: 'unexpected',
          sessionId: 'unexpected',
          collected,
          nowMs: clock.value
        });
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'DISPATCH_ACK_DURABILITY_MISSING');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 0);
});

test('failed REVIEW_RESULT commits at deadline/late paths return UNKNOWN and do not misreport persisted incomplete', async () => {
  const clock = {value: START + 100};

  const deadlineBackend = new DurableLifecycleBackend({failTransitionKinds: ['REVIEW_RESULT']});
  const deadlineStore = createCoordinatorStateStore({backend: deadlineBackend, enabled: true});
  const deadlineCollected = await collectReady({nowMs: clock.value});
  const deadlineStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: deadlineCollected,
      store: deadlineStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => deadlineCollected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 1000
  });
  assert.equal(deadlineStart.status, 'REVIEW_PENDING');
  clock.value = deadlineStart.reviewDeadlineAt + 1;
  let deadlineObserveCalls = 0;
  let deadlineReceiptPosts = 0;
  const deadlineObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: deadlineCollected,
      store: deadlineStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        deadlineObserveCalls++;
        return {status: 'PENDING'};
      },
      revalidate: async () => deadlineCollected,
      receipt: {
        postOnce: async () => {
          deadlineReceiptPosts++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: deadlineCollected.executionKey
  });
  assert.equal(deadlineObserve.status, 'UNKNOWN');
  assert.equal(deadlineObserve.reason, 'REVIEW_RESULT_COMMIT_UNKNOWN');
  assert.equal(deadlineObserveCalls, 0);
  assert.equal(deadlineReceiptPosts, 0);

  const lateBackend = new DurableLifecycleBackend({failTransitionKinds: ['REVIEW_RESULT']});
  const lateStore = createCoordinatorStateStore({backend: lateBackend, enabled: true});
  const lateCollected = await collectReady({nowMs: clock.value});
  const lateStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected: lateCollected,
      store: lateStore,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => lateCollected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 10000
  });
  assert.equal(lateStart.status, 'REVIEW_PENDING');
  let lateReceiptPosts = 0;
  const lateObserve = await observeReviewLifecycle({
    ...lifecycleInput({
      collected: lateCollected,
      store: lateStore,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: lateStart.reviewRequestId,
        sessionId: lateStart.sessionId,
        collected: lateCollected,
        nowMs: lateStart.reviewDeadlineAt + 1
      }),
      revalidate: async () => lateCollected,
      receipt: {
        postOnce: async () => {
          lateReceiptPosts++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: lateCollected.executionKey
  });
  assert.equal(lateObserve.status, 'UNKNOWN');
  assert.equal(lateObserve.reason, 'REVIEW_RESULT_COMMIT_UNKNOWN');
  assert.equal(lateReceiptPosts, 0);
});

test('failed DISPATCH_ACKED persistence prevents later promotion after reconstruction', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['DISPATCH_ACKED']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(started.status, 'UNKNOWN');
  assert.equal(started.reason, 'DISPATCH_ACK_COMMIT_UNKNOWN');

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  let observeCalls = 0;
  let receiptPosts = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return makeBoundaryCompletion({
          reviewRequestId: 'unexpected',
          sessionId: 'unexpected',
          collected,
          nowMs: clock.value
        });
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'DISPATCH_ACK_DURABILITY_MISSING');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 0);
});

test('sequence A injection: observe unknown plus failed UNKNOWN persistence leaves OBSERVE_PREPARING fence nonadvancing after JSON reconstruction', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const counters = {dispatch: 0, observe: 0, post: 0};
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => {
        counters.dispatch++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => {
        counters.observe++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unused'};
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        counters.observe++;
        throw new Error('observe unavailable');
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unused'};
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'OBSERVE_OUTCOME_UNKNOWN');
  const retained = await store.reconcile(collected.executionKey);
  assert.equal(retained.status, 'READY');
  assert.equal(retained.claim.lastStage, 'OBSERVE_PREPARING');
  const retainedClaimBeforeRestart = structuredClone(retained.claim);
  assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(backend.admissionState.consumedQuota, 1);
  assert.equal(backend.admissionState.claims.length, 1);

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  const duplicateStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => {
        counters.dispatch++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => {
        counters.observe++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unused'};
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(duplicateStart.status, 'WAITING');
  assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
  const countersAfterDuplicateStart = {...counters};
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        counters.observe++;
        return makeBoundaryCompletion({
          reviewRequestId: started.reviewRequestId,
          sessionId: started.sessionId,
          collected,
          nowMs: clock.value
        });
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
  assert.deepEqual(counters, countersAfterDuplicateStart);
  assert.equal(counters.dispatch, 1);
  assert.equal(counters.observe, 1);
  assert.equal(counters.post, 0);
  assert.equal(backend.admissionState.consumedQuota, 1);
  assert.equal(backend.admissionState.claims.length, 1);
  assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
  const retainedAfterRestart = await store.reconcile(collected.executionKey);
  assert.equal(retainedAfterRestart.status, 'READY');
  assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
  assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
  assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
  assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
  assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
});

test('sequence B injection: stale-before-receipt plus failed UNKNOWN persistence leaves RECEIPT_PREPARING fence nonadvancing after JSON reconstruction', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const counters = {dispatch: 0, observe: 0, post: 0};
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => {
        counters.dispatch++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => {
        counters.observe++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unused'};
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  let revalidateCalls = 0;
  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        counters.observe++;
        return makeBoundaryCompletion({
          reviewRequestId: started.reviewRequestId,
          sessionId: started.sessionId,
          collected,
          nowMs: clock.value
        });
      },
      revalidate: async () => {
        revalidateCalls++;
        if (revalidateCalls === 1) return collected;
        return {...collected, headSha: 'f'.repeat(40)};
      },
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'STALE_OR_UNKNOWN_BEFORE_RECEIPT');
  const retained = await store.reconcile(collected.executionKey);
  assert.equal(retained.status, 'READY');
  assert.equal(retained.claim.lastStage, 'RECEIPT_PREPARING');
  const retainedClaimBeforeRestart = structuredClone(retained.claim);
  assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(backend.admissionState.consumedQuota, 1);
  assert.equal(backend.admissionState.claims.length, 1);

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  const duplicateStart = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => {
        counters.dispatch++;
        return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
      },
      observeReview: async () => {
        counters.observe++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unused'};
        },
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    })
  });
  assert.equal(duplicateStart.status, 'WAITING');
  assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
  const countersAfterDuplicateStart = {...counters};
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        counters.observe++;
        return makeBoundaryCompletion({
          reviewRequestId: started.reviewRequestId,
          sessionId: started.sessionId,
          collected,
          nowMs: clock.value
        });
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          counters.post++;
          return {status: 'CREATED', receiptId: 'unexpected'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'UNKNOWN');
  assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
  assert.deepEqual(counters, countersAfterDuplicateStart);
  assert.equal(counters.dispatch, 1);
  assert.equal(counters.observe, 1);
  assert.equal(counters.post, 0);
  assert.equal(backend.admissionState.consumedQuota, 1);
  assert.equal(backend.admissionState.claims.length, 1);
  assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
  const retainedAfterRestart = await store.reconcile(collected.executionKey);
  assert.equal(retainedAfterRestart.status, 'READY');
  assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
  assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
  assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
  assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
  assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
});

test('durable COMPLETE review result resumes receipt before deadline when receipt preparation never began', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_PREPARING']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 2000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected,
        nowMs: clock.value
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unexpected'}),
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'RECEIPT_PREPARING_STATE_UNKNOWN');

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  clock.value = started.reviewDeadlineAt - 1;
  let observeCalls = 0;
  let receiptPosts = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'receipt-complete-before'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-complete-before']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'COMPLETE');
  assert.equal(restarted.completionState, 'COMPLETE');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 1);
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);
});

test('durable REVISION_REQUIRED review result resumes receipt before deadline when receipt preparation never began', async () => {
  let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_PREPARING']});
  let store = createCoordinatorStateStore({backend, enabled: true});
  const clock = {value: START + 100};
  const collected = await collectReady({nowMs: clock.value});
  const started = await startReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async input => ({status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId}),
      observeReview: async () => ({status: 'PENDING'}),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unused'}),
        lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
      }
    }),
    reviewDeadlineMs: 2000
  });
  assert.equal(started.status, 'REVIEW_PENDING');

  const first = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => makeBoundaryCompletion({
        reviewRequestId: started.reviewRequestId,
        sessionId: started.sessionId,
        collected,
        nowMs: clock.value,
        verdict: 'REVISION_REQUIRED'
      }),
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => ({status: 'CREATED', receiptId: 'unexpected'}),
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(first.status, 'UNKNOWN');
  assert.equal(first.reason, 'RECEIPT_PREPARING_STATE_UNKNOWN');

  backend = reconstructBackendFromJson(backend);
  store = createCoordinatorStateStore({backend, enabled: true});
  clock.value = started.reviewDeadlineAt - 1;
  let observeCalls = 0;
  let receiptPosts = 0;
  const restarted = await observeReviewLifecycle({
    ...lifecycleInput({
      collected,
      store,
      clock,
      dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
      observeReview: async () => {
        observeCalls++;
        return {status: 'PENDING'};
      },
      revalidate: async () => collected,
      receipt: {
        postOnce: async () => {
          receiptPosts++;
          return {status: 'CREATED', receiptId: 'receipt-revision-before'};
        },
        lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['receipt-revision-before']})
      }
    }),
    executionKey: collected.executionKey
  });
  assert.equal(restarted.status, 'COMPLETE');
  assert.equal(restarted.completionState, 'REVISION_REQUIRED');
  assert.equal(observeCalls, 0);
  assert.equal(receiptPosts, 1);
  assert.equal(backend.committedTransitionCount('RECEIPT_PREPARING'), 1);
});

test('ack and pending entry windows with UNKNOWN persistence failure remain nonadvancing after JSON reconstruction', async () => {
  {
    let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
    let store = createCoordinatorStateStore({backend, enabled: true});
    const clock = {value: START + 100};
    const collected = await collectReady({nowMs: clock.value});
    const counters = {dispatch: 0, observe: 0, post: 0};
    const started = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(started.status, 'REVIEW_PENDING');
    const first = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => ({...collected, headSha: 'f'.repeat(40)}),
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(first.status, 'UNKNOWN');
    assert.equal(first.reason, 'STALE_OR_UNKNOWN_BEFORE_OBSERVE');
    const retained = await store.reconcile(collected.executionKey);
    assert.equal(retained.status, 'READY');
    assert.equal(retained.claim.lastStage, 'OBSERVE_PREPARING');
    const retainedClaimBeforeRestart = structuredClone(retained.claim);
    backend = reconstructBackendFromJson(backend);
    store = createCoordinatorStateStore({backend, enabled: true});
    const duplicateStart = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(duplicateStart.status, 'WAITING');
    assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
    const countersAfterDuplicateStart = {...counters};
    const restarted = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return makeBoundaryCompletion({
            reviewRequestId: started.reviewRequestId,
            sessionId: started.sessionId,
            collected,
            nowMs: clock.value
          });
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(restarted.status, 'UNKNOWN');
    assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
    assert.deepEqual(counters, countersAfterDuplicateStart);
    assert.equal(counters.dispatch, 1);
    assert.equal(counters.observe, 0);
    assert.equal(counters.post, 0);
    assert.equal(backend.admissionState.consumedQuota, 1);
    assert.equal(backend.admissionState.claims.length, 1);
    assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
    const retainedAfterRestart = await store.reconcile(collected.executionKey);
    assert.equal(retainedAfterRestart.status, 'READY');
    assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
    assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
    assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
    assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
    assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
  }

  {
    let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
    let store = createCoordinatorStateStore({backend, enabled: true});
    const clock = {value: START + 100};
    const collected = await collectReady({nowMs: clock.value});
    const counters = {dispatch: 0, observe: 0, post: 0};
    const started = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(started.status, 'REVIEW_PENDING');
    const pending = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(pending.status, 'REVIEW_PENDING');
    const driftCollected = await collectReady({nowMs: clock.value, headSha: 'f'.repeat(40)});
    const first = await observeReviewLifecycle({
      ...lifecycleInput({
        collected: driftCollected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => driftCollected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(first.status, 'UNKNOWN');
    assert.equal(first.reason, 'COLLECTION_PIN_MISMATCH');
    const retained = await store.reconcile(collected.executionKey);
    assert.equal(retained.status, 'READY');
    assert.equal(retained.claim.lastStage, 'OBSERVE_PREPARING');
    const retainedClaimBeforeRestart = structuredClone(retained.claim);
    backend = reconstructBackendFromJson(backend);
    store = createCoordinatorStateStore({backend, enabled: true});
    const duplicateStart = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(duplicateStart.status, 'WAITING');
    assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
    const countersAfterDuplicateStart = {...counters};
    const restarted = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return makeBoundaryCompletion({
            reviewRequestId: started.reviewRequestId,
            sessionId: started.sessionId,
            collected,
            nowMs: clock.value
          });
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(restarted.status, 'UNKNOWN');
    assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
    assert.deepEqual(counters, countersAfterDuplicateStart);
    assert.equal(counters.dispatch, 1);
    assert.equal(counters.observe, 1);
    assert.equal(counters.post, 0);
    assert.equal(backend.admissionState.consumedQuota, 1);
    assert.equal(backend.admissionState.claims.length, 1);
    assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
    const retainedAfterRestart = await store.reconcile(collected.executionKey);
    assert.equal(retainedAfterRestart.status, 'READY');
    assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
    assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
    assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
    assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
    assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
  }
});

test('persisted-result entry windows with UNKNOWN persistence failure remain nonadvancing after JSON reconstruction', async () => {
  for (const mode of ['revalidation', 'pin-mismatch']) {
    let backend = new DurableLifecycleBackend({failTransitionKinds: ['RECEIPT_PREPARING', 'UNKNOWN']});
    let store = createCoordinatorStateStore({backend, enabled: true});
    const clock = {value: START + 100};
    const collected = await collectReady({nowMs: clock.value});
    const counters = {dispatch: 0, observe: 0, post: 0};
    const started = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(started.status, 'REVIEW_PENDING');
    const persistResultOnly = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return makeBoundaryCompletion({
            reviewRequestId: started.reviewRequestId,
            sessionId: started.sessionId,
            collected,
            nowMs: clock.value
          });
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(persistResultOnly.status, 'UNKNOWN');
    assert.equal(persistResultOnly.reason, 'RECEIPT_PREPARING_STATE_UNKNOWN');
    const persisted = await store.reconcile(collected.executionKey);
    assert.equal(persisted.status, 'READY');
    assert.equal(persisted.claim.lastStage, 'REVIEW_RESULT');
    const persistedResultClaim = structuredClone(persisted.claim);

    backend = reconstructBackendFromJson(backend);
    store = createCoordinatorStateStore({backend, enabled: true});
    const observedCollected = mode === 'pin-mismatch'
      ? await collectReady({nowMs: clock.value, headSha: 'f'.repeat(40)})
      : collected;
    let revalidateCalls = 0;
    const uncertain = await observeReviewLifecycle({
      ...lifecycleInput({
        collected: observedCollected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => {
          revalidateCalls++;
          if (mode === 'revalidation') return {...observedCollected, headSha: 'e'.repeat(40)};
          return observedCollected;
        },
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(uncertain.status, 'UNKNOWN');
    assert.equal(uncertain.reason, mode === 'revalidation'
      ? 'STALE_OR_UNKNOWN_BEFORE_RECEIPT'
      : 'COLLECTION_PIN_MISMATCH');
    const retained = await store.reconcile(collected.executionKey);
    assert.equal(retained.status, 'READY');
    assert.equal(retained.claim.lastStage, 'RECEIPT_PREPARING');
    const retainedClaimBeforeRestart = structuredClone(retained.claim);

    backend = reconstructBackendFromJson(backend);
    store = createCoordinatorStateStore({backend, enabled: true});
    const duplicateStart = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(duplicateStart.status, 'WAITING');
    assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
    const countersAfterDuplicateStart = {...counters};
    const restarted = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return makeBoundaryCompletion({
            reviewRequestId: started.reviewRequestId,
            sessionId: started.sessionId,
            collected,
            nowMs: clock.value
          });
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(restarted.status, 'UNKNOWN');
    assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
    assert.deepEqual(counters, countersAfterDuplicateStart);
    assert.equal(counters.dispatch, 1);
    assert.equal(counters.observe, 1);
    assert.equal(counters.post, 0);
    assert.equal(backend.admissionState.consumedQuota, 1);
    assert.equal(backend.admissionState.claims.length, 1);
    assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
    const retainedAfterRestart = await store.reconcile(collected.executionKey);
    assert.equal(retainedAfterRestart.status, 'READY');
    assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
    assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
    assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
    assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
    assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
    assert.equal(retainedAfterRestart.claim.completionState, persistedResultClaim.completionState);
    assert.equal(retainedAfterRestart.claim.verdict, persistedResultClaim.verdict);
  }
});

test('null and undefined observation are ambiguous (not pending) and remain blocked after restart when UNKNOWN persistence fails', async () => {
  for (const observed of [null, undefined]) {
    let backend = new DurableLifecycleBackend({failTransitionKinds: ['UNKNOWN']});
    let store = createCoordinatorStateStore({backend, enabled: true});
    const clock = {value: START + 100};
    const collected = await collectReady({nowMs: clock.value});
    const counters = {dispatch: 0, observe: 0, post: 0};
    const started = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(started.status, 'REVIEW_PENDING');

    const first = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return observed;
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(first.status, 'UNKNOWN');
    assert.equal(first.reason, 'OBSERVE_AMBIGUOUS');
    const retained = await store.reconcile(collected.executionKey);
    assert.equal(retained.status, 'READY');
    assert.equal(retained.claim.lastStage, 'OBSERVE_PREPARING');
    const retainedClaimBeforeRestart = structuredClone(retained.claim);

    backend = reconstructBackendFromJson(backend);
    store = createCoordinatorStateStore({backend, enabled: true});
    const duplicateStart = await startReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async input => {
          counters.dispatch++;
          return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
        },
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unused'};
          },
          lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
        }
      })
    });
    assert.equal(duplicateStart.status, 'WAITING');
    assert.equal(duplicateStart.reason, 'ALREADY_CLAIMED');
    const countersAfterDuplicateStart = {...counters};
    const restarted = await observeReviewLifecycle({
      ...lifecycleInput({
        collected,
        store,
        clock,
        dispatchReview: async () => ({status: 'ACKNOWLEDGED'}),
        observeReview: async () => {
          counters.observe++;
          return {status: 'PENDING'};
        },
        revalidate: async () => collected,
        receipt: {
          postOnce: async () => {
            counters.post++;
            return {status: 'CREATED', receiptId: 'unexpected'};
          },
          lookupByActionKey: async () => ({status: 'FOUND', complete: true, receiptIds: ['unexpected']})
        }
      }),
      executionKey: collected.executionKey
    });
    assert.equal(restarted.status, 'UNKNOWN');
    assert.equal(restarted.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
    assert.deepEqual(counters, countersAfterDuplicateStart);
    assert.equal(counters.dispatch, 1);
    assert.equal(counters.observe, 1);
    assert.equal(counters.post, 0);
    assert.equal(backend.admissionState.consumedQuota, 1);
    assert.equal(backend.admissionState.claims.length, 1);
    assert.equal(backend.admissionState.activeGate.executionKey, collected.executionKey);
    const retainedAfterRestart = await store.reconcile(collected.executionKey);
    assert.equal(retainedAfterRestart.status, 'READY');
    assert.equal(retainedAfterRestart.claim.lastStage, retainedClaimBeforeRestart.lastStage);
    assert.equal(retainedAfterRestart.claim.actionKey, retainedClaimBeforeRestart.actionKey);
    assert.equal(retainedAfterRestart.claim.executionKey, retainedClaimBeforeRestart.executionKey);
    assert.equal(retainedAfterRestart.claim.reviewRequestId, retainedClaimBeforeRestart.reviewRequestId);
    assert.equal(retainedAfterRestart.claim.sessionId, retainedClaimBeforeRestart.sessionId);
  }
});
