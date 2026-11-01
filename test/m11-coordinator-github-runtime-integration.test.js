import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay, setImmediate as tick} from 'node:timers/promises';
import {createFakeGithub} from './fixtures/m11-coordinator-github-runtime/fake-github.mjs';
import {createM11CoordinatorGithubStateTransport} from '../scripts/autonomy/m11-coordinator-github-state-transport.mjs';
import {createCoordinatorRuntimeComposition} from '../scripts/autonomy/m11-coordinator-runtime-composition.mjs';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {captureClaudeRuntimeCandidate} from '../scripts/autonomy/m11-claude-runtime-capture.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';

const NOW = 1700000000100;
const END = NOW + 600000;
const REPO = 'Achi1984/meridian';
const PR = 1045;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const REVIEWER = Object.freeze({
  provider: 'synthetic-provider', agent: 'synthetic-reviewer',
  model: 'synthetic-model', transport: 'externally-injected-test-seam'
});

async function collect() {
  const run = {
    id: 7001, repository: REPO, workflowId: 347821227,
    workflowPath: '.github/workflows/backend-safety.yml',
    runAttempt: 1, runNumber: 20, status: 'completed', conclusion: 'success',
    headSha: HEAD, baseSha: BASE, pullRequests: [PR],
    actor: 'Achi1984', triggeringActor: 'Achi1984'
  };
  // Synthetic external repository reads, passed through the actual branded collector.
  const api = {
    authenticated: true,
    authenticationEvidence: Object.freeze({
      evidenceId: 'synthetic-auth-only', principal: 'synthetic-principal',
      host: 'api.github.com', scheme: 'https', tls: true,
      verifiedAtMs: NOW - 100, expiresAtMs: END
    }),
    async getWorkflowRun() { return run; },
    async getPullRequest() {
      return {
        repository: REPO, number: PR, state: 'open', isFork: false,
        headRepository: REPO, baseRepository: REPO, headSha: HEAD, baseSha: BASE
      };
    },
    async getPullRequestDiff() {
      return {
        headSha: HEAD, baseSha: BASE, complete: true, truncated: false,
        text: 'diff --git a/scripts/autonomy/example.mjs b/scripts/autonomy/example.mjs\n+synthetic',
        changedPaths: ['scripts/autonomy/example.mjs']
      };
    },
    async listWorkflowRuns() { return {items: [run], totalCount: 1, hasNextPage: false}; },
    async listWorkflowJobs() {
      return {
        items: [{
          id: 81, name: 'syntax', runId: run.id, runAttempt: 1, workflowId: run.workflowId,
          status: 'completed', conclusion: 'success',
          steps: [{name: 'Research and auth regression tests', status: 'completed', conclusion: 'success'}]
        }],
        totalCount: 1, hasNextPage: false
      };
    }
  };
  const result = await collectExactPair({
    hint: {eventName: 'workflow_run', repository: REPO, workflowRunId: run.id, workflowRunAttempt: 1},
    config: {
      enabled: true, repository: REPO, pullRequests: [PR], actors: ['Achi1984'],
      startsAt: NOW - 100, expiresAt: END, maxPages: 5, maxRuntimeMs: 1000
    },
    api, now: () => NOW
  });
  assert.equal(result.status, 'READY');
  return result;
}

