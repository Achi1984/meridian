import test from 'node:test';
import assert from 'node:assert/strict';
import {createM11CoordinatorGithubReadApi} from '../scripts/autonomy/m11-coordinator-github-read-api.mjs';
import {collectExactPair, validateWorkflowJobs} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {runReviewCoordinator} from '../scripts/autonomy/m11-coordinator-review.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';

const REPOSITORY = 'Achi1984/meridian';
const PR = 973;
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const START = 1700000000000;
const PILOT_END = START + 86400000;
const AUTH_END = START + 600000;
const IDENTITY = Object.freeze({
  provider: 'claude',
  agent: 'test-reviewer',
  model: 'offline-fixture',
  transport: 'injected'
});

function makeCredentials({expiresAtMs = AUTH_END} = {}) {
  let evidence = {
    host: 'api.github.com',
    scheme: 'https',
    tls: true,
    principal: 'synthetic-test-principal',
    evidenceId: 'synthetic-auth-evidence-001',
    verifiedAtMs: START,
    expiresAtMs
  };
  return {
    getAuthorizationHeader: () => 'synthetic-test-token',
    getTrustedAuthEvidence: () => evidence,
    replaceEvidence(value) { evidence = value; }
  };
}

function response(url, value, {onBodyRead = () => {}, headers = {}} = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const encoder = new TextEncoder();
  return {
    status: 200,
    url: url.toString(),
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        onBodyRead();
        controller.close();
      }
    })
  };
}

