import test from 'node:test';
import assert from 'node:assert/strict';
import {createM11CoordinatorGithubReadApi} from '../scripts/autonomy/m11-coordinator-github-read-api.mjs';

const REPOSITORY = 'Achi1984/meridian';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const NOW_MS = 5000;

function credentials({
  token = 'Bearer secret-token',
  trustedAuthEvidence = {
    host: 'api.github.com',
    scheme: 'https',
    tls: true,
    principal: 'github-actions:run/7001',
    evidenceId: 'ev-12345678',
    verifiedAtMs: 1000,
    expiresAtMs: 10000
  }
} = {}) {
  let currentEvidence = trustedAuthEvidence;
  return {
    getAuthorizationHeader() {
      return token;
    },
    getTrustedAuthEvidence() {
      return currentEvidence;
    },
    setTrustedAuthEvidence(value) {
      currentEvidence = value;
    }
  };
}

function streamFromString(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  });
}

function makeResponse({status = 200, body = '', headers = {}, url}) {
  return {
    status,
    url,
    headers: new Headers(headers),
    body: streamFromString(body)
  };
}

function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const requestUrl = typeof url === 'string' ? new URL(url) : url;
    calls.push({
      url: requestUrl.toString(),
      path: requestUrl.pathname,
      query: requestUrl.search,
      method: options?.method,
      authorization: options?.headers?.authorization ?? options?.headers?.Authorization ?? null
    });
    for (const route of routes) {
      if (route.match(requestUrl)) {
        return route.handle({url: requestUrl, options});
      }
    }
    throw new Error(`No route for ${requestUrl.toString()}`);
  };
  return {fetchImpl, calls};
}

function json(body, {status = 200, headers = {}, url}) {
  return makeResponse({
    status,
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
    url
  });
}

function runPayload() {
  return {
    id: 7001,
    repository: {full_name: REPOSITORY},
    workflow_id: 347821227,
    path: '.github/workflows/backend-safety.yml@refs/heads/main',
    run_attempt: 1,
    run_number: 20,
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD,
    pull_requests: [{number: 973, base: {sha: BASE}, head: {sha: HEAD}}],
    actor: {login: 'Achi1984'},
    triggering_actor: {login: 'Achi1984'}
  };
}

function pullPayload({head = HEAD, base = BASE, changedFiles = 1} = {}) {
  return {
    number: 973,
    state: 'open',
    changed_files: changedFiles,
    head: {sha: head, repo: {full_name: REPOSITORY, fork: false}},
    base: {sha: base, repo: {full_name: REPOSITORY}}
  };
}

function comparePayload({files = [{filename: 'x.js', patch: '@@ -1 +1 @@\n-old\n+new'}], totalCommits = 1} = {}) {
  return {
    url: `https://api.github.com/repos/Achi1984/meridian/compare/${BASE}...${HEAD}`,
    html_url: `https://github.com/Achi1984/meridian/compare/${BASE}...${HEAD}`,
    permalink_url: `https://github.com/Achi1984/meridian/compare/${BASE}...${HEAD}`,
    diff_url: `https://github.com/Achi1984/meridian/compare/${BASE}...${HEAD}.diff`,
    patch_url: `https://github.com/Achi1984/meridian/compare/${BASE}...${HEAD}.patch`,
    base_commit: {sha: BASE},
    merge_base_commit: {sha: BASE},
    status: 'ahead',
    ahead_by: 1,
    behind_by: 0,
    total_commits: totalCommits,
    commits: [{sha: HEAD}],
    files
  };
}

test('adapter requires trusted transport evidence and never infers authenticated from token alone', async () => {
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl: async () => { throw new Error('not-called'); },
    credentials: credentials({trustedAuthEvidence: null}),
    now: () => NOW_MS
  });
  assert.equal(api.authenticated, false);
  await assert.rejects(
    api.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'UNAUTHENTICATED_TRANSPORT_EVIDENCE_REQUIRED'
  );
});

test('authentication evidence expires and 401 invalidates previous attestation', async () => {
  let nowMs = NOW_MS;
  const creds = credentials();
  const {fetchImpl} = makeFetch([
    {
      match: () => true,
      handle: ({url}) => json(runPayload(), {url: url.toString()})
    }
  ]);
  const expiring = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: creds,
    now: () => nowMs
  });
  assert.equal(expiring.authenticated, true);
  nowMs = 12000;
  assert.equal(expiring.authenticated, false);

  const {fetchImpl: unauthorizedFetch} = makeFetch([
    {
      match: () => true,
      handle: ({url}) => makeResponse({status: 401, body: '{"message":"bad"}', url: url.toString()})
    }
  ]);
  const invalidatedCreds = credentials();
  const invalidated = createM11CoordinatorGithubReadApi({
    fetchImpl: unauthorizedFetch,
    credentials: invalidatedCreds,
    now: () => NOW_MS
  });
  assert.equal(invalidated.authenticated, true);
  await assert.rejects(
    invalidated.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'UNAUTHORIZED'
  );
  assert.equal(invalidated.authenticated, false);
});

