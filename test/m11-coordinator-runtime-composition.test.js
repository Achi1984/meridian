import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCoordinatorRuntimeComposition} from '../scripts/autonomy/m11-coordinator-runtime-composition.mjs';
import {
  createAtomicRecordEnvelope,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {collectExactPair} from '../scripts/autonomy/m11-coordinator-collector.mjs';
import {captureClaudeRuntimeCandidate} from '../scripts/autonomy/m11-claude-runtime-capture.mjs';
import {REQUIRED_REVIEW_PARTS} from '../scripts/autonomy/m11-event-coordinator.mjs';
import {normalizeM11AgentStatus} from '../scripts/autonomy/m11-agent-status.mjs';

const NOW = 1700000000100;
const END = NOW + 600000;
const REPO = 'Achi1984/meridian';
const PR = 1043;
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const REVIEWER = Object.freeze({
  provider: 'synthetic-provider', agent: 'synthetic-reviewer',
  model: 'synthetic-model', transport: 'externally-injected-test-seam'
});
const iso = ms => new Date(ms).toISOString();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jsonClone = value => JSON.parse(JSON.stringify(value));

// Independent serialized CAS fixture: no backend memory transport or hidden object identity.
function serializedState(initial = createAtomicRecordEnvelope(), hooks = {}) {
  let serialized = JSON.stringify(initial);
  const counts = {reads: 0, replaces: 0};
  const transport = {
    async readCanonicalEnvelope() {
      counts.reads += 1;
      const envelope = JSON.parse(serialized);
      return hooks.read ? hooks.read(envelope, counts) : envelope;
    },
    async replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope}) {
      counts.replaces += 1;
      if (hooks.beforeReplace) await hooks.beforeReplace({expectedStorageVersion, nextEnvelope});
      const current = JSON.parse(serialized);
      if (expectedStorageVersion !== current.storageVersion) {
        return {status: 'CONFLICT', storageVersion: current.storageVersion};
      }
      serialized = JSON.stringify(nextEnvelope);
      if (hooks.afterReplace) await hooks.afterReplace(JSON.parse(serialized));
      return {status: 'REPLACED', storageVersion: nextEnvelope.storageVersion};
    }
  };
  return {
    transport, counts,
    envelope: () => JSON.parse(serialized),
    serialized: () => serialized
  };
}

async function collect({headSha = HEAD, runId = 7001, runAttempt = 1, diff = '+synthetic'} = {}) {
  const run = {
    id: runId, repository: REPO, workflowId: 347821227,
    workflowPath: '.github/workflows/backend-safety.yml',
    runAttempt, runNumber: 20, status: 'completed', conclusion: 'success',
    headSha, baseSha: BASE, pullRequests: [PR],
    actor: 'Achi1984', triggeringActor: 'Achi1984'
  };
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
        headRepository: REPO, baseRepository: REPO, headSha, baseSha: BASE
      };
    },
    async getPullRequestDiff() {
      return {
        headSha, baseSha: BASE, complete: true, truncated: false,
        text: `diff --git a/scripts/autonomy/example.mjs b/scripts/autonomy/example.mjs\n${diff}`,
        changedPaths: ['scripts/autonomy/example.mjs']
      };
    },
    async listWorkflowRuns() {
      return {items: [run], totalCount: 1, hasNextPage: false};
    },
    async listWorkflowJobs() {
      return {
        items: [{
          id: 81, name: 'syntax', runId, runAttempt, workflowId: 347821227,
          status: 'completed', conclusion: 'success',
          steps: [{name: 'Research and auth regression tests', status: 'completed', conclusion: 'success'}]
        }],
        totalCount: 1, hasNextPage: false
      };
    }
  };
  const result = await collectExactPair({
    hint: {eventName: 'workflow_run', repository: REPO, workflowRunId: runId, workflowRunAttempt: runAttempt},
    config: {
      enabled: true, repository: REPO, pullRequests: [PR], actors: ['Achi1984'],
      startsAt: NOW - 100, expiresAt: END, maxPages: 5, maxRuntimeMs: 1000
    },
    api, now: () => NOW
  });
  assert.equal(result.status, 'READY');
  return result;
}

