import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const REPOSITORY = 'Achi1984/meridian';
const RELEASE_SAFETY_WORKFLOW_ID = 347821227;
const RELEASE_SAFETY_WORKFLOW_PATH = '.github/workflows/backend-safety.yml';
const MAX_PAGES = 20;
const MAX_ITEMS = 500;
const MAX_RUNTIME_MS = 10000;
const MAX_DIFF_BYTES = 262144;
const COLLECTION_TTL_MS = 300000;
const MAX_AUTH_EVIDENCE_TTL_MS = 900000;
const REQUIRED_JOBS = Object.freeze([
  Object.freeze({name: 'syntax', required: true, requiredSteps: Object.freeze([
    'Research and auth regression tests'
  ])})
]);
const OPTIONAL_JOBS = Object.freeze([]);
const verifiedCollections = new WeakSet();
const TIMED_OUT = Symbol('timed-out');

export const isVerifiedCollection = (value, timestamp = Date.now()) => value !== null
  && typeof value === 'object' && verifiedCollections.has(value)
  && Number.isSafeInteger(timestamp) && timestamp >= value.collectedAt && timestamp < value.expiresAt;

function fail(reason) {
  return Object.freeze({status: 'BLOCKED', reason});
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}

function validPage(page) {
  return page !== null && typeof page === 'object' && !Array.isArray(page)
    && Array.isArray(page.items) && typeof page.hasNextPage === 'boolean'
    && Number.isSafeInteger(page.totalCount) && page.totalCount >= 0
    && page.totalCount <= MAX_ITEMS && page.items.length <= MAX_ITEMS;
}

function validAuthenticationEvidence(value, timestamp) {
  const keys = ['evidenceId', 'principal', 'host', 'scheme', 'tls', 'verifiedAtMs', 'expiresAtMs'];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value)
    && hasExactKeys(value, keys)
    && typeof value.evidenceId === 'string' && value.evidenceId.length >= 8
    && typeof value.principal === 'string' && value.principal.length > 0
    && value.host === 'api.github.com' && value.scheme === 'https' && value.tls === true
    && Number.isSafeInteger(value.verifiedAtMs) && value.verifiedAtMs > 0
    && value.verifiedAtMs <= timestamp
    && Number.isSafeInteger(value.expiresAtMs) && value.expiresAtMs > timestamp
    && value.expiresAtMs - value.verifiedAtMs <= MAX_AUTH_EVIDENCE_TTL_MS;
}

function sameAuthenticationEvidence(left, right) {
  return left !== null && typeof left === 'object' && right !== null && typeof right === 'object'
    && left.evidenceId === right.evidenceId && left.principal === right.principal
    && left.host === right.host && left.scheme === right.scheme && left.tls === right.tls
    && left.verifiedAtMs === right.verifiedAtMs && left.expiresAtMs === right.expiresAtMs;
}

function authenticationEvidenceMatches(api, expected, timestamp) {
  try {
    const current = api.authenticationEvidence;
    return api.authenticated === true && validAuthenticationEvidence(current, timestamp)
      && sameAuthenticationEvidence(expected, current);
  } catch {
    return false;
  }
}

async function readWithAuthenticationEvidence(api, expected, now, operation) {
  if (!authenticationEvidenceMatches(api, expected, now())) {
    throw new Error('AUTHENTICATION_EVIDENCE_CHANGED_OR_EXPIRED');
  }
  const result = await operation();
  if (!authenticationEvidenceMatches(api, expected, now())) {
    throw new Error('AUTHENTICATION_EVIDENCE_CHANGED_OR_EXPIRED');
  }
  return result;
}