test('exact-pair happy path maps authoritative GitHub payloads', async () => {
  const workflowRun = runPayload();
  const pullRequest = pullPayload();
  const compare = comparePayload();
  const diffText = 'diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-old\n+new\n';
  const {fetchImpl, calls} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/runs/7001',
      handle: ({url}) => json(workflowRun, {
        url: url.toString(),
        headers: {'x-accepted-github-permissions': 'actions=read'}
      })
    },
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/pulls/973',
      handle: ({url}) => json(pullRequest, {url: url.toString()})
    },
    {
      match: url => url.pathname === `/repos/Achi1984/meridian/compare/${BASE}...${HEAD}`,
      handle: ({url, options}) => {
        if (options?.headers?.accept === 'application/vnd.github.v3.diff') {
          return makeResponse({status: 200, body: diffText, url: url.toString()});
        }
        return json(compare, {url: url.toString()});
      }
    },
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/workflows/347821227/runs',
      handle: ({url}) => json({
        workflow_runs: [{
          id: 7001,
          repository: {full_name: REPOSITORY},
          workflow_id: 347821227,
          run_number: 20,
          run_attempt: 1,
          pull_requests: [{number: 973}]
        }]
      }, {url: url.toString(), headers: {link: '<https://api.github.com/repos/Achi1984/meridian/actions/workflows/347821227/runs?page=2>; rel="next"'}})
    },
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/runs/7001/attempts/1/jobs',
      handle: ({url}) => json({
        jobs: [{id: 1, status: 'completed', conclusion: 'success'}]
      }, {url: url.toString()})
    }
  ]);

  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  assert.equal(api.authenticated, true);
  const run = await api.getWorkflowRun({repository: REPOSITORY, runId: 7001});
  assert.equal(run.headSha, HEAD);
  assert.equal(run.baseSha, BASE);
  assert.equal(run.workflowPath, '.github/workflows/backend-safety.yml');
  assert.deepEqual(run.pullRequests, [973]);

  const pull = await api.getPullRequest({repository: REPOSITORY, pullRequest: 973});
  assert.equal(pull.headSha, HEAD);
  assert.equal(pull.baseSha, BASE);
  assert.equal(pull.isFork, false);

  const diff = await api.getPullRequestDiff({
    repository: REPOSITORY,
    pullRequest: 973,
    headSha: HEAD,
    baseSha: BASE
  });
  assert.equal(diff.complete, true);
  assert.equal(diff.truncated, false);
  assert.match(diff.text, /diff --git/);
  assert.equal(calls.filter(call => call.path === '/repos/Achi1984/meridian/pulls/973').length, 3);
  assert.equal(calls.filter(call => call.path === `/repos/Achi1984/meridian/compare/${BASE}...${HEAD}`).length, 2);

  const runsPage = await api.listWorkflowRuns({repository: REPOSITORY, workflowId: 347821227, page: 1});
  assert.equal(runsPage.hasNextPage, true);
  assert.equal(runsPage.items[0].runAttempt, 1);

  const jobsPage = await api.listWorkflowJobs({repository: REPOSITORY, runId: 7001, runAttempt: 1, page: 1});
  assert.equal(jobsPage.hasNextPage, false);
  assert.equal(jobsPage.items[0].status, 'completed');
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('missing historical base and empty pull_request associations remain explicit', async () => {
  const {fetchImpl} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/runs/7001',
      handle: ({url}) => json({
        id: 7001,
        repository: {full_name: REPOSITORY},
        workflow_id: 347821227,
        path: '.github/workflows/backend-safety.yml@refs/heads/main',
        run_attempt: 1,
        run_number: 20,
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD,
        pull_requests: [],
        actor: {login: 'Achi1984'},
        triggering_actor: {login: 'Achi1984'}
      }, {url: url.toString()})
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  const run = await api.getWorkflowRun({repository: REPOSITORY, runId: 7001});
  assert.equal(run.baseSha, null);
  assert.deepEqual(run.pullRequests, []);
});