function harness(state, collected, overrides = {}) {
  const calls = {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0};
  const config = {
    enabled: true, stateTransport: state.transport, now: () => NOW,
    reviewerIdentity: REVIEWER,
    async revalidate() { calls.revalidate += 1; return collected; },
    async dispatchReview(input) {
      calls.dispatch += 1;
      const claim = state.envelope().claims[0];
      assert.equal(claim.lastStage, 'REVIEW_PENDING');
      assert.equal(claim.reviewRequestId, input.reviewRequestId);
      assert.equal(claim.sessionId, input.sessionId);
      assert.equal(input.actionKey, collected.actionKey);
      assert.equal(input.executionKey, collected.executionKey);
      return {status: 'ACKNOWLEDGED', reviewRequestId: input.reviewRequestId, sessionId: input.sessionId};
    },
    async observeReview() {
      calls.observe += 1;
      assert.equal(state.envelope().claims[0].lastStage, 'OBSERVE_PREPARING');
      return {status: 'PENDING'};
    },
    // This is an explicitly trusted synthetic seam, not a hosted trust implementation.
    trustedRuntimeSeam: {
      verifyRuntimeEvidence(evidence) { calls.verify += 1; return evidence; }
    },
    receiptLookup: {
      async lookupByExecutionKey(input) {
        calls.lookup += 1;
        assert.deepEqual(Object.keys(input).sort(), ['executionKey', 'signal']);
        assert.equal(input.executionKey, collected.executionKey);
        assert.ok(input.signal instanceof AbortSignal);
        return {status: 'NOT_FOUND', complete: true, receiptIds: []};
      }
    },
    ...overrides
  };
  return {
    runtime: createCoordinatorRuntimeComposition(config), config, calls,
    input: {collected, executionKey: collected.executionKey, expiresAt: END, maxRuntimeMs: 1000}
  };
}