function makeHarness({
  clock = {value: START + 100},
  prHead = HEAD,
  run = {},
  runTotalByPage = [1],
  runItemCountLimit = Infinity,
  jobTotalByPage = [1],
  expireOnPath = null,
  rotateOnPath = null,
  jobRunId = RUN_ID,
  jobRunAttempt = null,
  runHeadSha = HEAD,
  runBaseSha = BASE,
  runPullRequest = PR,
  attemptWorkflowId = null,
  unfilteredRunTotalCount = null
} = {}) {
  const credentials = makeCredentials();
  const calls = [];
  const runPageSizes = [];
  const comparePath = `/repos/${REPOSITORY}/compare/${BASE}...${HEAD}`;
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({path: requestUrl.pathname, query: requestUrl.search, method: options.method});
    const expire = () => {
      if (expireOnPath === requestUrl.pathname) clock.value = credentials.getTrustedAuthEvidence().expiresAtMs;
    };
    const rotate = () => {
      if (rotateOnPath === requestUrl.pathname) {
        credentials.replaceEvidence({
          ...credentials.getTrustedAuthEvidence(),
          evidenceId: 'rotated-auth-evidence-002'
        });
      }
    };
    const afterBodyRead = () => { expire(); rotate(); };
    if (requestUrl.pathname === `/repos/${REPOSITORY}/actions/runs/${RUN_ID}`) {
      return response(requestUrl, {
        id: RUN_ID,
        repository: {full_name: REPOSITORY},
        workflow_id: WORKFLOW_ID,
        path: '.github/workflows/backend-safety.yml@refs/heads/main',
        run_attempt: RUN_ATTEMPT,
        run_number: 20,
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD,
        pull_requests: [{number: PR, base: {sha: BASE}, head: {sha: HEAD}}],
        actor: {login: 'Achi1984'},
        triggering_actor: {login: 'Achi1984'},
        ...run
      }, {onBodyRead: afterBodyRead});
    }
    if (requestUrl.pathname === `/repos/${REPOSITORY}/pulls/${PR}`) {
      return response(requestUrl, {
        number: PR,
        state: 'open',
        changed_files: 1,
        head: {sha: prHead, repo: {full_name: REPOSITORY, fork: false}},
        base: {sha: BASE, repo: {full_name: REPOSITORY}}
      }, {onBodyRead: afterBodyRead});
    }
    if (requestUrl.pathname === comparePath) {
      if (options.headers.accept === 'application/vnd.github.v3.diff') {
        return response(requestUrl, `diff --git a/example.js b/example.js\n+${HEAD}`, {onBodyRead: afterBodyRead});
      }
      return response(requestUrl, {
        base_commit: {sha: BASE},
        merge_base_commit: {sha: BASE},
        total_commits: 1,
        commits: [{sha: HEAD}],
        files: [{filename: 'example.js', patch: '@@ -0,0 +1 @@'}]
      }, {onBodyRead: afterBodyRead});
    }
    if (requestUrl.pathname === `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}/runs`) {
      const page = Number(requestUrl.searchParams.get('page'));
      const totalCount = requestUrl.searchParams.has('head_sha')
        ? runTotalByPage[Math.min(page - 1, runTotalByPage.length - 1)]
        : (unfilteredRunTotalCount ?? runTotalByPage[Math.min(page - 1, runTotalByPage.length - 1)]);
      const generatedCount = Math.max(1, Number(runTotalByPage[0]) || 1);
      const allRuns = Array.from({length: generatedCount}, (_, index) => ({
        id: index === 0 ? RUN_ID : 8000 + index,
        repository: {full_name: REPOSITORY},
        workflow_id: run.workflow_id ?? WORKFLOW_ID,
        run_number: index === 0 ? 20 : 19,
        run_attempt: index === 0 ? run.run_attempt ?? RUN_ATTEMPT : RUN_ATTEMPT,
        head_sha: runHeadSha,
        pull_requests: [{number: runPullRequest, base: {sha: runBaseSha}, head: {sha: runHeadSha}}]
      }));
      const items = allRuns.slice((page - 1) * 100, page * 100).slice(0, runItemCountLimit);
      const hasNext = page < runTotalByPage.length;
      runPageSizes.push({page, totalCount, itemCount: items.length});
      return response(requestUrl, {
        total_count: totalCount,
        workflow_runs: items
      }, {
        onBodyRead: afterBodyRead,
        headers: hasNext
          ? {link: `<https://api.github.com${requestUrl.pathname}?page=${page + 1}>; rel="next"`}
          : {}
      });
    }
    const runAttemptPath = new RegExp(
      `^/repos/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/(\\d+)$`
    );
    const attemptMatch = runAttemptPath.exec(requestUrl.pathname);
    if (attemptMatch) {
      return response(requestUrl, {
        id: RUN_ID,
        run_attempt: Number(attemptMatch[1]),
        workflow_id: attemptWorkflowId ?? run.workflow_id ?? WORKFLOW_ID,
        path: '.github/workflows/backend-safety.yml@refs/heads/main',
        repository: {full_name: REPOSITORY}
      }, {onBodyRead: afterBodyRead});
    }
    const jobsPath = new RegExp(
      `^/repos/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/(\\d+)/jobs$`
    );
    const jobsMatch = jobsPath.exec(requestUrl.pathname);
    if (jobsMatch) {
      const attempt = Number(jobsMatch[1]);
      const page = Number(requestUrl.searchParams.get('page'));
      return response(requestUrl, {
        total_count: jobTotalByPage[Math.min(page - 1, jobTotalByPage.length - 1)],
        jobs: [{
          id: 81,
          name: 'syntax',
          run_id: jobRunId,
          run_attempt: jobRunAttempt ?? attempt,
          status: 'completed',
          conclusion: 'success',
          steps: [{name: 'Research and auth regression tests', status: 'completed', conclusion: 'success'}]
        }]
      }, {
        onBodyRead: afterBodyRead,
        headers: page < jobTotalByPage.length
          ? {link: `<https://api.github.com${requestUrl.pathname}?page=${page + 1}>; rel="next"`}
          : {}
      });
    }
    throw new Error(`Unexpected request path: ${requestUrl.pathname}`);
  };
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials,
    now: () => clock.value,
    defaultDeadlineMs: 1000
  });
  return {api, calls, clock, credentials, runPageSizes};
}

function collectionConfig() {
  return {
    enabled: true,
    repository: REPOSITORY,
    pullRequests: [PR],
    actors: ['Achi1984'],
    startsAt: START,
    expiresAt: PILOT_END,
    maxPages: 5,
    maxRuntimeMs: 1000
  };
}

function collect(api, {attempt = RUN_ATTEMPT, now = () => START + 100} = {}) {
  return collectExactPair({
    hint: {
      eventName: 'workflow_run',
      repository: REPOSITORY,
      workflowRunId: RUN_ID,
      workflowRunAttempt: attempt
    },
    config: collectionConfig(),
    api,
    now
  });
}

function reviewResult(reviewRequestId) {
  return {
    reviewRequestId,
    sessionId: 'offline-review-session',
    reviewer: {...IDENTITY},
    coverageParts: [...REQUIRED_REVIEW_PARTS],
    verdict: 'GREEN_LIGHT',
    complete: true,
    truncated: false,
    turnLimit: false,
    summary: 'Synthetic composition result.'
  };
}

class AtomicMemoryBackend {
  constructor() {
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
  }

  async readSnapshot() { return structuredClone(this.snapshot); }

