const API_ORIGIN = 'https://api.github.com';
const REPOSITORY = 'Achi1984/meridian';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'meridian-m11-coordinator-read-adapter/1.0';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_DEADLINE_MS = 10000;
const DEFAULT_MAX_PAGES = 20;
const MAX_AUTH_EVIDENCE_TTL_MS = 15 * 60 * 1000;

class ReadApiError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReadApiError';
    this.code = code;
  }
}

function fail(code) {
  throw new ReadApiError(code);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function validateRepository(repository) {
  if (repository !== REPOSITORY) fail('UNAVAILABLE_REPOSITORY');
}

function normalizeWorkflowPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const at = path.indexOf('@');
  return at >= 0 ? path.slice(0, at) : path;
}

function parseLinkHeader(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return [];
  return value.split(',').map(part => {
    const trimmed = part.trim();
    const match = /^<([^>]+)>\s*;\s*rel="([^"]+)"$/.exec(trimmed);
    if (!match) return null;
    return {url: match[1], rel: match[2]};
  });
}

function extractHasNextPage(headers, expectedPrefixPath) {
  const links = parseLinkHeader(headers?.get?.('link'));
  if (links.includes(null)) fail('AMBIGUOUS_PAGINATION');
  let hasNextPage = false;
  for (const link of links) {
    const parsed = new URL(link.url);
    if (parsed.origin !== API_ORIGIN) fail('OFF_ORIGIN_PAGINATION_LINK');
    if (!parsed.pathname.startsWith(expectedPrefixPath)) fail('OFF_PATH_PAGINATION_LINK');
    if (link.rel === 'next') hasNextPage = true;
  }
  return hasNextPage;
}

function detectRateLimit(response) {
  if (!response) return false;
  if (response.status === 429) return true;
  return response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0';
}

function parseTrustedAuthEvidence(evidence, nowMs) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  if (evidence.host !== 'api.github.com' || evidence.scheme !== 'https' || evidence.tls !== true) return false;
  if (typeof evidence.evidenceId !== 'string' || evidence.evidenceId.length < 8) return false;
  if (typeof evidence.principal !== 'string' || evidence.principal.length === 0) return false;
  if (!Number.isSafeInteger(evidence.verifiedAtMs) || evidence.verifiedAtMs <= 0) return false;
  if (evidence.verifiedAtMs > nowMs) return false;
  if (!Number.isSafeInteger(evidence.expiresAtMs) || evidence.expiresAtMs <= evidence.verifiedAtMs) return false;
  if (evidence.expiresAtMs <= nowMs) return false;
  if (evidence.expiresAtMs - evidence.verifiedAtMs > MAX_AUTH_EVIDENCE_TTL_MS) return false;
  return true;
}

function workflowRunPullRequests(payload) {
  if (!Array.isArray(payload?.pull_requests)) return [];
  return payload.pull_requests
    .map(item => item?.number)
    .filter(positiveInteger);
}

function bindAbort(signal, controller) {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, {once: true});
  return () => signal.removeEventListener('abort', onAbort);
}

async function readTextBounded(response, {maxResponseBytes, signal}) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined) {
    if (!/^\d+$/.test(String(length)) || Number(length) > maxResponseBytes) fail('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader?.();
  if (!reader) fail('MALFORMED_RESPONSE');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let size = 0;
  let text = '';
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} };
  signal?.addEventListener?.('abort', cancel, {once: true});
  try {
    try {
      while (true) {
        if (signal?.aborted) fail('ABORTED');
        const {done, value} = await reader.read();
        if (signal?.aborted) fail('ABORTED');
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) fail('RESPONSE_TOO_LARGE');
        text += decoder.decode(value, {stream: true});
      }
      if (signal?.aborted) fail('ABORTED');
      text += decoder.decode();
      if (signal?.aborted) fail('ABORTED');
      return text;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') fail('ABORTED');
      if (error instanceof ReadApiError) throw error;
      fail('UNAVAILABLE');
    }
  } finally {
    signal?.removeEventListener?.('abort', cancel);
    cancel();
    try { reader.releaseLock(); } catch {}
  }
}