function completed(start, collected, verdict = 'GREEN_LIGHT') {
  return {
    status: 'COMPLETED', observedAtMs: NOW,
    ci: {
      runId: collected.runId, runAttempt: collected.runAttempt,
      workflowId: collected.workflowId, selectionRevision: collected.selectionRevision
    },
    modelOutput: {
      reviewRequestId: start.reviewRequestId, sessionId: start.sessionId, reviewer: {...REVIEWER},
      coverageParts: [...REQUIRED_REVIEW_PARTS], verdict,
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

async function postingFixture({verdict = 'GREEN_LIGHT', hooks = {}} = {}) {
  const collected = await collect();
  const state = serializedState(undefined, hooks);
  let observation;
  const h = harness(state, collected, {async observeReview() { return observation; }});
  const start = await h.runtime.start(h.input);
  assert.equal(start.status, 'REVIEW_PENDING');
  observation = completed(start, collected, verdict);
  const result = await h.runtime.observe(h.input);
  return {state, collected, start, result, ...h};
}

function sourceOnly(result) {
  assert.equal(result.scope, 'SOURCE_COMPOSITION_ONLY');
  assert.equal(result.publication, 'NOT_READY');
  assert.equal(result.receiptDelivery, 'NOT_ATTEMPTED');
  assert.equal(result.hostedAtomicityProven, false);
}

function retainedFence(envelope, collected) {
  const claim = envelope.claims[0];
  assert.equal(claim.status, 'RECEIPT_POSTING');
  assert.equal(claim.lastStage, 'RECEIPT_POSTING');
  assert.equal(claim.actionKey, collected.actionKey);
  assert.equal(claim.executionKey, collected.executionKey);
  assert.notEqual(claim.actionKey, claim.executionKey);
  assert.equal(envelope.admissionState.totalQuota, 3);
  assert.equal(envelope.admissionState.consumedQuota, 1);
  assert.equal(envelope.admissionState.activeGate.executionKey, collected.executionKey);
  assert.equal(envelope.transitionChain.at(-1).kind, 'RECEIPT_POSTING');
  assert.equal(envelope.claims.some(item => item.status === 'COMMITTED'), false);
  assert.equal(JSON.stringify(envelope).includes('committedAtMs'), false);
}

function context(envelope) {
  return JSON.stringify({
    schemaVersion: 1,
    operations: envelope.claims.map(claim => ({
      executionKey: claim.executionKey, taskUrl: 'https://github.com/Achi1984/meridian/issues/1043',
      observedAt: iso(NOW - 1), expiresAt: iso(NOW + 1000)
    }))
  });
}

test('default disabled short-circuits all methods before seams or clock, with zero I/O', async () => {
  const poison = new Proxy({}, {get() { throw new Error('must not inspect disabled dependencies'); }});
  const runtime = createCoordinatorRuntimeComposition({
    stateTransport: poison, receiptLookup: poison, trustedRuntimeSeam: poison,
    now() { throw new Error('must not read clock'); }
  });
  for (const result of await Promise.all([runtime.start(), runtime.observe(), runtime.projectStatus()])) {
    assert.equal(result.reason, 'DISABLED');
    sourceOnly(result);
  }
});

test('missing or invalid operation seams and limits do no state or reviewer I/O', async t => {
  const collected = await collect();
  for (const [name, override, method, input] of [
    ['transport', {stateTransport: null}, 'start'],
    ['replace seam', {stateTransport: {readCanonicalEnvelope() { throw new Error('no read'); }}}, 'start'],
    ['clock', {now: null}, 'start'],
    ['dispatch', {dispatchReview: null}, 'start'],
    ['revalidation', {revalidate: null}, 'start'],
    ['reviewer', {reviewerIdentity: {...REVIEWER, model: ''}}, 'start'],
    ['runtime zero', {}, 'start', {maxRuntimeMs: 0}],
    ['runtime cap', {}, 'start', {maxRuntimeMs: 10001}],
    ['review deadline', {}, 'start', {reviewDeadlineMs: 86400001}],
    ['owner', {}, 'start', {claimOwner: 'bad owner'}],
    ['expiry', {}, 'start', {expiresAt: 0}],
    ['observe', {observeReview: null}, 'observe'],
    ['trust', {trustedRuntimeSeam: null}, 'observe'],
    ['lookup', {receiptLookup: null}, 'observe'],
    ['broad lookup', {receiptLookup: {lookupByExecutionKey() {}, postOnce() {}}}, 'observe'],
    ['wrong execution', {}, 'observe', {executionKey: collected.actionKey}],
    ['projection clock', {}, 'projectStatus', {contextJson: '{}', nowMs: NaN}],
    ['projection context', {}, 'projectStatus', {contextJson: null, nowMs: NOW}]
  ]) {
    await t.test(name, async () => {
      const state = serializedState();
      const h = harness(state, collected, override);
      const result = await h.runtime[method]({...h.input, ...input});
      assert.equal(result.status, 'WAITING');
      assert.deepEqual(state.counts, {reads: 0, replaces: 0});
      assert.deepEqual(h.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
      sourceOnly(result);
    });
  }
});

test('serialized collections, bad clocks and expired pilot do zero state I/O', async () => {
  const collected = await collect();
  for (const override of [{now: () => NaN}, {now() { throw new Error('clock'); }}, {}]) {
    const state = serializedState();
    const h = harness(state, collected, override);
    const result = await h.runtime.start({...h.input, collected: jsonClone(collected)});
    assert.equal(result.status, 'WAITING');
    assert.deepEqual(state.counts, {reads: 0, replaces: 0});
  }
  const state = serializedState();
  const h = harness(state, collected);
  assert.equal((await h.runtime.start({...h.input, expiresAt: NOW})).reason, 'PILOT_OR_COLLECTION_EXPIRED');
  assert.equal((await h.runtime.observe({...h.input, collected: jsonClone(collected)})).reason, 'FRESH_COLLECTION_REQUIRED');
  assert.deepEqual(state.counts, {reads: 0, replaces: 0});
});

test('real sequential start, pending observe and JSON restart retain admission and exact identities', async () => {
  const collected = await collect();
  const state = serializedState();
  const h = harness(state, collected);
  const start = await h.runtime.start(h.input);
  assert.equal(start.status, 'REVIEW_PENDING');
  assert.equal(h.calls.dispatch, 1);
  assert.equal(state.counts.replaces, 3);
  assert.equal(state.envelope().storageVersion, 3);
  assert.equal(state.envelope().snapshot.revision, 2);
  assert.equal(state.envelope().claims[0].lastStage, 'DISPATCH_ACKED');
  const observed = await h.runtime.observe(h.input);
  assert.equal(observed.status, 'REVIEW_PENDING');
  assert.equal(h.calls.observe, 1);
  assert.equal(state.envelope().claims[0].lastStage, 'OBSERVE_PENDING');
  assert.equal(state.envelope().admissionState.consumedQuota, 1);

  const restartedState = serializedState(JSON.parse(state.serialized()));
  const fresh = await collect();
  const restarted = harness(restartedState, fresh);
  assert.equal((await restarted.runtime.observe(restarted.input)).status, 'REVIEW_PENDING');
  assert.equal(restarted.calls.dispatch, 0);
  assert.equal(restarted.calls.observe, 1);
  assert.equal(restartedState.envelope().admissionState.consumedQuota, 1);
  assert.equal((await restarted.runtime.start(restarted.input)).reason, 'ALREADY_CLAIMED');
  assert.equal(restarted.calls.dispatch, 0);
  sourceOnly(observed);
});

test('real admitted completion refuses publication and persists posting, never delivery UNKNOWN or COMMITTED', async () => {
  for (const verdict of ['GREEN_LIGHT', 'REVISION_REQUIRED']) {
    const f = await postingFixture({verdict});
    assert.equal(f.result.status, 'UNKNOWN');
    assert.equal(f.result.reason, 'PUBLICATION_NOT_READY');
    assert.equal(f.result.externalEffects, false);
    sourceOnly(f.result);
    assert.equal(f.calls.verify, 1);
    assert.equal(f.calls.lookup, 0);
    assert.equal(f.state.counts.replaces, 7);
    retainedFence(f.state.envelope(), f.collected);
    assert.deepEqual(f.state.envelope().transitionChain.map(item => item.kind), [
      'CLAIM_CREATED', 'REVIEW_PENDING', 'DISPATCH_ACKED', 'OBSERVE_PREPARING',
      'REVIEW_RESULT', 'RECEIPT_PREPARING', 'RECEIPT_POSTING'
    ]);
    assert.equal(f.state.envelope().claims[0].verdict, verdict);
  }
});

test('restart is lookup-only and FOUND stays UNKNOWN, with no repost or state mutation', async t => {
  const f = await postingFixture();
  for (const [name, lookupResult, reason] of [
    ['absent', {status: 'NOT_FOUND', complete: true, receiptIds: []}, 'RECEIPT_NOT_CONFIRMED_NO_REPOST'],
    ['found', {status: 'FOUND', complete: true, receiptIds: ['synthetic-receipt']}, 'RECEIPT_FOUND_RECONCILE_REQUIRED'],
    ['ambiguous', {status: 'FOUND', complete: true, receiptIds: ['one', 'two']}, 'RECEIPT_NOT_CONFIRMED_NO_REPOST'],
    ['incomplete', {status: 'FOUND', complete: false, receiptIds: ['one']}, 'RECEIPT_READBACK_UNKNOWN'],
    ['oversized', {status: 'FOUND', complete: true, receiptIds: ['one', 'two', 'three']}, 'RECEIPT_READBACK_UNKNOWN']
  ]) {
    await t.test(name, async () => {
      const state = serializedState(JSON.parse(f.state.serialized()));
      const fresh = await collect();
      let lookups = 0;
      const h = harness(state, fresh, {
        receiptLookup: {
          async lookupByExecutionKey({executionKey}) {
            lookups += 1;
            assert.equal(executionKey, fresh.executionKey);
            return lookupResult;
          }
        }
      });
      const before = state.serialized();
      const result = await h.runtime.observe(h.input);
      assert.equal(result.status, 'UNKNOWN');
      assert.equal(result.reason, reason);
      if (name === 'found') assert.equal(result.receiptId, 'synthetic-receipt');
      assert.equal(lookups, 1);
      assert.deepEqual(h.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
      assert.equal(state.counts.replaces, 0);
      assert.equal(state.serialized(), before);
      retainedFence(state.envelope(), fresh);
      sourceOnly(result);
    });
  }
});

test('lookup throw and ignored abort are bounded and cannot start another lookup', async () => {
  const f = await postingFixture();
  for (const hangs of [false, true]) {
    const state = serializedState(f.state.envelope());
    let lookups = 0;
    let signal;
    const h = harness(state, await collect(), {
      receiptLookup: {
        async lookupByExecutionKey(input) {
          lookups += 1;
          signal = input.signal;
          if (hangs) return new Promise(() => {});
          throw new Error('synthetic read failure');
        }
      }
    });
    const result = await h.runtime.observe({...h.input, maxRuntimeMs: hangs ? 50 : 1000});
    assert.equal(result.reason, 'RECEIPT_READBACK_UNKNOWN');
    assert.equal(lookups, 1);
    if (hangs) assert.equal(signal.aborted, true);
    assert.equal(state.counts.replaces, 0);
    retainedFence(state.envelope(), f.collected);
  }
});

test('actual capture remains UNVERIFIED and is rejected by the real boundary', async () => {
  const collected = await collect();
  const state = serializedState();
  let observation;
  const h = harness(state, collected, {async observeReview() { return observation; }});
  const start = await h.runtime.start(h.input);
  const candidate = captureClaudeRuntimeCandidate(Buffer.from(JSON.stringify([
    {type: 'system', subtype: 'init', session_id: start.sessionId, model: REVIEWER.model},
    {type: 'result', subtype: 'success', session_id: start.sessionId,
      is_error: false, num_turns: 1, modelUsage: {[REVIEWER.model]: {}}}
  ])), {parserContractVersion: 'm11-claude-runtime-capture@v1', requestedModel: REVIEWER.model});
  assert.equal(candidate.status, 'UNVERIFIED');
  assert.equal(candidate.promotesTrustedRuntime, false);
  assert.notEqual(candidate.candidate, null);
  observation = {...completed(start, collected), trustedRuntimeEvidence: candidate};
  assert.equal((await h.runtime.observe(h.input)).reason, 'BOUNDARY_REJECTED');
  assert.equal(h.calls.verify, 1);
  assert.equal(state.envelope().claims[0].lastStage, 'BOUNDARY_REJECTED');
  assert.equal(state.envelope().claims[0].status, 'UNKNOWN');
  assert.equal(state.envelope().admissionState.consumedQuota, 1);
  assert.equal(state.envelope().transitionChain.some(item => item.kind === 'RECEIPT_POSTING'), false);
  const restarted = harness(serializedState(JSON.parse(state.serialized())), await collect());
  assert.equal((await restarted.runtime.observe(restarted.input)).reason, 'TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
  assert.deepEqual(restarted.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
});

test('projection reads actual canonical export without writes or inferred runtime evidence', async () => {
  const f = await postingFixture();
  const state = serializedState(JSON.parse(f.state.serialized()));
  const h = harness(state, f.collected, {now: null, dispatchReview: null, observeReview: null});
  const before = state.serialized();
  const result = await h.runtime.projectStatus({contextJson: context(state.envelope()), nowMs: NOW});
  assert.equal(result.status, 'READY');
  sourceOnly(result);
  assert.equal(result.metadata.storageVersion, state.envelope().storageVersion);
  assert.equal(result.metadata.publicRevision, state.envelope().snapshot.revision);
  assert.equal(result.metadata.publicOid, state.envelope().snapshot.oid);
  assert.equal(result.metadata.replaceAttempts, 0);
  assert.equal(state.counts.replaces, 0);
  assert.equal(state.counts.reads, 1);
  assert.equal(state.serialized(), before);
  const dto = JSON.parse(result.serializedDTO);
  assert.deepEqual(normalizeM11AgentStatus(dto, {now: () => NOW}), dto);
  assert.equal(dto.rows[0].taskState, 'UNKNOWN');
  for (const field of ['providerRequested', 'providerVerified', 'modelRequested', 'modelVerified',
    'coordinatorMode', 'freshness']) assert.equal(dto.rows[0][field], 'UNKNOWN', field);
  for (const field of ['providerEvidence', 'modelEvidence', 'coordinatorEvidence', 'evidenceUrl']) {
    assert.equal(dto.rows[0][field], null, field);
  }
  assert.equal(JSON.stringify(dto).includes(REVIEWER.model), false);
  assert.equal(JSON.stringify(dto).includes('committedAtMs'), false);
  assert.deepEqual(h.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
});

test('projection empty, corrupt history, invalid context and expired snapshot never return stale rows', async () => {
  const collected = await collect();
  const empty = harness(serializedState(), collected);
  assert.equal((await empty.runtime.projectStatus({
    contextJson: context(createAtomicRecordEnvelope()), nowMs: NOW
  })).status, 'EMPTY');
  const f = await postingFixture();
  const bad = f.state.envelope();
  bad.transitionChain.at(-1).digest = '0'.repeat(64);
  const corrupt = harness(serializedState(bad), collected);
  const result = await corrupt.runtime.projectStatus({contextJson: context(bad), nowMs: NOW});
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.diagnostic, 'CANONICAL_STATE_UNAVAILABLE');
  assert.equal(Object.hasOwn(result, 'serializedDTO'), false);
  for (const [contextJson, nowMs] of [['{}', NOW], [context(f.state.envelope()), NOW + 1000]]) {
    const state = serializedState(f.state.envelope());
    const h = harness(state, collected);
    const projected = await h.runtime.projectStatus({contextJson, nowMs});
    assert.equal(projected.status, 'UNAVAILABLE');
    assert.equal(Object.hasOwn(projected, 'serializedDTO'), false);
    assert.equal(state.counts.replaces, 0);
  }
});

test('concurrent starts on independent runtime instances cannot bypass CAS, quota or single-writer gate', async () => {
  const first = await collect();
  const second = await collect({headSha: 'c'.repeat(40), runId: 7002});
  let arrivals = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const state = serializedState(undefined, {
    async beforeReplace({nextEnvelope}) {
      if (nextEnvelope.storageVersion !== 1) return;
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
    }
  });
  const a = harness(state, first);
  const b = harness(state, second);
  const results = await Promise.all([a.runtime.start(a.input), b.runtime.start(b.input)]);
  assert.equal(results.filter(result => result.status === 'REVIEW_PENDING').length, 1);
  assert.equal(results.filter(result => result.status === 'UNKNOWN').length, 1);
  assert.equal(a.calls.dispatch + b.calls.dispatch, 1);
  assert.equal(state.envelope().claims.length, 1);
  assert.equal(state.envelope().admissionState.consumedQuota, 1);
  assert.equal(state.counts.replaces, 4);
  const loser = results[0].status === 'UNKNOWN' ? a : b;
  assert.equal((await loser.runtime.start(loser.input)).reason, 'CLAIM_OUTCOME_UNKNOWN');
  assert.equal(state.envelope().claims.length, 1);
  assert.equal(a.calls.dispatch + b.calls.dispatch, 1);
});

test('same logical action with a different execution remains blocked; exhausted quota is not reset', async () => {
  const first = await collect();
  const rerun = await collect({runAttempt: 2});
  assert.equal(first.actionKey, rerun.actionKey);
  assert.notEqual(first.executionKey, rerun.executionKey);
  const state = serializedState();
  const h = harness(state, first);
  assert.equal((await h.runtime.start(h.input)).status, 'REVIEW_PENDING');
  const restarted = harness(serializedState(JSON.parse(state.serialized())), rerun);
  assert.equal((await restarted.runtime.start(restarted.input)).reason, 'CLAIM_OUTCOME_UNKNOWN');
  assert.equal(restarted.calls.dispatch, 0);
  assert.equal(restarted.config.stateTransport === state.transport, false);
  const exhaustedState = serializedState(createAtomicRecordEnvelope({totalQuota: 0}));
  const exhausted = harness(exhaustedState, first);
  assert.equal((await exhausted.runtime.start(exhausted.input)).reason, 'BUDGET_EXHAUSTED');
  assert.equal(exhausted.calls.dispatch, 0);
  assert.equal(exhaustedState.counts.replaces, 0);
});

test('lost posting write acknowledgement survives JSON restart as lookup-only', async () => {
  let loseAck = true;
  const f = await postingFixture({
    hooks: {
      afterReplace(envelope) {
        if (loseAck && envelope.claims[0].lastStage === 'RECEIPT_POSTING') {
          loseAck = false;
          throw new Error('persisted write, lost acknowledgement');
        }
      }
    }
  });
  assert.equal(f.result.reason, 'RECEIPT_POSTING_STATE_UNKNOWN');
  retainedFence(f.state.envelope(), f.collected);
  const state = serializedState(JSON.parse(f.state.serialized()));
  const h = harness(state, await collect());
  assert.equal((await h.runtime.observe(h.input)).reason, 'RECEIPT_NOT_CONFIRMED_NO_REPOST');
  assert.equal(h.calls.lookup, 1);
  assert.equal(h.calls.observe, 0);
  assert.equal(state.counts.replaces, 0);
});

test('unfinished observation fence and terminal stale-dispatch latch cannot advance after restart', async () => {
  const collected = await collect();
  for (const mode of ['observe-fence', 'stale-dispatch']) {
    let validations = 0;
    const state = serializedState(undefined, mode === 'observe-fence' ? {
      afterReplace(envelope) {
        if (envelope.claims[0].lastStage === 'OBSERVE_PREPARING') throw new Error('lost ack');
      }
    } : {});
    const h = harness(state, collected, mode === 'stale-dispatch' ? {
      async revalidate() { return ++validations === 1 ? collected : null; }
    } : {});
    await h.runtime.start(h.input);
    if (mode === 'observe-fence') await h.runtime.observe(h.input);
    const restartedState = serializedState(JSON.parse(state.serialized()));
    const restarted = harness(restartedState, await collect());
    const result = await restarted.runtime.observe(restarted.input);
    assert.equal(result.reason, mode === 'observe-fence'
      ? 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED' : 'TERMINAL_UNKNOWN_REQUIRES_MANUAL_RECONCILIATION');
    assert.equal(restartedState.counts.replaces, 0);
    assert.deepEqual(restarted.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
  }
});

test('persisted real review result resumes without re-observation; unfinished receipt preparation cannot resume', async () => {
  for (const stage of ['REVIEW_RESULT', 'RECEIPT_PREPARING']) {
    const f = await postingFixture({
      hooks: {
        afterReplace(envelope) {
          if (envelope.claims[0].lastStage === stage) throw new Error('persisted stage, lost acknowledgement');
        }
      }
    });
    assert.equal(f.state.envelope().claims[0].lastStage, stage);
    const state = serializedState(JSON.parse(f.state.serialized()));
    const h = harness(state, await collect());
    const result = await h.runtime.observe(h.input);
    assert.equal(h.calls.dispatch, 0);
    assert.equal(h.calls.observe, 0);
    assert.equal(h.calls.verify, 0);
    assert.equal(h.calls.lookup, 0);
    if (stage === 'REVIEW_RESULT') {
      assert.equal(result.reason, 'PUBLICATION_NOT_READY');
      retainedFence(state.envelope(), f.collected);
    } else {
      assert.equal(result.reason, 'PERSISTENCE_UNCERTAINTY_RECONCILE_REQUIRED');
      assert.equal(state.counts.replaces, 0);
    }
    assert.equal(state.envelope().admissionState.consumedQuota, 1);
  }
});

test('replayed posting cannot delegate lookup using a fresh but different collector diff', async () => {
  const f = await postingFixture();
  const differentDiff = await collect({diff: '+different-synthetic-change'});
  assert.equal(differentDiff.executionKey, f.collected.executionKey);
  assert.notEqual(differentDiff.diffDigest, f.collected.diffDigest);
  const state = serializedState(JSON.parse(f.state.serialized()));
  const h = harness(state, differentDiff);
  assert.equal((await h.runtime.observe(h.input)).reason, 'POSTING_STATE_OR_PAYLOAD_MISMATCH');
  assert.equal(h.calls.lookup, 0);
  assert.equal(state.counts.replaces, 0);
});

test('posting recovery rejects every corrupt canonical fence or payload field before external delegation', async t => {
  const f = await postingFixture();
  const changes = {
    status: e => { e.claims[0].status = 'REVIEWED'; },
    lastStage: e => { e.claims[0].lastStage = 'RECEIPT_PREPARING'; },
    storageVersion: e => { e.storageVersion += 1; },
    claimStorageVersion: e => { e.claims[0].storageVersion += 1; },
    revision: e => { e.snapshot.revision += 1; },
    oid: e => { e.snapshot.oid = 'foreign-tip'; },
    digest: e => { e.transitionChain.at(-1).digest = '0'.repeat(64); },
    transitionClaim: e => { e.transitionChain.at(-1).claimId = 'foreign-claim'; },
    transitionExecution: e => { e.transitionChain.at(-1).executionKey = '1'.repeat(64); },
    transitionAction: e => { e.transitionChain.at(-1).actionKey = '2'.repeat(64); },
    transitionRevision: e => { e.transitionChain.at(-1).publicRevision += 1; },
    transitionOid: e => { e.transitionChain.at(-1).publicOid = 'foreign-oid'; },
    transitionKind: e => { e.transitionChain.at(-1).kind = 'RECEIPT_PREPARING'; }
  };
  for (const field of ['actionKey', 'executionKey', 'pullRequest', 'headSha', 'baseSha', 'diffDigest',
    'reviewRequestId', 'sessionId', 'completionState', 'verdict', 'repository', 'reviewer']) {
    changes[`payload.${field}`] = e => { e.claims[0][field] = field === 'pullRequest' ? 999 : 'mismatch'; };
  }
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const envelope = f.state.envelope();
      change(envelope);
      const state = serializedState(envelope);
      const h = harness(state, await collect());
      const result = await h.runtime.observe(h.input);
      assert.equal(result.status, 'UNKNOWN');
      assert.notEqual(result.reason, 'PUBLICATION_NOT_READY');
      assert.equal(state.counts.replaces, 0);
      assert.deepEqual(h.calls, {dispatch: 0, observe: 0, verify: 0, revalidate: 0, lookup: 0});
    });
  }
});

// Adversarial self-consistent serialization is NOT authenticated history.
function rewriteConsistently(envelope, replacements) {
  const replace = value => {
    for (const [from, to] of replacements) if (value === from) return to;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    }
    return value;
  };
  const rewritten = replace(envelope);
  for (let i = 0; i < rewritten.transitionChain.length; i++) {
    const record = rewritten.transitionChain[i];
    if (i > 0) record.parentDigest = rewritten.transitionChain[i - 1].digest;
    record.transitionDigest = hash({kind: record.kind, transition: record.transition});
    record.digest = hash({
      storageVersion: record.storageVersion, parentStorageVersion: record.parentStorageVersion,
      parentDigest: record.parentDigest, kind: record.kind, claimId: record.claimId,
      actionKey: record.actionKey, executionKey: record.executionKey,
      publicRevision: record.publicRevision, publicOid: record.publicOid, transitionDigest: record.transitionDigest
    });
  }
  return rewritten;
}

test('publication validates actual replayed payload even when replacement history has valid digests and OID', async t => {
  const baseline = await postingFixture();
  const claim = baseline.state.envelope().claims[0];
  const cases = [
    ['logical action', claim.actionKey, 'd'.repeat(64)],
    ['execution', claim.executionKey, 'e'.repeat(64)],
    ['PR', PR, 1044],
    ['repository', REPO, 'Achi1984/foreign'],
    ['head', HEAD, 'c'.repeat(40)],
    ['base', BASE, 'f'.repeat(40)],
    ['diff', claim.diffDigest, '1'.repeat(64)],
    ['request', claim.reviewRequestId, 'foreign-review-request'],
    ['session', claim.sessionId, 'foreign-session'],
    ['reviewer', REVIEWER.model, 'foreign-model'],
    ['result', 'COMPLETE', 'REVISION_REQUIRED']
  ];
  for (const [name, from, to] of cases) {
    await t.test(name, async () => {
      let postingReads = 0;
      let alternate;
      const f = await postingFixture({
        hooks: {
          read(envelope) {
            if (envelope.claims[0]?.lastStage !== 'RECEIPT_POSTING') return envelope;
            if (++postingReads === 1) return envelope; // Real commit readback.
            const actualFrom = name === 'request' ? envelope.claims[0].reviewRequestId
              : name === 'session' ? envelope.claims[0].sessionId : from;
            const pairs = [[actualFrom, to]];
            if (name === 'result') pairs.push(['GREEN_LIGHT', 'REVISION_REQUIRED']);
            alternate = rewriteConsistently(envelope, pairs);
            return alternate;
          }
        }
      });
      assert.equal(f.result.reason, 'POSTING_STATE_OR_PAYLOAD_MISMATCH');
      assert.equal(f.result.externalEffects, false);
      assert.equal(f.calls.lookup, 0);
      retainedFence(f.state.envelope(), f.collected);
      const verifyingState = serializedState(alternate);
      const realBackend = createCoordinatorAtomicRecordBackend({transport: verifyingState.transport});
      assert.deepEqual(await realBackend.exportCanonicalEnvelope(), alternate);
    });
  }
});

test('restart detects self-consistent history drift between reconciliation and lookup', async () => {
  const f = await postingFixture();
  let reads = 0;
  const state = serializedState(f.state.envelope(), {
    read(envelope) {
      reads += 1;
      if (reads <= 2) return envelope; // Reconcile and initial posting validation.
      return rewriteConsistently(envelope, [[envelope.claims[0].reviewRequestId, 'foreign-request']]);
    }
  });
  const h = harness(state, await collect());
  assert.equal((await h.runtime.observe(h.input)).reason, 'POSTING_STATE_OR_PAYLOAD_MISMATCH');
  assert.equal(h.calls.lookup, 0);
  assert.equal(state.counts.replaces, 0);
});

test('canonical UNKNOWN delivery stage is not silently treated as a posting identity', async () => {
  const f = await postingFixture();
  const backend = createCoordinatorAtomicRecordBackend({transport: f.state.transport});
  const store = createCoordinatorStateStore({backend, enabled: true});
  const {claim} = await store.reconcile(f.collected.executionKey);
  const recorded = await store.commit({
    claim, transition: {kind: 'UNKNOWN', stage: 'RECEIPT_DELIVERY_UNKNOWN'}
  });
  assert.equal(recorded.status, 'COMMITTED'); // Actual state transition, not receipt delivery.
  const state = serializedState(JSON.parse(f.state.serialized()));
  const h = harness(state, await collect());
  assert.equal((await h.runtime.observe(h.input)).reason, 'POSTING_IDENTITY_RECONCILIATION_REQUIRED');
  assert.equal(h.calls.lookup, 0);
  assert.equal(state.counts.replaces, 0);
});