function harness(server, collected, {observation = () => ({status: 'PENDING'}), found = false} = {}) {
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true, fetchImpl: server.fetchImpl,
    credentials: {getAuthorizationHeader: () => 'synthetic-not-a-credential'},
    now: () => NOW, defaultDeadlineMs: 3000
  });
  const runtime = createCoordinatorRuntimeComposition({
    enabled: true, stateTransport: transport, now: () => NOW, reviewerIdentity: REVIEWER,
    async revalidate() { server.counts.revalidate += 1; return collected; },
    async dispatchReview(input) {
      server.counts.dispatch += 1;
      const envelope = server.envelope();
      const claim = envelope.claims[0];
      assert.equal(claim.lastStage, 'REVIEW_PENDING');
      assert.equal(envelope.transitionChain.at(-1).kind, 'REVIEW_PENDING');
      assert.equal(claim.reviewRequestId, input.reviewRequestId);
      assert.equal(claim.sessionId, input.sessionId);
      assert.equal(claim.actionKey, collected.actionKey);
      assert.equal(claim.executionKey, collected.executionKey);
      server.events.push({kind: 'dispatch', storageVersion: envelope.storageVersion});
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    async observeReview() {
      server.counts.observe += 1;
      assert.equal(server.envelope().claims[0].lastStage, 'OBSERVE_PREPARING');
      return observation();
    },
    // Deliberately trusted synthetic authority, NOT a hosted/authenticated reviewer.
    trustedRuntimeSeam: {
      verifyRuntimeEvidence(evidence) { server.counts.verify += 1; return evidence; }
    },
    receiptLookup: {
      async lookupByExecutionKey({executionKey, signal}) {
        server.counts.lookup += 1;
        assert.equal(executionKey, collected.executionKey);
        assert.ok(signal instanceof AbortSignal);
        return found
          ? {status: 'FOUND', complete: true, receiptIds: ['synthetic-receipt']}
          : {status: 'NOT_FOUND', complete: true, receiptIds: []};
      }
    }
  });
  return {
    runtime, transport,
    input: {collected, executionKey: collected.executionKey, expiresAt: END, maxRuntimeMs: 2000}
  };
}

function completed(start, collected) {
  return {
    status: 'COMPLETED', observedAtMs: NOW,
    ci: {
      runId: collected.runId, runAttempt: collected.runAttempt,
      workflowId: collected.workflowId, selectionRevision: collected.selectionRevision
    },
    modelOutput: {
      reviewRequestId: start.reviewRequestId, sessionId: start.sessionId, reviewer: {...REVIEWER},
      coverageParts: [...REQUIRED_REVIEW_PARTS], verdict: 'GREEN_LIGHT',
      complete: true, truncated: false, turnLimit: false, summary: 'Synthetic only'
    },
    trustedRuntimeEvidence: {
      evidenceId: 'externally-trusted-synthetic-test-evidence', provider: 'synthetic-test',
      observedAtMs: NOW - 1, expiresAtMs: NOW + 1000,
      runtime: {
        reviewRequestId: start.reviewRequestId, sessionId: start.sessionId, reviewer: {...REVIEWER},
        repository: collected.repository, pullRequest: collected.pullRequest,
        headSha: collected.headSha, baseSha: collected.baseSha, diffDigest: collected.diffDigest,
        terminalState: 'completed', stopReason: 'end_turn', truncated: false, turnLimit: false,
        coverageParts: [...REQUIRED_REVIEW_PARTS], changedPaths: [...collected.changedPaths]
      }
    }
  };
}

function sourceOnly(result) {
  assert.equal(result.scope, 'SOURCE_COMPOSITION_ONLY');
  assert.equal(result.publication, 'NOT_READY');
  assert.equal(result.receiptDelivery, 'NOT_ATTEMPTED');
  assert.equal(result.hostedAtomicityProven, false);
  assert.equal(result.merge, false);
  assert.equal(result.activation, false);
  assert.equal(result.retryAllowed, false);
}

function fence(server, collected) {
  const envelope = server.envelope();
  const claim = envelope.claims[0];
  assert.equal(claim.status, 'RECEIPT_POSTING');
  assert.equal(claim.lastStage, 'RECEIPT_POSTING');
  assert.equal(claim.actionKey, collected.actionKey);
  assert.equal(claim.executionKey, collected.executionKey);
  assert.notEqual(claim.actionKey, claim.executionKey);
  assert.equal(claim.expectedOid, envelope.snapshot.oid);
  assert.notEqual(envelope.snapshot.oid, server.head());
  assert.match(server.head(), /^[a-f0-9]{40}$/);
  assert.equal(claim.storageVersion, envelope.storageVersion);
  assert.equal(envelope.transitionChain.at(-1).kind, 'RECEIPT_POSTING');
  assert.equal(envelope.admissionState.consumedQuota, 1);
  assert.equal(envelope.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(envelope.claims.some(item => item.status === 'COMMITTED'), false);
  assert.equal(envelope.transitionChain.some(item => item.kind === 'COMMITTED'), false);
  assert.equal(JSON.stringify(envelope).includes('committedAtMs'), false);
  assert.equal(server.counts.receiptPosts, 0);
  assert.equal(server.requests.filter(item => item.method === 'POST').every(item => item.path === '/graphql'), true);
}

async function restartLookup(server, collected, oldTransport) {
  const restored = createFakeGithub({serialized: server.serialize()});
  assert.deepEqual(restored.counts, server.counts);
  assert.deepEqual(restored.requests, server.requests);
  assert.notEqual(restored.counts, server.counts);
  const h = harness(restored, await collect(), {found: true});
  assert.notEqual(h.transport, oldTransport);
  const before = restored.canonicalBytes();
  const counts = {...restored.counts};
  const result = await h.runtime.observe(h.input);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'RECEIPT_FOUND_RECONCILE_REQUIRED');
  assert.equal(result.receiptId, 'synthetic-receipt');
  sourceOnly(result);
  assert.equal(restored.counts.lookup, counts.lookup + 1);
  assert.equal(restored.counts.get, counts.get + 12);
  for (const key of ['graphql', 'accepted', 'dispatch', 'observe', 'verify', 'receiptPosts']) {
    assert.equal(restored.counts[key], counts[key], key);
  }
  assert.equal(restored.canonicalBytes(), before);
  fence(restored, collected);
  await projectReadOnly(restored, collected);
  return restored;
}

