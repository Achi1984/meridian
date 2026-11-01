import {appendFile, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = 'Achi1984/meridian';
const WAITING = new Set(['deployment_queued', 'deployment_in_progress']);
const fail = code => { throw new Error(code); };

export function publicationContext({eventName, event, workflowSha, expectedSha, previousSha}) {
  if (!SHA.test(workflowSha ?? '') || workflowSha === '0'.repeat(40)) fail('INVALID_WORKFLOW_SHA');
  if (eventName === 'push') {
    if (event.ref !== 'refs/heads/main' || event.forced || event.created || event.deleted ||
        event.after !== workflowSha) fail('INVALID_PUSH_CONTEXT');
    expectedSha = workflowSha;
    previousSha = event.before;
  } else if (eventName !== 'workflow_dispatch') fail('UNSUPPORTED_EVENT');
  if (!SHA.test(expectedSha ?? '') || expectedSha !== workflowSha) fail('EXPECTED_SHA_MISMATCH');
  if (!SHA.test(previousSha ?? '') || previousSha === '0'.repeat(40) || previousSha === expectedSha) {
    fail('INVALID_PREVIOUS_DEPLOYMENT');
  }
  return {expectedSha, previousSha};
}

// Remote reads only. A readiness result is not proof that Pages' internal
// admission lock has cleared, nor authority to retry/cancel a deployment.
export async function checkPublication({expectedSha, previousSha, phase = 'before', get,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  deadlineMs = 300_000, intervalMs = 10_000}) {
  if (!SHA.test(expectedSha ?? '') || !SHA.test(previousSha ?? '') ||
      [expectedSha, previousSha].includes('0'.repeat(40)) || expectedSha === previousSha) fail('INVALID_SHA');
  if (!['before', 'after'].includes(phase)) fail('INVALID_PHASE');
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 300_000 ||
      !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 10_000) fail('INVALID_BUDGET');
  const end = now() + deadlineMs;
  async function request(path) {
    const remaining = end - now();
    if (remaining <= 0) fail('READINESS_TIMEOUT');
    const response = await get(path, Math.min(10_000, remaining));
    if (now() >= end) fail('READINESS_TIMEOUT');
    return response;
  }
  async function assertMain() {
    const r = await request(`/repos/${REPOSITORY}/git/ref/heads/main`);
    if (r.status !== 200 || r.data?.object?.sha !== expectedSha) fail('MAIN_SUPERSEDED_OR_UNKNOWN');
  }
  async function deployment(sha, allowMissing) {
    const r = await request(`/repos/${REPOSITORY}/pages/deployments/${sha}`);
    if (r.status === 404 && allowMissing) return 'absent';
    if (r.status !== 200 || typeof r.data?.status !== 'string') fail('DEPLOYMENT_STATUS_UNKNOWN');
    if (r.data.status === 'succeed') return 'succeed';
    if (WAITING.has(r.data.status)) return 'waiting';
    fail('DEPLOYMENT_NOT_SUCCESSFUL');
  }
  await assertMain();
  const ancestry = await request(`/repos/${REPOSITORY}/compare/${previousSha}...${expectedSha}`);
  if (ancestry.status !== 200 || ancestry.data?.status !== 'ahead' ||
      ancestry.data?.merge_base_commit?.sha !== previousSha) fail('PREVIOUS_NOT_ANCESTOR');
  while (true) {
    await assertMain();
    const current = await deployment(expectedSha, phase === 'before');
    if (current === 'succeed') {
      await assertMain();
      return phase === 'after' ? 'VERIFIED' : 'ALREADY_DEPLOYED';
    }
    if (phase === 'before' && current === 'absent') {
      const previous = await deployment(previousSha, false);
      if (previous === 'succeed') {
        // Reconcile once more just before allowing the single deploy step.
        await assertMain();
        const rechecked = await deployment(expectedSha, true);
        if (rechecked === 'absent') return 'READY';
        if (rechecked === 'succeed') return 'ALREADY_DEPLOYED';
      }
    }
    const remaining = end - now();
    if (remaining <= 0) fail('READINESS_TIMEOUT');
    await sleep(Math.min(intervalMs, remaining));
  }
}

export function githubReader(token, fetchImpl = fetch) {
  if (!token) fail('MISSING_JOB_TOKEN');
  return async (path, timeoutMs) => {
    const prefix = `/repos/${REPOSITORY}/`;
    const suffix = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    if (suffix !== 'git/ref/heads/main' &&
        !/^pages\/deployments\/[0-9a-f]{40}$/.test(suffix) &&
        !/^compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}$/.test(suffix)) {
      fail('UNEXPECTED_API_PATH');
    }
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'}
    });
    let data;
    try { data = await response.json(); } catch { fail('INVALID_API_RESPONSE'); }
    return {status: response.status, data};
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.GITHUB_REPOSITORY !== REPOSITORY) fail('WRONG_REPOSITORY');
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const context = publicationContext({eventName: process.env.GITHUB_EVENT_NAME, event,
      workflowSha: process.env.GITHUB_SHA, expectedSha: process.env.EXPECTED_SHA,
      previousSha: process.env.PREVIOUS_DEPLOYMENT_SHA});
    const disposition = await checkPublication({...context, phase: process.env.PUBLICATION_PHASE ?? 'before',
      get: githubReader(process.env.GITHUB_TOKEN)});
    console.log(`Pages publication readiness: ${disposition}`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `disposition=${disposition}\n`);
  } catch (error) {
    // No token, response bodies or request headers in logs.
    const reason = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'REQUEST_FAILED';
    console.error(`Pages publication readiness blocked: ${reason}; reconcile exact main and deployment state.`);
    process.exitCode = 1;
  }
}