async function readAllPages(readPage, maxPages, deadline) {
  const items = [];
  let totalCount = null;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    if (performance.now() > deadline) return null;
    const remaining = Math.max(0, deadline - performance.now());
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, remaining);
    });
    let page;
    try {
      page = await Promise.race([readPage(pageNumber, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (page === TIMED_OUT) return null;
    if (!validPage(page) || (totalCount !== null && page.totalCount !== totalCount)
      || items.length + page.items.length > MAX_ITEMS) return null;
    totalCount = page.totalCount;
    if (items.length + page.items.length > totalCount) return null;
    items.push(...page.items);
    if (!page.hasNextPage) return items.length === totalCount ? items : null;
  }
  return null;
}

function collectionDigest(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function validateWorkflowJobs(jobs, runIdentity, policy = {required: REQUIRED_JOBS, optional: OPTIONAL_JOBS}) {
  if (!Array.isArray(jobs) || !runIdentity || !Number.isSafeInteger(runIdentity.runId)
    || !Number.isSafeInteger(runIdentity.runAttempt) || !Number.isSafeInteger(runIdentity.workflowId)
    || !policy || !Array.isArray(policy.required) || !Array.isArray(policy.optional)) return false;
  const allowed = new Map();
  for (const [entries, required] of [[policy.required, true], [policy.optional, false]]) {
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || entry.name.length === 0 || allowed.has(entry.name)) return false;
      allowed.set(entry.name, {required, requiredSteps: entry.requiredSteps || []});
    }
  }
  const seen = new Set();
  for (const job of jobs) {
    if (!job || !positive(job.id) || typeof job.name !== 'string' || seen.has(job.name)
      || !allowed.has(job.name) || job.runId !== runIdentity.runId
      || job.runAttempt !== runIdentity.runAttempt || job.workflowId !== runIdentity.workflowId
      || job.status !== 'completed') return false;
    seen.add(job.name);
    const rule = allowed.get(job.name);
    if (job.conclusion !== 'success'
      && !(rule.required === false && job.conclusion === 'skipped')) return false;
    if (!Array.isArray(job.steps) || rule.requiredSteps.some(name => {
      const matches = job.steps.filter(step => step?.name === name);
      return matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success';
    })) return false;
  }
  return policy.required.every(job => seen.has(job.name));
}

export async function collectExactPair({hint, config, api, now = Date.now}) {
  if (!config || config.enabled !== true) return fail('DISABLED');
  if (!hasExactKeys(config, ['enabled', 'repository', 'pullRequests', 'actors', 'startsAt',
    'expiresAt', 'maxPages', 'maxRuntimeMs'])) return fail('INVALID_CONFIG');
  if (config.repository !== REPOSITORY || !Array.isArray(config.pullRequests)
    || !Array.isArray(config.actors) || config.pullRequests.length === 0 || config.pullRequests.length > 3
    || new Set(config.pullRequests).size !== config.pullRequests.length || config.actors.length === 0
    || !config.pullRequests.every(positive) || !config.actors.every(actor => typeof actor === 'string'
      && actor.length > 0 && actor.length <= 100)
    || !Number.isSafeInteger(config.startsAt) || !Number.isSafeInteger(config.expiresAt)
    || config.startsAt <= 0 || config.expiresAt <= config.startsAt
    || config.expiresAt - config.startsAt > 86400000
    || !Number.isSafeInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > MAX_PAGES
    || !Number.isSafeInteger(config.maxRuntimeMs) || config.maxRuntimeMs < 1
    || config.maxRuntimeMs > MAX_RUNTIME_MS) return fail('INVALID_CONFIG');
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < config.startsAt || timestamp >= config.expiresAt) {
    return fail('OUTSIDE_PILOT_WINDOW');
  }
  if (!hasExactKeys(hint, ['eventName', 'repository', 'workflowRunId', 'workflowRunAttempt'])
    || hint.eventName !== 'workflow_run' || hint.repository !== REPOSITORY
    || !positive(hint.workflowRunId) || !positive(hint.workflowRunAttempt)) return fail('INVALID_EVENT_HINT');
  if (!api || api.authenticated !== true || typeof api.getWorkflowRun !== 'function'
    || typeof api.getPullRequest !== 'function' || typeof api.getPullRequestDiff !== 'function'
    || typeof api.listWorkflowRuns !== 'function'
    || typeof api.listWorkflowJobs !== 'function') return fail('AUTHENTICATED_READ_API_REQUIRED');
  let initialAuthenticationEvidence;
  try {
    initialAuthenticationEvidence = api.authenticationEvidence;
  } catch {
    return fail('AUTHENTICATED_READ_API_REQUIRED');
  }
  if (!validAuthenticationEvidence(initialAuthenticationEvidence, timestamp)) {
    return fail('AUTHENTICATED_READ_API_REQUIRED');
  }

  const deadline = performance.now() + config.maxRuntimeMs;
  try {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, Math.max(0, deadline - performance.now()));
    });
    let run;
    try {
      run = await Promise.race([
        readWithAuthenticationEvidence(api, initialAuthenticationEvidence, now, () =>
          api.getWorkflowRun({repository: REPOSITORY, runId: hint.workflowRunId, signal: controller.signal})),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (run === TIMED_OUT) return fail('TIME_BUDGET_EXHAUSTED');
    if (!run || run.id !== hint.workflowRunId || run.repository !== REPOSITORY
      || run.workflowId !== RELEASE_SAFETY_WORKFLOW_ID
      || run.workflowPath !== RELEASE_SAFETY_WORKFLOW_PATH
      || run.runAttempt !== hint.workflowRunAttempt || !positive(run.runNumber)
      || !config.actors.includes(run.actor) || !config.actors.includes(run.triggeringActor)
      || !sha(run.headSha) || !sha(run.baseSha)) return fail('RUN_IDENTITY_OR_ACTOR_MISMATCH');
    if (!Array.isArray(run.pullRequests) || run.pullRequests.length !== 1
      || !positive(run.pullRequests[0]) || !config.pullRequests.includes(run.pullRequests[0])) {
      return fail('PULL_REQUEST_NOT_ALLOWLISTED');
    }

    const pullRequestNumber = run.pullRequests[0];
    const prController = new AbortController();
    let prTimer;
    const prTimeout = new Promise(resolve => {
      prTimer = setTimeout(() => {
        prController.abort();
        resolve(TIMED_OUT);
      }, Math.max(0, deadline - performance.now()));
    });
    let pr;
    try {
      pr = await Promise.race([
        readWithAuthenticationEvidence(api, initialAuthenticationEvidence, now, () =>
          api.getPullRequest({
            repository: REPOSITORY, pullRequest: pullRequestNumber, signal: prController.signal
          })),
        prTimeout
      ]);
    } finally {
      clearTimeout(prTimer);
    }
    if (pr === TIMED_OUT) return fail('TIME_BUDGET_EXHAUSTED');
    if (!pr || pr.repository !== REPOSITORY || pr.number !== pullRequestNumber
      || pr.state !== 'open' || pr.isFork !== false || pr.headRepository !== REPOSITORY
      || pr.baseRepository !== REPOSITORY || pr.headSha !== run.headSha || pr.baseSha !== run.baseSha) {
      return fail('PULL_REQUEST_PAIR_OR_FORK_MISMATCH');
    }

    const diffController = new AbortController();
    let diffTimer;
    const diffTimeout = new Promise(resolve => {
      diffTimer = setTimeout(() => {
        diffController.abort();
        resolve(TIMED_OUT);
      }, Math.max(0, deadline - performance.now()));
    });
    let diff;
    try {
      diff = await Promise.race([
        readWithAuthenticationEvidence(api, initialAuthenticationEvidence, now, () =>
          api.getPullRequestDiff({
            repository: REPOSITORY,
            pullRequest: pullRequestNumber,
            headSha: run.headSha,
            baseSha: run.baseSha,
            signal: diffController.signal
          })),
        diffTimeout
      ]);
    } finally {
      clearTimeout(diffTimer);
    }
    if (diff === TIMED_OUT) return fail('TIME_BUDGET_EXHAUSTED');
    if (!diff || diff.headSha !== run.headSha || diff.baseSha !== run.baseSha
      || diff.complete !== true || diff.truncated !== false || typeof diff.text !== 'string'
      || Buffer.byteLength(diff.text, 'utf8') === 0 || Buffer.byteLength(diff.text, 'utf8') > MAX_DIFF_BYTES) {
      return fail('DIFF_UNAVAILABLE_OR_INCOMPLETE');
    }

    const runs = await readAllPages((page, signal) => readWithAuthenticationEvidence(
      api, initialAuthenticationEvidence, now, () => api.listWorkflowRuns({
        repository: REPOSITORY,
        workflowId: RELEASE_SAFETY_WORKFLOW_ID,
        pullRequest: pullRequestNumber,
        page,
        signal
      })
    ), config.maxPages, deadline);
    if (!runs || runs.length === 0) return fail('RUN_PAGINATION_INCOMPLETE');
    const associatedRuns = runs.filter(item => item && item.repository === REPOSITORY
      && item.workflowId === RELEASE_SAFETY_WORKFLOW_ID
      && Array.isArray(item.pullRequests) && item.pullRequests.includes(pullRequestNumber));
    if (associatedRuns.length === 0) return fail('CURRENT_RUN_NOT_FOUND');
    const latestRunNumber = Math.max(...associatedRuns.map(item => item.runNumber).filter(positive));
    if (!positive(latestRunNumber)) return fail('CURRENT_RUN_UNKNOWN');
    const latest = associatedRuns.filter(item => item.runNumber === latestRunNumber);
    if (latest.length !== 1 || latest[0].id !== run.id || latest[0].runAttempt !== run.runAttempt) {
      return fail('STALE_OR_AMBIGUOUS_CURRENT_RUN');
    }
    if (performance.now() > deadline) return fail('TIME_BUDGET_EXHAUSTED');

    const jobs = await readAllPages((page, signal) => readWithAuthenticationEvidence(
      api, initialAuthenticationEvidence, now, () => api.listWorkflowJobs({
        repository: REPOSITORY,
        runId: run.id,
        runAttempt: run.runAttempt,
        page,
        signal
      })
    ), config.maxPages, deadline);
    if (!jobs || jobs.length === 0) return fail('JOB_PAGINATION_INCOMPLETE');
    if (!validateWorkflowJobs(jobs, {
      runId: run.id,
      runAttempt: run.runAttempt,
      workflowId: run.workflowId
    })) return fail('CI_JOB_INVENTORY_OR_IDENTITY_MISMATCH');
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return fail(run.conclusion === 'action_required' ? 'ACTION_REQUIRED' : 'CI_NOT_SUCCESSFUL');
    }
    if (performance.now() > deadline) return fail('TIME_BUDGET_EXHAUSTED');
    const finalTimestamp = now();
    let finalAuthenticationEvidence;
    try {
      finalAuthenticationEvidence = api.authenticationEvidence;
    } catch {
      return fail('AUTHENTICATION_EVIDENCE_UNAVAILABLE');
    }
    if (!Number.isSafeInteger(finalTimestamp)
      || !validAuthenticationEvidence(finalAuthenticationEvidence, finalTimestamp)
      || !sameAuthenticationEvidence(initialAuthenticationEvidence, finalAuthenticationEvidence)
      || api.authenticated !== true) return fail('AUTHENTICATION_EVIDENCE_CHANGED_OR_EXPIRED');

    const logicalActionKey = collectionDigest([
      REPOSITORY, pullRequestNumber, run.headSha, run.baseSha, 'CI_TO_INDEPENDENT_REVIEW'
    ]);
    const executionKey = collectionDigest([
      logicalActionKey, run.workflowId, run.id, run.runAttempt
    ]);
    const data = Object.freeze({
      status: 'READY',
      repository: REPOSITORY,
      pullRequest: pullRequestNumber,
      headSha: run.headSha,
      baseSha: run.baseSha,
      runId: run.id,
      runAttempt: run.runAttempt,
      runNumber: run.runNumber,
      workflowId: run.workflowId,
      workflowPath: run.workflowPath,
      actor: run.actor,
      triggeringActor: run.triggeringActor,
      selectionRevision: run.runNumber,
      collectedAt: timestamp,
      expiresAt: Math.min(config.expiresAt, timestamp + COLLECTION_TTL_MS,
        initialAuthenticationEvidence.expiresAtMs),
      provenance: Object.freeze({
        kind: 'AUTHENTICATED_READ_ADAPTER',
        workflowId: run.workflowId,
        runId: run.id,
        runAttempt: run.runAttempt,
        authenticationEvidence: initialAuthenticationEvidence
      }),
      diff: diff.text,
      diffDigest: createHash('sha256').update(diff.text).digest('hex'),
      actionKey: logicalActionKey,
      executionKey
    });
    verifiedCollections.add(data);
    return data;
  } catch {
    return fail('AUTHORITATIVE_READ_FAILED');
  }
}