async function projectReadOnly(server, collected) {
  const h = harness(server, collected);
  const before = server.canonicalBytes();
  const counts = {...server.counts};
  const envelope = server.envelope();
  const result = await h.runtime.projectStatus({
    contextJson: JSON.stringify({
      schemaVersion: 1,
      operations: [{
        executionKey: collected.executionKey,
        taskUrl: 'https://github.com/Achi1984/meridian/issues/1045',
        observedAt: new Date(NOW - 1).toISOString(),
        expiresAt: new Date(NOW + 1000).toISOString()
      }]
    }),
    nowMs: NOW
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.metadata.storageVersion, envelope.storageVersion);
  assert.equal(result.metadata.publicOid, envelope.snapshot.oid);
  assert.equal(result.metadata.replaceAttempts, 0);
  const row = JSON.parse(result.serializedDTO).rows[0];
  assert.equal(row.taskState, 'UNKNOWN');
  assert.equal(row.taskLabel, 'Stored receipt posting fence; delivery unconfirmed');
  assert.equal(row.nextAction, 'Offline snapshot only; no dispatch, retry, or owner decision inferred');
  for (const key of ['providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
    'coordinatorMode', 'freshness']) assert.equal(row[key], 'UNKNOWN', key);
  for (const key of ['providerEvidence', 'modelEvidence', 'coordinatorEvidence', 'evidenceUrl']) {
    assert.equal(row[key], null, key);
  }
  assert.equal(server.counts.get, counts.get + 4);
  assert.deepEqual({...server.counts, get: counts.get}, counts);
  assert.equal(server.canonicalBytes(), before);
}

test('connected HTTP transport path survives reconstruction, refuses publication and projects persisted state', async t => {
  const collected = await collect();
  const server = createFakeGithub();
  const first = harness(server, collected);
  const start = await first.runtime.start(first.input);
  assert.equal(start.status, 'REVIEW_PENDING');
  sourceOnly(start);
  assert.equal(server.envelope().claims[0].lastStage, 'DISPATCH_ACKED');
  assert.equal(server.counts.dispatch, 1);
  assert.equal(server.counts.graphql, 3);
  assert.equal(server.counts.accepted, 3);
  assert.deepEqual(server.events.map(item => item.kind === 'persisted' ? item.stage : item.kind),
    ['CLAIM_CREATED', 'REVIEW_PENDING', 'dispatch', 'DISPATCH_ACKED']);

  const restored = createFakeGithub({serialized: server.serialize()});
  const fresh = await collect();
  let observation = {status: 'PENDING'};
  const second = harness(restored, fresh, {observation: () => observation});
  assert.notEqual(second.runtime, first.runtime);
  assert.notEqual(second.transport, first.transport);
  assert.deepEqual(restored.counts, server.counts);
  assert.equal((await second.runtime.observe(second.input)).status, 'REVIEW_PENDING');
  assert.equal(restored.envelope().claims[0].lastStage, 'OBSERVE_PENDING');
  assert.equal(restored.counts.dispatch, 1);
  assert.equal(restored.counts.observe, 1);
  observation = completed(start, fresh);
  const result = await second.runtime.observe(second.input);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'PUBLICATION_NOT_READY');
  sourceOnly(result);
  fence(restored, fresh);
  assert.equal(restored.counts.verify, 1);
  assert.equal(restored.counts.lookup, 0);
  assert.equal(restored.counts.graphql, 9);
  await restartLookup(restored, fresh, second.transport);

  await t.test('actual unverified capture cannot substitute for synthetic trusted evidence', async () => {
    const rejectedServer = createFakeGithub();
    let candidateObservation;
    const h = harness(rejectedServer, collected, {observation: () => candidateObservation});
    const pending = await h.runtime.start(h.input);
    const candidate = captureClaudeRuntimeCandidate(Buffer.from(JSON.stringify([
      {type: 'system', subtype: 'init', session_id: pending.sessionId, model: REVIEWER.model},
      {type: 'result', subtype: 'success', session_id: pending.sessionId,
        is_error: false, num_turns: 1, modelUsage: {[REVIEWER.model]: {}}}
    ])), {parserContractVersion: 'm11-claude-runtime-capture@v1', requestedModel: REVIEWER.model});
    assert.equal(candidate.status, 'UNVERIFIED');
    assert.equal(candidate.promotesTrustedRuntime, false);
    candidateObservation = {...completed(pending, collected), trustedRuntimeEvidence: candidate};
    assert.equal((await h.runtime.observe(h.input)).reason, 'BOUNDARY_REJECTED');
    assert.equal(rejectedServer.envelope().claims[0].lastStage, 'BOUNDARY_REJECTED');
    assert.equal(rejectedServer.counts.verify, 1);
    assert.equal(rejectedServer.counts.receiptPosts, 0);
    assert.equal(rejectedServer.envelope().transitionChain.some(item => item.kind === 'RECEIPT_POSTING'), false);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('competing real transports atomically contest one expected Git head; only one dispatches', async () => {
  const barrier = deferred();
  let arrivals = 0;
  const server = createFakeGithub({
    async beforeMutation({request}) {
      if (request.stage !== 'CLAIM_CREATED') return;
      if (++arrivals === 2) barrier.resolve();
      await barrier.promise;
    }
  });
  const collected = await collect();
  const a = harness(server, collected);
  const b = harness(server, await collect());
  assert.notEqual(a.transport, b.transport);
  const results = await Promise.all([a.runtime.start(a.input), b.runtime.start(b.input)]);
  assert.equal(arrivals, 2);
  assert.equal(results.filter(result => result.status === 'REVIEW_PENDING').length, 1);
  const loserResult = results.find(result => result.status === 'UNKNOWN');
  assert.equal(loserResult?.reason, 'CLAIM_OUTCOME_UNKNOWN');
  sourceOnly(loserResult);
  assert.equal(server.counts.dispatch, 1);
  assert.equal(server.counts.conflicts, 1);
  assert.equal(server.counts.graphql, 4);
  assert.equal(server.counts.accepted, 3);
  const attempts = server.requests.filter(item => item.stage === 'CLAIM_CREATED');
  assert.equal(attempts[0].expectedHeadOid, attempts[1].expectedHeadOid);
  assert.equal(server.envelope().claims.length, 1);
  assert.equal(server.envelope().admissionState.consumedQuota, 1);
  assert.equal(server.envelope().claims[0].lastStage, 'DISPATCH_ACKED');
  const loser = results[0].status === 'UNKNOWN' ? a : b;
  const before = server.counts.graphql;
  assert.equal((await loser.runtime.start(loser.input)).reason, 'ALREADY_CLAIMED');
  assert.equal(server.counts.graphql, before);
  assert.equal(server.counts.dispatch, 1);
  assert.equal(server.counts.receiptPosts, 0);
});

test('duplicate start deliveries, including after reconstruction, never mutate or redispatch', async () => {
  const collected = await collect();
  const server = createFakeGithub();
  const first = harness(server, collected);
  assert.equal((await first.runtime.start(first.input)).status, 'REVIEW_PENDING');
  const settled = server.canonicalBytes();
  const counts = {...server.counts};
  const restored = createFakeGithub({serialized: server.serialize()});
  const second = harness(restored, await collect());
  for (const h of [first, second]) {
    const duplicate = await h.runtime.start(h.input);
    assert.equal(duplicate.reason, 'ALREADY_CLAIMED');
    sourceOnly(duplicate);
  }
  for (const key of ['graphql', 'accepted', 'conflicts', 'dispatch', 'receiptPosts']) {
    assert.equal(server.counts[key], counts[key], key);
    assert.equal(restored.counts[key], counts[key], key);
  }
  assert.equal(server.canonicalBytes(), settled);
  assert.equal(restored.canonicalBytes(), settled);
  assert.equal(server.envelope().claims.length, 1);
  assert.equal(server.envelope().admissionState.consumedQuota, 1);
});

test('persisted RECEIPT_POSTING with lost HTTP acknowledgement is UNKNOWN, never blindly retried', async () => {
  const server = createFakeGithub({
    afterMutation({request}) {
      if (request.stage === 'RECEIPT_POSTING') throw new Error('synthetic persisted mutation, lost ACK');
    }
  });
  const collected = await collect();
  let observation;
  const h = harness(server, collected, {observation: () => observation});
  const start = await h.runtime.start(h.input);
  observation = completed(start, collected);
  const result = await h.runtime.observe(h.input);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'RECEIPT_POSTING_STATE_UNKNOWN');
  sourceOnly(result);
  assert.equal(server.counts.graphql, 7);
  assert.equal(server.counts.accepted, 7);
  assert.equal(server.requests.filter(item => item.stage === 'RECEIPT_POSTING').length, 1);
  fence(server, collected);
  const counts = {...server.counts};
  assert.equal((await h.runtime.observe(h.input)).reason, 'RECEIPT_NOT_CONFIRMED_NO_REPOST');
  assert.equal(server.counts.graphql, counts.graphql);
  assert.equal(server.counts.lookup, counts.lookup + 1);
  assert.equal(server.counts.observe, counts.observe);
  assert.equal(server.counts.dispatch, 1);
  await restartLookup(server, collected, h.transport);
});

async function eventually(predicate) {
  const until = performance.now() + 1500;
  while (!predicate() && performance.now() < until) await delay(5);
  assert.ok(predicate(), 'late operation must finish within the bounded synthetic drain');
  await tick();
}

test('runtime deadline does not cancel backend HTTP: a bounded late write retains lookup-only recovery', async () => {
  const held = deferred();
  const release = deferred();
  let transportSignal;
  const server = createFakeGithub({
    async beforeMutation({request, signal}) {
      if (request.stage !== 'RECEIPT_POSTING') return;
      transportSignal = signal;
      held.resolve();
      await release.promise;
    }
  });
  const collected = await collect();
  let observation;
  const h = harness(server, collected, {observation: () => observation});
  const start = await h.runtime.start(h.input);
  assert.equal(start.status, 'REVIEW_PENDING');
  observation = completed(start, collected);
  const began = performance.now();
  const pending = h.runtime.observe({...h.input, maxRuntimeMs: 500});
  try {
    const result = await pending;
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.reason, 'RECEIPT_POSTING_STATE_UNKNOWN');
    sourceOnly(result);
    await held.promise;
    assert.ok(performance.now() - began < 2000, 'runtime returns before the 3000 ms transport deadline');
    assert.equal(transportSignal.aborted, false, 'backend did not forward lifecycle AbortSignal');
    assert.equal(server.envelope().claims[0].lastStage, 'RECEIPT_PREPARING');
    assert.equal(server.counts.accepted, 6);
    const readsBeforeRelease = server.counts.get;
    release.resolve();
    // Four GETs for transport readback, then four for the backend's own readback.
    await eventually(() => server.counts.accepted === 7 && server.counts.get >= readsBeforeRelease + 8);
    assert.equal(transportSignal.aborted, false);
    assert.equal(server.counts.graphql, 7);
    assert.equal(server.counts.dispatch, 1);
    assert.equal(server.counts.observe, 1);
    fence(server, collected);
    const restored = await restartLookup(server, collected, h.transport);
    assert.equal(restored.counts.dispatch, 1);
    assert.equal(restored.counts.graphql, 7);
    assert.equal(restored.counts.receiptPosts, 0);
  } finally {
    release.resolve();
  }
});