function mapWorkflowRun(payload) {
  const pullRequests = workflowRunPullRequests(payload);
  const baseCandidates = Array.isArray(payload?.pull_requests)
    ? payload.pull_requests.map(item => item?.base?.sha).filter(isSha)
    : [];
  const uniqueBases = [...new Set(baseCandidates)];
  return {
    id: payload?.id,
    repository: payload?.repository?.full_name,
    workflowId: payload?.workflow_id,
    workflowPath: normalizeWorkflowPath(payload?.path),
    runAttempt: payload?.run_attempt,
    runNumber: payload?.run_number,
    status: payload?.status,
    conclusion: payload?.conclusion ?? null,
    headSha: payload?.head_sha,
    baseSha: uniqueBases.length === 1 ? uniqueBases[0] : null,
    pullRequests,
    actor: payload?.actor?.login ?? null,
    triggeringActor: payload?.triggering_actor?.login ?? null
  };
}

function mapPullRequest(payload) {
  return {
    repository: payload?.base?.repo?.full_name ?? null,
    number: payload?.number,
    state: payload?.state,
    isFork: payload?.head?.repo?.fork === true,
    headRepository: payload?.head?.repo?.full_name ?? null,
    baseRepository: payload?.base?.repo?.full_name ?? null,
    headSha: payload?.head?.sha ?? null,
    baseSha: payload?.base?.sha ?? null,
    changedFiles: payload?.changed_files
  };
}

function mapWorkflowRuns(payload) {
  if (!Array.isArray(payload?.workflow_runs)) fail('MALFORMED_RESPONSE');
  const extractBaseSha = value => {
    const candidates = Array.isArray(value?.pull_requests)
      ? value.pull_requests.map(item => item?.base?.sha).filter(isSha)
      : [];
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : null;
  };
  return payload.workflow_runs.map(item => ({
    id: item?.id,
    repository: item?.repository?.full_name ?? null,
    workflowId: item?.workflow_id,
    runNumber: item?.run_number,
    runAttempt: item?.run_attempt,
    headSha: item?.head_sha ?? null,
    baseSha: extractBaseSha(item),
    pullRequests: workflowRunPullRequests(item)
  }));
}

function mapWorkflowJobs(payload, {expectedRunId, expectedRunAttempt, workflowId}) {
  if (!Array.isArray(payload?.jobs)) fail('MALFORMED_RESPONSE');
  return payload.jobs.map(item => {
    if (!positiveInteger(item?.run_id) || item.run_id !== expectedRunId
      || !positiveInteger(item?.run_attempt) || item.run_attempt !== expectedRunAttempt) {
      fail('MALFORMED_RESPONSE');
    }
    return ({
    id: item?.id,
    name: item?.name ?? null,
    runId: item.run_id,
    runAttempt: item.run_attempt,
    workflowId,
    status: item?.status,
    conclusion: item?.conclusion ?? null,
    steps: Array.isArray(item?.steps)
      ? item.steps.map(step => ({
        name: step?.name ?? null,
        status: step?.status ?? null,
        conclusion: step?.conclusion ?? null
      }))
      : null
    });
  });
}

function extractCompareHeadSha(comparePayload) {
  if (!Array.isArray(comparePayload?.commits) || comparePayload.commits.length === 0) return null;
  const tail = comparePayload.commits[comparePayload.commits.length - 1];
  return isSha(tail?.sha) ? tail.sha : null;
}

function validChangedPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && path.isWellFormed()
    && Buffer.byteLength(path, 'utf8') <= 512;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createM11CoordinatorGithubReadApi({
  fetchImpl = globalThis.fetch,
  credentials,
  now = Date.now,
  defaultDeadlineMs = DEFAULT_DEADLINE_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  maxPages = DEFAULT_MAX_PAGES
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  if (!Number.isSafeInteger(defaultDeadlineMs) || defaultDeadlineMs < 1) {
    throw new Error('defaultDeadlineMs must be a positive integer');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024) {
    throw new Error('maxResponseBytes must be an integer >= 1024');
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error('maxPages must be a positive integer');
  }
  if (!credentials || typeof credentials.getAuthorizationHeader !== 'function') {
    throw new Error('credentials.getAuthorizationHeader is required');
  }

  let authInvalidatedAtMs = null;

  function readTrustedAuthEvidence() {
    const evidence = typeof credentials.getTrustedAuthEvidence === 'function'
      ? credentials.getTrustedAuthEvidence()
      : credentials.trustedAuthEvidence;
    if (!parseTrustedAuthEvidence(evidence, now())) return null;
    if (authInvalidatedAtMs !== null && evidence.verifiedAtMs <= authInvalidatedAtMs) return null;
    return evidence;
  }

  function ensureTrustedAuthentication() {
    if (!readTrustedAuthEvidence()) fail('UNAUTHENTICATED_TRANSPORT_EVIDENCE_REQUIRED');
  }

  function buildAuthEvidenceSnapshot() {
    const evidence = readTrustedAuthEvidence();
    if (!evidence) return null;
    return Object.freeze({
      evidenceId: evidence.evidenceId,
      principal: evidence.principal,
      host: evidence.host,
      scheme: evidence.scheme,
      tls: evidence.tls,
      verifiedAtMs: evidence.verifiedAtMs,
      expiresAtMs: evidence.expiresAtMs
    });
  }

  async function getJson({path, query = null, signal, accept = 'application/vnd.github+json'}) {
    const requestScope = await request({path, query, signal, accept});
    try {
      const text = await readTextBounded(requestScope.response, {
        maxResponseBytes,
        signal: requestScope.requestSignal
      });
      ensureTrustedAuthentication();
      if (requestScope.requestSignal.aborted) fail('ABORTED');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        fail('MALFORMED_RESPONSE');
      }
      ensureTrustedAuthentication();
      if (requestScope.requestSignal.aborted) fail('ABORTED');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('MALFORMED_RESPONSE');
      if (requestScope.requestSignal.aborted) fail('ABORTED');
      return {payload: parsed, headers: requestScope.response.headers};
    } finally {
      requestScope.finalize();
    }
  }

  async function getText({path, query = null, signal, accept}) {
    const requestScope = await request({path, query, signal, accept});
    try {
      const text = await readTextBounded(requestScope.response, {
        maxResponseBytes,
        signal: requestScope.requestSignal
      });
      ensureTrustedAuthentication();
      if (requestScope.requestSignal.aborted) fail('ABORTED');
      return {text, headers: requestScope.response.headers};
    } finally {
      requestScope.finalize();
    }
  }

  async function request({path, query, signal, accept}) {
    ensureTrustedAuthentication();
    if (typeof path !== 'string' || !path.startsWith('/repos/Achi1984/meridian/')) {
      fail('UNAVAILABLE_PATH');
    }
    const url = new URL(API_ORIGIN + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const authorization = credentials.getAuthorizationHeader();
    if (typeof authorization !== 'string' || authorization.trim().length === 0) fail('UNAUTHORIZED');
    const controller = new AbortController();
    const unbind = bindAbort(signal, controller);
    const timer = setTimeout(() => controller.abort(), defaultDeadlineMs);
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      unbind();
    };
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: {
          accept,
          authorization,
          'user-agent': USER_AGENT,
          'x-github-api-version': API_VERSION
        }
      });
    } catch (error) {
      finalize();
      if (controller.signal.aborted || error?.name === 'AbortError') fail('ABORTED');
      fail('UNAVAILABLE');
    }

    const responseUrl = response?.url;
    if (typeof responseUrl !== 'string' || responseUrl.length === 0) {
      finalize();
      fail('UNAVAILABLE');
    }
    const observed = new URL(responseUrl);
    if (observed.origin !== API_ORIGIN || observed.pathname !== path) {
      finalize();
      fail('OFF_ORIGIN_RESPONSE');
    }
    if (response.status === 401 || response.status === 403) {
      authInvalidatedAtMs = now();
      if (detectRateLimit(response)) {
        finalize();
        fail('RATE_LIMITED');
      }
      finalize();
      fail('UNAUTHORIZED');
    }
    if (detectRateLimit(response)) {
      finalize();
      fail('RATE_LIMITED');
    }
    if (response.status < 200 || response.status >= 300) {
      finalize();
      fail('UNAVAILABLE');
    }

    return {response, requestSignal: controller.signal, finalize};
  }

  return Object.freeze({
    get authenticated() {
      return readTrustedAuthEvidence() !== null;
    },
    get authenticationEvidence() {
      return buildAuthEvidenceSnapshot();
    },

    async getWorkflowRun({repository, runId, signal}) {
      validateRepository(repository);
      if (!positiveInteger(runId)) fail('INVALID_INPUT');
      const {payload} = await getJson({path: `/repos/Achi1984/meridian/actions/runs/${runId}`, signal});
      const mapped = mapWorkflowRun(payload);
      if (!positiveInteger(mapped.id) || mapped.id !== runId) fail('MALFORMED_RESPONSE');
      if (mapped.repository !== REPOSITORY || !positiveInteger(mapped.workflowId)
        || !positiveInteger(mapped.runAttempt) || !positiveInteger(mapped.runNumber)
        || typeof mapped.status !== 'string' || (!isSha(mapped.headSha) && mapped.headSha !== null)
        || (mapped.baseSha !== null && !isSha(mapped.baseSha))) {
        fail('MALFORMED_RESPONSE');
      }
      return mapped;
    },

    async getPullRequest({repository, pullRequest, signal}) {
      validateRepository(repository);
      if (!positiveInteger(pullRequest)) fail('INVALID_INPUT');
      const {payload} = await getJson({path: `/repos/Achi1984/meridian/pulls/${pullRequest}`, signal});
      const mapped = mapPullRequest(payload);
      if (mapped.repository !== REPOSITORY || mapped.number !== pullRequest
        || typeof mapped.state !== 'string' || typeof mapped.isFork !== 'boolean'
        || (mapped.headSha !== null && !isSha(mapped.headSha))
        || (mapped.baseSha !== null && !isSha(mapped.baseSha))) {
        fail('MALFORMED_RESPONSE');
      }
      return mapped;
    },

    async getPullRequestDiff({repository, pullRequest, headSha, baseSha, signal}) {
      validateRepository(repository);
      if (!positiveInteger(pullRequest) || !isSha(headSha) || !isSha(baseSha)) fail('INVALID_INPUT');
      const initialPrResult = await getJson({path: `/repos/Achi1984/meridian/pulls/${pullRequest}`, signal});
      const initialPr = mapPullRequest(initialPrResult.payload);
      if (initialPr.number !== pullRequest || initialPr.repository !== REPOSITORY) fail('MALFORMED_RESPONSE');
      if (initialPr.headSha !== headSha || initialPr.baseSha !== baseSha) {
        fail('AMBIGUOUS_PULL_REQUEST_HEAD_BASE');
      }

      const comparePath = `/repos/Achi1984/meridian/compare/${baseSha}...${headSha}`;
      const [compareResult, diffResult] = await Promise.all([
        getJson({
          path: comparePath,
          query: {page: 1, per_page: 100},
          signal
        }),
        getText({
          path: comparePath,
          query: {page: 1, per_page: 100},
          signal,
          accept: 'application/vnd.github.v3.diff'
        })
      ]);

      const finalPrResult = await getJson({path: `/repos/Achi1984/meridian/pulls/${pullRequest}`, signal});
      const finalPr = mapPullRequest(finalPrResult.payload);
      if (finalPr.number !== pullRequest || finalPr.repository !== REPOSITORY) fail('MALFORMED_RESPONSE');
      if (finalPr.headSha !== headSha || finalPr.baseSha !== baseSha
        || finalPr.headSha !== initialPr.headSha || finalPr.baseSha !== initialPr.baseSha) {
        fail('AMBIGUOUS_PULL_REQUEST_MOVED');
      }

      const compare = compareResult.payload;
      const compareBase = compare?.base_commit?.sha ?? null;
      const compareHead = extractCompareHeadSha(compare);
      if (compareBase !== baseSha || compareHead !== headSha) fail('AMBIGUOUS_COMPARE_HEAD_BASE');

      let complete = true;
      const hasNext = extractHasNextPage(
        compareResult.headers,
        comparePath
      );
      if (hasNext) complete = false;
      if (!Array.isArray(compare?.files)) complete = false;
      if (!nonNegativeSafeInteger(finalPr.changedFiles)) complete = false;
      if (Array.isArray(compare?.files) && nonNegativeSafeInteger(finalPr.changedFiles)
        && finalPr.changedFiles !== compare.files.length) complete = false;
      if (Array.isArray(compare?.files) && compare.files.some(file => typeof file?.patch !== 'string')) {
        complete = false;
      }
      const changedPaths = [];
      if (Array.isArray(compare?.files)) {
        for (const file of compare.files) {
          if (!validChangedPath(file?.filename)) {
            complete = false;
            break;
          }
          if (file?.status === 'renamed' && !validChangedPath(file?.previous_filename)) {
            complete = false;
            break;
          }
          if (changedPaths.includes(file.filename)) {
            complete = false;
            break;
          }
          changedPaths.push(file.filename);
        }
      }
      if (!positiveInteger(compare?.total_commits) || compare.total_commits > 250) complete = false;
      if (typeof compare?.merge_base_commit?.sha !== 'string' || compare.merge_base_commit.sha !== baseSha) {
        complete = false;
      }
      if (!Array.isArray(compare?.files) || changedPaths.length !== compare.files.length) complete = false;
      if (!nonNegativeSafeInteger(finalPr.changedFiles)
        || changedPaths.length !== finalPr.changedFiles) complete = false;
      if (changedPaths.length === 0) complete = false;

      const text = diffResult.text;
      if (typeof text !== 'string' || text.length === 0) complete = false;
      return {
        headSha,
        baseSha,
        complete,
        truncated: !complete,
        text: typeof text === 'string' ? text : '',
        changedPaths: complete ? Object.freeze(changedPaths) : Object.freeze([])
      };
    },

    async listWorkflowRuns({repository, workflowId, pullRequest, headSha, page, signal}) {
      validateRepository(repository);
      if (!positiveInteger(workflowId) || !positiveInteger(page) || page > maxPages
        || (pullRequest !== undefined && !positiveInteger(pullRequest))
        || (headSha !== undefined && !isSha(headSha))) fail('INVALID_INPUT');
      const query = {event: 'pull_request', page, per_page: 100};
      if (headSha !== undefined) query.head_sha = headSha;
      const {payload, headers} = await getJson({
        path: `/repos/Achi1984/meridian/actions/workflows/${workflowId}/runs`,
        query,
        signal
      });
      const hasNextPage = extractHasNextPage(
        headers,
        `/repos/Achi1984/meridian/actions/workflows/${workflowId}/runs`
      );
      if (!Number.isSafeInteger(payload?.total_count) || payload.total_count < 0) fail('MALFORMED_RESPONSE');
      const items = mapWorkflowRuns(payload);
      return {items, hasNextPage, totalCount: payload.total_count};
    },

    async listWorkflowJobs({repository, runId, runAttempt, page, signal}) {
      validateRepository(repository);
      if (!positiveInteger(runId) || !positiveInteger(runAttempt) || !positiveInteger(page) || page > maxPages) {
        fail('INVALID_INPUT');
      }
      const [runResult, jobsResult] = await Promise.all([
        getJson({
          path: `/repos/Achi1984/meridian/actions/runs/${runId}/attempts/${runAttempt}`,
          signal
        }),
        getJson({
          path: `/repos/Achi1984/meridian/actions/runs/${runId}/attempts/${runAttempt}/jobs`,
          query: {page, per_page: 100},
          signal
        })
      ]);
      const runPayload = runResult.payload;
      const runPath = normalizeWorkflowPath(runPayload?.path);
      if (!positiveInteger(runPayload?.id) || runPayload.id !== runId
        || !positiveInteger(runPayload?.run_attempt) || runPayload.run_attempt !== runAttempt
        || runPayload?.repository?.full_name !== REPOSITORY
        || !positiveInteger(runPayload?.workflow_id)
        || typeof runPath !== 'string' || runPath.length === 0) {
        fail('MALFORMED_RESPONSE');
      }
      if (!Number.isSafeInteger(jobsResult.payload?.total_count) || jobsResult.payload.total_count < 0) {
        fail('MALFORMED_RESPONSE');
      }
      const hasNextPage = extractHasNextPage(
        jobsResult.headers,
        `/repos/Achi1984/meridian/actions/runs/${runId}/attempts/${runAttempt}/jobs`
      );
      const items = mapWorkflowJobs(jobsResult.payload, {
        expectedRunId: runId,
        expectedRunAttempt: runAttempt,
        workflowId: runPayload.workflow_id
      });
      if (items.some(item => !positiveInteger(item.id)
        || typeof item.name !== 'string' || item.name.length === 0
        || !positiveInteger(item.runId) || item.runId !== runId
        || !positiveInteger(item.runAttempt) || item.runAttempt !== runAttempt
        || item.workflowId !== runPayload.workflow_id
        || !Array.isArray(item.steps)
        || item.steps.some(step => typeof step?.name !== 'string' || step.name.length === 0
          || typeof step?.status !== 'string' || step.status.length === 0
          || typeof step?.conclusion !== 'string' || step.conclusion.length === 0))) {
        fail('MALFORMED_RESPONSE');
      }
      return {items, hasNextPage, totalCount: jobsResult.payload.total_count};
    }
  });
}
