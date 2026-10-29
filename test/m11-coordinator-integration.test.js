import test from 'node:test';
import assert from 'node:assert/strict';
import {createM11CoordinatorGithubReadApi} from '../scripts/autonomy/m11-coordinator-github-read-api.mjs';
import {collectExactPair, validateWorkflowJobs} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {runReviewCoordinator} from '../scripts/autonomy/m11-coordinator-review.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';

const REPOSITORY = 'Achi1984/meridian';
const PR = 973;
const WORKFLOW_ID = 347821227;
const RUN_ID = 7001;
const RUN_ATTEMPT = 1;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const START = 1700000000000;
const END = START + 86400000;

function credentials(expiresAtMs = START + 10000) {
  return {
    getAuthorizationHeader: () => 'synthetic-test-token',
    getTrustedAuthEvidence: () => ({
      host: 'api.github.com',
      scheme: 'https',
      tls: true,
      principal: 'synthetic-test-principal',
      evidenceId: 'synthetic-evidence-123',
      verifiedAtMs: START,
      expiresAtMs
    })
  };
}

function response(url, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const encoder = new TextEncoder();
  return {
    status: 200,
    url: url.toString(),
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      }
    })
  };
}

function makeHarness({prHead = HEAD, authExpiresAt = START + 10000} = {}) {
  const calls = [];
  const comparePath = `/repos/${REPOSITORY}/compare/${BASE}...${HEAD}`;
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url);
    calls.push({path: requestUrl.pathname, method: options.method});
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
        triggering_actor: {login: 'Achi1984'}
      });
    }
    if (requestUrl.pathname === `/repos/${REPOSITORY}/pulls/${PR}`) {
      return response(requestUrl, {
        number: PR,
        state: 'open',
        changed_files: 1,
        head: {sha: prHead, repo: {full_name: REPOSITORY, fork: false}},
        base: {sha: BASE, repo: {full_name: REPOSITORY}}
      });
    }
    if (requestUrl.pathname === comparePath) {
      if (options.headers.accept === 'application/vnd.github.v3.diff') {
        return response(requestUrl, `diff --git a/example.js b/example.js\n+${HEAD}`);
      }
      return response(requestUrl, {
        base_commit: {sha: BASE},
        merge_base_commit: {sha: BASE},
        total_commits: 1,
        commits: [{sha: HEAD}],
        files: [{filename: 'example.js', patch: '@@ -0,0 +1 @@'}]
      });
    }
    if (requestUrl.pathname === `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}/runs`) {
      return response(requestUrl, {
        workflow_runs: [{
          id: RUN_ID,
          repository: {full_name: REPOSITORY},
          workflow_id: WORKFLOW_ID,
          run_number: 20,
          run_attempt: RUN_ATTEMPT,
          pull_requests: [{number: PR}]
        }]
      });
    }
    if (new RegExp(`^/repos/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/\\d+/jobs$`)
      .test(requestUrl.pathname)) {
      return response(requestUrl, {
        jobs: [{
          id: 81,
          name: 'syntax',
          run_id: RUN_ID,
          run_attempt: RUN_ATTEMPT,
          status: 'completed',
          conclusion: 'success',
          steps: [{name: 'Research and auth regression tests', status: 'completed', conclusion: 'success'}]
        }]
      });
    }
    throw new Error(`Unexpected request path: ${requestUrl.pathname}`);
  };
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(authExpiresAt),
    now: () => START + 100,
    defaultDeadlineMs: 1000
  });
  return {api, calls};
}

function collect(api) {
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
    api,
    now: () => START + 100
  });
}

class CountingStateBackend {
  constructor() {
    this.calls = [];
    this.capabilities = {
      immutableCommits: true,
      validatedRevisionChain: true,
      atomicCreateOnlyClaims: true,
      atomicSingleWriterClaim: true,
      atomicPacketQuota: true,
      atomicExpectedOidCAS: true
    };
  }