  async createOnlyClaim(input) {
    if (input.maxActiveClaims !== 1 || input.maxPackets !== 3) return {status: 'INVALID_LIMIT'};
    if (this.claims.has(input.executionKey)) return {status: 'EXISTS'};
    if ([...this.claims.values()].some(claim => claim.status !== 'COMMITTED')) return {status: 'BUSY'};
    if (input.expectedRevision !== this.snapshot.revision || input.expectedOid !== this.snapshot.oid) {
      return {status: 'STALE_EXPECTATION'};
    }
    if (this.claims.size >= input.maxPackets) return {status: 'BUDGET_EXHAUSTED'};
    const claimId = `claim-${this.claims.size + 1}`;
    this.claims.set(input.executionKey, {
      status: 'CLAIMED', lastStage: 'CLAIMED', claimId, ...input
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
    if (!claim || claim.actionKey !== input.actionKey || claim.claimId !== input.claimId
      || current.oid !== input.expectedOid || current.revision !== input.expectedRevision
      || commit?.parentOid !== current.oid || commit?.revision !== input.newRevision) {
      return {status: 'CONFLICT'};
    }
    current.oid = input.newOid;
    current.revision = input.newRevision;
    const transition = commit.transition;
    claim.status = transition.kind === 'UNKNOWN' ? 'UNKNOWN'
      : transition.kind === 'RECEIPT_DELIVERED' ? 'COMMITTED'
        : transition.kind === 'RECEIPT_POSTING' ? 'RECEIPT_POSTING' : 'REVIEWED';
    claim.lastStage = transition.stage || transition.kind;
    if (transition.kind === 'RECEIPT_DELIVERED') claim.receiptId = transition.receiptId;
    return {status: 'COMMITTED', oid: input.newOid};
  }

  async readClaim(executionKey) { return this.claims.get(executionKey) || null; }
}

function createCoordinator({collected, store, revalidate, reviewer, postOnce, now = () => START + 100}) {
  return runReviewCoordinator({
    enabled: true,
    collected,
    store,
    reviewerIdentity: IDENTITY,
    capabilityEvidence: {
      state: 'ENABLED',
      ...IDENTITY,
      observedAt: START,
      expiresAt: PILOT_END
    },
    revalidate,
    reviewer,
    receipt: {
      postOnce,
      lookupByActionKey: async () => ({status: 'NOT_FOUND', complete: true, receiptIds: []})
    },
    now,
    expiresAt: PILOT_END
  });
}

test('real adapter to collector to review/state/receipt composition succeeds with bound auth evidence', async () => {
  const harness = makeHarness();
  const collected = await collect(harness.api);
  assert.equal(collected.status, 'READY');
  assert.deepEqual(collected.provenance.authenticationEvidence, harness.api.authenticationEvidence);
  assert.equal(Object.isFrozen(collected.provenance.authenticationEvidence), true);
  assert.equal(collected.expiresAt, START + 300100);

  const backend = new AtomicMemoryBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  let revalidations = 0;
  let reviewerCalls = 0;
  let receiptCalls = 0;
  const result = await createCoordinator({
    collected,
    store,
    revalidate: async ({expected}) => {
      revalidations++;
      assert.deepEqual(expected.authenticationEvidence, collected.provenance.authenticationEvidence);
      return collect(harness.api);
    },
    reviewer: async input => {
      reviewerCalls++;
      return reviewResult(input.reviewRequestId);
    },
    postOnce: async () => {
      receiptCalls++;
      return {status: 'CREATED', receiptId: 'synthetic-comment-id'};
    }
  });
  assert.equal(result.status, 'PROPOSED', result.reason);
  assert.equal(revalidations, 3);
  assert.equal(reviewerCalls, 1);
  assert.equal(receiptCalls, 1);
  assert.equal(backend.snapshot.revision, 3);
  assert.equal(backend.claims.get(collected.executionKey).receiptId, 'synthetic-comment-id');
  assert.ok(harness.calls.every(call => call.method === 'GET'));
});

test('exact run, attempt, workflow, pagination totals, and job inventory remain required', async () => {
  const wrongAttempt = await collect(makeHarness({run: {run_attempt: 2}}).api);
  assert.equal(wrongAttempt.reason, 'RUN_IDENTITY_OR_ACTOR_MISMATCH');
  const wrongWorkflow = await collect(makeHarness({run: {workflow_id: 5}}).api);
  assert.equal(wrongWorkflow.reason, 'RUN_IDENTITY_OR_ACTOR_MISMATCH');
  const wrongHint = await collect(makeHarness().api, {attempt: 2});
  assert.equal(wrongHint.reason, 'RUN_IDENTITY_OR_ACTOR_MISMATCH');
  const malformedTotal = await collect(makeHarness({runTotalByPage: ['1']}).api);
  assert.equal(malformedTotal.reason, 'AUTHORITATIVE_READ_FAILED');
  const truncated = await collect(makeHarness({runTotalByPage: [2], runItemCountLimit: 1}).api);
  assert.equal(truncated.reason, 'RUN_PAGINATION_INCOMPLETE');
  const changedTotal = await collect(makeHarness({runTotalByPage: [2, 1]}).api);
  assert.equal(changedTotal.reason, 'RUN_PAGINATION_INCOMPLETE');
  const truncatedJobs = await collect(makeHarness({jobTotalByPage: [2]}).api);
  assert.equal(truncatedJobs.reason, 'JOB_PAGINATION_INCOMPLETE');
  const wrongJobRun = await collect(makeHarness({jobRunId: RUN_ID + 1}).api);
  assert.equal(wrongJobRun.reason, 'AUTHORITATIVE_READ_FAILED');
  const wrongJobAttempt = await collect(makeHarness({jobRunAttempt: RUN_ATTEMPT + 1}).api);
  assert.equal(wrongJobAttempt.reason, 'AUTHORITATIVE_READ_FAILED');
  const wrongAttemptWorkflow = await collect(makeHarness({attemptWorkflowId: WORKFLOW_ID + 1}).api);
  assert.equal(wrongAttemptWorkflow.reason, 'CI_JOB_INVENTORY_OR_IDENTITY_MISMATCH');
  const stale = await collect(makeHarness({prHead: 'c'.repeat(40)}).api);
  assert.equal(stale.reason, 'PULL_REQUEST_PAIR_OR_FORK_MISMATCH');
});

test('complete run pagination collects all 130 entries across 100 plus 30', async () => {
  const harness = makeHarness({runTotalByPage: [130, 130]});
  const collected = await collect(harness.api);
  assert.equal(collected.status, 'READY');
  assert.deepEqual(harness.runPageSizes, [
    {page: 1, totalCount: 130, itemCount: 100},
    {page: 2, totalCount: 130, itemCount: 30}
  ]);
});

test('bounded relevant-run discovery uses head_sha filtering and rejects unsupported unbounded totals', async () => {
  const bounded = makeHarness({runTotalByPage: [1], unfilteredRunTotalCount: 2500});
  const collected = await collect(bounded.api);
  assert.equal(collected.status, 'READY');
  const runListCall = bounded.calls.find(call => call.path === `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}/runs`);
  assert.ok(runListCall?.query.includes(`head_sha=${HEAD}`));
  assert.ok(runListCall?.query.includes('event=pull_request'));

  const unsupported = await collect(makeHarness({
    runTotalByPage: [2500]
  }).api);
  assert.equal(unsupported.reason, 'UNSUPPORTED_RELEVANT_RUN_DISCOVERY');
});

test('auth expiry during a response body blocks collection without exposing reviewer or store', async () => {
  const harness = makeHarness({
    expireOnPath: `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}/runs`
  });
  const collected = await collect(harness.api);
  assert.equal(collected.status, 'BLOCKED');
  assert.equal(collected.reason, 'AUTHORITATIVE_READ_FAILED');

  const backend = new AtomicMemoryBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  let reviewerCalls = 0;
  let receiptCalls = 0;
  const result = await createCoordinator({
    collected,
    store,
    revalidate: async () => collected,
    reviewer: async () => { reviewerCalls++; return null; },
    postOnce: async () => { receiptCalls++; return {status: 'CREATED', receiptId: 'never'}; }
  });
  assert.equal(result.reason, 'UNVERIFIED_OR_EXPIRED_CI_COLLECTION');
  assert.equal(reviewerCalls, 0);
  assert.equal(receiptCalls, 0);
  assert.equal(backend.claims.size, 0);
});

test('credential evidence rotation during a response body stops further reads and collection', async () => {
  const rotatedPath = `/repos/${REPOSITORY}/actions/runs/${RUN_ID}`;
  const harness = makeHarness({rotateOnPath: rotatedPath});
  const collected = await collect(harness.api);
  assert.equal(collected.status, 'BLOCKED');
  assert.equal(collected.reason, 'AUTHORITATIVE_READ_FAILED');
  assert.deepEqual(harness.calls.map(call => call.path), [rotatedPath]);
});

test('auth evidence identity change and expiry at claim, review, or receipt revalidation stop promotion', async () => {
  const changedHarness = makeHarness();
  const collected = await collect(changedHarness.api);
  changedHarness.credentials.replaceEvidence({
    ...changedHarness.api.authenticationEvidence,
    evidenceId: 'synthetic-auth-evidence-002'
  });
  const changedBackend = new AtomicMemoryBackend();
  const changedStore = createCoordinatorStateStore({backend: changedBackend, enabled: true});
  let changedReviewerCalls = 0;
  const changed = await createCoordinator({
    collected,
    store: changedStore,
    revalidate: async () => collect(changedHarness.api),
    reviewer: async input => { changedReviewerCalls++; return reviewResult(input.reviewRequestId); },
    postOnce: async () => ({status: 'CREATED', receiptId: 'never'})
  });
  assert.equal(changed.reason, 'STALE_OR_UNKNOWN_BEFORE_CLAIM');
  assert.equal(changedReviewerCalls, 0);
  assert.equal(changedBackend.claims.size, 0);

  for (const expirationBoundary of ['claim', 'review', 'receipt']) {
    const clock = {value: START + 100};
    const harness = makeHarness({clock});
    const evidence = harness.api.authenticationEvidence;
    const shortened = {...evidence, expiresAtMs: START + 1000};
    harness.credentials.replaceEvidence(shortened);
    const candidate = await collect(harness.api, {now: () => clock.value});
    assert.equal(candidate.status, 'READY');
    assert.equal(candidate.expiresAt, shortened.expiresAtMs);
    const backend = new AtomicMemoryBackend();
    const store = createCoordinatorStateStore({backend, enabled: true});
    let validation = 0;
    let reviewerCalls = 0;
    let receiptCalls = 0;
    const result = await createCoordinator({
      collected: candidate,
      store,
      now: () => clock.value,
      revalidate: async () => {
        validation++;
        if ((expirationBoundary === 'claim' && validation === 1)
          || (expirationBoundary === 'review' && validation === 2)
          || (expirationBoundary === 'receipt' && validation === 3)) {
          clock.value = shortened.expiresAtMs;
        }
        return collect(harness.api, {now: () => clock.value});
      },
      reviewer: async input => { reviewerCalls++; return reviewResult(input.reviewRequestId); },
      postOnce: async () => { receiptCalls++; return {status: 'CREATED', receiptId: 'too-late'}; }
    });
    assert.equal(result.status, expirationBoundary === 'claim' ? 'WAITING' : 'UNKNOWN');
    assert.equal(result.reason, expirationBoundary === 'claim'
      ? 'STALE_OR_UNKNOWN_BEFORE_CLAIM'
      : expirationBoundary === 'review' ? 'STALE_OR_UNKNOWN_BEFORE_REVIEW' : 'STALE_OR_UNKNOWN_BEFORE_RECEIPT');
    assert.equal(reviewerCalls, expirationBoundary === 'claim' || expirationBoundary === 'review' ? 0 : 1);
    assert.equal(receiptCalls, 0);
    if (expirationBoundary === 'claim') {
      assert.equal(backend.claims.size, 0);
    } else {
      assert.notEqual(backend.claims.get(candidate.executionKey).status, 'COMMITTED');
    }
  }
});

test('receipt UNKNOWN is one-shot and replay does not duplicate reviewer or receipt delivery', async () => {
  const harness = makeHarness();
  const collected = await collect(harness.api);
  const backend = new AtomicMemoryBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  let reviewerCalls = 0;
  let receiptCalls = 0;
  const input = {
    collected,
    store,
    revalidate: async () => collect(harness.api),
    reviewer: async reviewInput => {
      reviewerCalls++;
      return reviewResult(reviewInput.reviewRequestId);
    },
    postOnce: async () => {
      receiptCalls++;
      throw new Error('synthetic unknown delivery result');
    }
  };
  const unknown = await createCoordinator(input);
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.reason, 'RECEIPT_DELIVERY_UNKNOWN');
  assert.equal(reviewerCalls, 1);
  assert.equal(receiptCalls, 1);
  assert.equal(backend.claims.get(collected.executionKey).status, 'UNKNOWN');
  const duplicate = await createCoordinator(input);
  assert.equal(duplicate.reason, 'ALREADY_CLAIMED');
  assert.equal(reviewerCalls, 1);
  assert.equal(receiptCalls, 1);
});

test('actual adapter propagates caller abort without promoting evidence', async () => {
  const controller = new AbortController();
  const api = createM11CoordinatorGithubReadApi({
    credentials: makeCredentials(),
    now: () => START + 100,
    defaultDeadlineMs: 1000,
    fetchImpl: (_url, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, {once: true});
    })
  });
  const pending = api.getWorkflowRun({
    repository: REPOSITORY,
    runId: RUN_ID,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(pending, error => error?.code === 'ABORTED');
});