test('merge/head mismatch blocks immutable diff binding', async () => {
  const {fetchImpl} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/pulls/973',
      handle: ({url, options}) => {
        if (options?.headers?.accept === 'application/vnd.github.v3.diff') {
          return makeResponse({status: 200, body: 'diff --git a/a b/a\n', url: url.toString()});
        }
        return json({
          number: 973,
          state: 'open',
          changed_files: 1,
          head: {sha: 'c'.repeat(40), repo: {full_name: REPOSITORY, fork: false}},
          base: {sha: BASE, repo: {full_name: REPOSITORY}}
        }, {url: url.toString()});
      }
    },
    {
      match: url => url.pathname === `/repos/Achi1984/meridian/compare/${BASE}...${HEAD}`,
      handle: ({url, options}) => {
        if (options?.headers?.accept === 'application/vnd.github.v3.diff') {
          return makeResponse({status: 200, body: 'diff --git a/a b/a\n', url: url.toString()});
        }
        return json(comparePayload(), {url: url.toString()});
      }
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    api.getPullRequestDiff({repository: REPOSITORY, pullRequest: 973, headSha: HEAD, baseSha: BASE}),
    error => error?.code === 'AMBIGUOUS_PULL_REQUEST_HEAD_BASE'
  );
});

test('pr movement race between initial and final metadata reads is rejected', async () => {
  let prReadCount = 0;
  const {fetchImpl} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/pulls/973',
      handle: ({url}) => {
        prReadCount += 1;
        const payload = prReadCount < 2 ? pullPayload() : pullPayload({head: 'c'.repeat(40)});
        return json(payload, {url: url.toString()});
      }
    },
    {
      match: url => url.pathname === `/repos/Achi1984/meridian/compare/${BASE}...${HEAD}`,
      handle: ({url, options}) => {
        if (options?.headers?.accept === 'application/vnd.github.v3.diff') {
          return makeResponse({status: 200, body: 'diff --git a/a b/a\n', url: url.toString()});
        }
        return json(comparePayload(), {url: url.toString()});
      }
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    api.getPullRequestDiff({repository: REPOSITORY, pullRequest: 973, headSha: HEAD, baseSha: BASE}),
    error => error?.code === 'AMBIGUOUS_PULL_REQUEST_MOVED'
  );
});

test('stale attempts are mapped exactly, not normalized', async () => {
  const {fetchImpl} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/workflows/347821227/runs',
      handle: ({url}) => json({
        workflow_runs: [{
          id: 7001,
          repository: {full_name: REPOSITORY},
          workflow_id: 347821227,
          run_number: 20,
          run_attempt: 2,
          pull_requests: [{number: 973}]
        }]
      }, {url: url.toString()})
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  const result = await api.listWorkflowRuns({repository: REPOSITORY, workflowId: 347821227, page: 1});
  assert.equal(result.items[0].runAttempt, 2);
});

test('pagination limits and off-origin pagination links are rejected', async () => {
  const maxPagesApi = createM11CoordinatorGithubReadApi({
    fetchImpl: async () => { throw new Error('not-called'); },
    credentials: credentials(),
    maxPages: 2,
    now: () => NOW_MS
  });
  await assert.rejects(
    maxPagesApi.listWorkflowRuns({repository: REPOSITORY, workflowId: 347821227, page: 3}),
    error => error?.code === 'INVALID_INPUT'
  );

  const {fetchImpl} = makeFetch([
    {
      match: url => url.pathname === '/repos/Achi1984/meridian/actions/workflows/347821227/runs',
      handle: ({url}) => json({workflow_runs: []}, {
        url: url.toString(),
        headers: {link: '<https://evil.example/next>; rel="next"'}
      })
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    api.listWorkflowRuns({repository: REPOSITORY, workflowId: 347821227, page: 1}),
    error => error?.code === 'OFF_ORIGIN_PAGINATION_LINK'
  );
});

test('redirect or off-origin response URL is rejected before payload use', async () => {
  const {fetchImpl} = makeFetch([
    {
      match: () => true,
      handle: () => json({}, {url: 'https://attacker.example/repos/Achi1984/meridian/actions/runs/7001'})
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    api.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'OFF_ORIGIN_RESPONSE'
  );
});

test('rate limits are explicit and malformed payloads fail closed', async () => {
  const {fetchImpl: rateFetch} = makeFetch([
    {
      match: () => true,
      handle: ({url}) => makeResponse({
        status: 403,
        headers: {'x-ratelimit-remaining': '0'},
        body: '{"message":"rate"}',
        url: url.toString()
      })
    }
  ]);
  const rateApi = createM11CoordinatorGithubReadApi({
    fetchImpl: rateFetch,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    rateApi.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'RATE_LIMITED'
  );

  const {fetchImpl: malformedFetch} = makeFetch([
    {
      match: () => true,
      handle: ({url}) => json({repository: {full_name: REPOSITORY}}, {url: url.toString()})
    }
  ]);
  const malformedApi = createM11CoordinatorGithubReadApi({
    fetchImpl: malformedFetch,
    credentials: credentials(),
    now: () => NOW_MS
  });
  await assert.rejects(
    malformedApi.getPullRequest({repository: REPOSITORY, pullRequest: 973}),
    error => error?.code === 'MALFORMED_RESPONSE'
  );
});

test('abort propagates and error messages never leak bearer secrets', async () => {
  const secret = 'Bearer top-secret-value';
  let sawAbort = false;
  const fetchImpl = async (_url, options) => {
    const signal = options?.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        sawAbort = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, {once: true});
      setTimeout(() => {
        resolve(json({}, {url: 'https://api.github.com/repos/Achi1984/meridian/actions/runs/7001'}));
      }, 50);
    });
  };
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials({token: secret}),
    defaultDeadlineMs: 5,
    now: () => NOW_MS
  });
  await assert.rejects(
    api.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => {
      assert.equal(error?.code, 'ABORTED');
      assert.equal(String(error?.message || '').includes(secret), false);
      return true;
    }
  );
  assert.equal(sawAbort, true);
});