  async readSnapshot() {
    this.calls.push('readSnapshot');
    return {revision: 0, oid: 'root', chainValid: true};
  }
  async createOnlyClaim() { this.calls.push('createOnlyClaim'); return {status: 'CREATED', claimId: 'test-claim'}; }
  async createImmutableCommit() { this.calls.push('createImmutableCommit'); return null; }
  async compareAndSwapRef() { this.calls.push('compareAndSwapRef'); return {status: 'CONFLICT'}; }
  async readClaim() { this.calls.push('readClaim'); return null; }
}

test('real adapter stays blocked at collector pagination and cannot reach review or state', async () => {
  const {api, calls} = makeHarness();
  const collected = await collect(api);

  assert.equal(collected.status, 'BLOCKED');
  assert.equal(collected.reason, 'RUN_PAGINATION_INCOMPLETE');
  assert.ok(calls.some(call => call.path.endsWith(`/actions/workflows/${WORKFLOW_ID}/runs`)));
  assert.equal(calls.some(call => call.path.endsWith(`/attempts/${RUN_ATTEMPT}/jobs`)), false);
  assert.ok(calls.every(call => call.method === 'GET'));

  const runPage = await api.listWorkflowRuns({repository: REPOSITORY, workflowId: WORKFLOW_ID, page: 1});
  assert.equal(Object.hasOwn(runPage, 'totalCount'), false);

  const jobPage = await api.listWorkflowJobs({
    repository: REPOSITORY, runId: RUN_ID, runAttempt: RUN_ATTEMPT, page: 1
  });
  assert.deepEqual(jobPage.items[0], {id: 81, status: 'completed', conclusion: 'success'});
  assert.equal(validateWorkflowJobs(jobPage.items, {
    runId: RUN_ID, runAttempt: RUN_ATTEMPT, workflowId: WORKFLOW_ID
  }), false);
  const anotherAttempt = await api.listWorkflowJobs({
    repository: REPOSITORY, runId: RUN_ID, runAttempt: RUN_ATTEMPT + 1, page: 1
  });
  assert.equal(calls.at(-1).path.endsWith(`/attempts/${RUN_ATTEMPT + 1}/jobs`), true);
  assert.equal(Object.hasOwn(anotherAttempt.items[0], 'runAttempt'), false);

  const backend = new CountingStateBackend();
  const store = createCoordinatorStateStore({backend, enabled: true});
  let reviewerCalls = 0;
  let receiptCalls = 0;
  const review = await runReviewCoordinator({
    enabled: true,
    collected,
    store,
    reviewer: async () => { reviewerCalls++; },
    reviewerIdentity: {provider: 'claude', agent: 'test-agent', model: 'test-model', transport: 'injected'},
    capabilityEvidence: {
      state: 'ENABLED',
      provider: 'claude',
      agent: 'test-agent',
      model: 'test-model',
      transport: 'injected',
      observedAt: START,
      expiresAt: END
    },
    revalidate: async () => collected,
    receipt: {
      postOnce: async () => { receiptCalls++; },
      lookupByActionKey: async () => { receiptCalls++; }
    },
    now: () => START + 100,
    expiresAt: END
  });
  assert.equal(review.status, 'WAITING');
  assert.equal(review.reason, 'UNVERIFIED_OR_EXPIRED_CI_COLLECTION');
  assert.equal(reviewerCalls, 0);
  assert.equal(receiptCalls, 0);
  assert.deepEqual(backend.calls, []);
});

test('actual adapter rejects stale pair and expired authentication evidence', async () => {
  const stale = await collect(makeHarness({prHead: 'c'.repeat(40)}).api);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.reason, 'PULL_REQUEST_PAIR_OR_FORK_MISMATCH');

  const expiredHarness = makeHarness({authExpiresAt: START + 50});
  const expired = await collect(expiredHarness.api);
  assert.equal(expired.status, 'BLOCKED');
  assert.equal(expired.reason, 'AUTHENTICATED_READ_API_REQUIRED');
  assert.equal(expiredHarness.calls.length, 0);
});

test('actual adapter propagates caller abort without promoting evidence', async () => {
  const controller = new AbortController();
  const api = createM11CoordinatorGithubReadApi({
    credentials: credentials(),
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