test('stalled bodies, caller abort after headers, and chunked limits fail closed', async () => {
  const secret = '******';
  let stalledAborted = false;
  const stalledFetch = async (url, options) => ({
    status: 200,
    url: typeof url === 'string' ? url : url.toString(),
    headers: new Headers({'content-type': 'application/json'}),
    body: new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => {
          stalledAborted = true;
          controller.error(new DOMException('aborted', 'AbortError'));
        }, {once: true});
      }
    })
  });
  const stalledApi = createM11CoordinatorGithubReadApi({
    fetchImpl: stalledFetch,
    credentials: credentials({token: secret}),
    defaultDeadlineMs: 5,
    now: () => NOW_MS
  });
  await assert.rejects(
    stalledApi.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'ABORTED'
  );
  assert.equal(stalledAborted, true);

  let abortedDuringBody = false;
  const abortableFetch = async (url, options) => ({
    status: 200,
    url: typeof url === 'string' ? url : url.toString(),
    headers: new Headers({'content-type': 'application/json'}),
    body: new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"id":7001,'));
        const timer = setTimeout(() => {
          try {
            controller.enqueue(enc.encode('"repository":{"full_name":"Achi1984/meridian"},'));
          } catch {}
        }, 20);
        options.signal.addEventListener('abort', () => {
          abortedDuringBody = true;
          clearTimeout(timer);
          controller.error(new DOMException('aborted', 'AbortError'));
        }, {once: true});
      }
    })
  });
  const abortableApi = createM11CoordinatorGithubReadApi({
    fetchImpl: abortableFetch,
    credentials: credentials({token: secret}),
    now: () => NOW_MS
  });
  const callerAbort = new AbortController();
  setTimeout(() => callerAbort.abort(), 5);
  await assert.rejects(
    abortableApi.getWorkflowRun({repository: REPOSITORY, runId: 7001, signal: callerAbort.signal}),
    error => error?.code === 'ABORTED'
  );
  assert.equal(abortedDuringBody, true);

  const oversizedApi = createM11CoordinatorGithubReadApi({
    fetchImpl: async (url) => makeResponse({
      status: 200,
      url: typeof url === 'string' ? url : url.toString(),
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(runPayload()) + 'x'.repeat(2048)
    }),
    credentials: credentials({token: secret}),
    maxResponseBytes: 1024,
    now: () => NOW_MS
  });
  await assert.rejects(
    oversizedApi.getWorkflowRun({repository: REPOSITORY, runId: 7001}),
    error => error?.code === 'RESPONSE_TOO_LARGE'
  );
});

test('unauthorized failures do not expose credentials and no write methods exist', async () => {
  const secret = 'Bearer never-print-me';
  const {fetchImpl, calls} = makeFetch([
    {
      match: () => true,
      handle: ({url}) => makeResponse({
        status: 401,
        body: '{"message":"bad credentials"}',
        url: url.toString()
      })
    }
  ]);
  const api = createM11CoordinatorGithubReadApi({
    fetchImpl,
    credentials: credentials({token: secret}),
    now: () => NOW_MS
  });
  assert.equal(typeof api.createWorkflowRun, 'undefined');
  await assert.rejects(
    api.getPullRequest({repository: REPOSITORY, pullRequest: 973}),
    error => {
      assert.equal(error?.code, 'UNAUTHORIZED');
      assert.equal(String(error?.message || '').includes(secret), false);
      return true;
    }
  );
  assert.ok(calls.every(call => call.authorization === secret));
  assert.ok(calls.every(call => call.method === 'GET'));
});
