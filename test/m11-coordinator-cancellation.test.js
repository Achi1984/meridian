import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAtomicRecordEnvelope,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {
  createM11CoordinatorGithubStateTransport,
  GITHUB_STATE_TRANSPORT_ERROR
} from '../scripts/autonomy/m11-coordinator-github-state-transport.mjs';

const START = 1700000000000;
const ACTION_KEY = 'a'.repeat(64);
const EXECUTION_KEY = 'b'.repeat(64);
const PACKET_KEY = 'c'.repeat(64);

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return {promise, resolve};
}

function fixture() {
  let canonical = structuredClone(createAtomicRecordEnvelope());
  const hooks = {beforeRead: null, beforeReplace: null, afterReplace: null};
  const calls = {reads: [], replaces: [], writes: 0};
  const transport = {
    async readCanonicalEnvelope({signal} = {}) {
      calls.reads.push(signal);
      if (typeof hooks.beforeRead === 'function') {
        await hooks.beforeRead({signal, envelope: structuredClone(canonical)});
      }
      return structuredClone(canonical);
    },
    async replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope, signal} = {}) {
      calls.replaces.push(signal);
      if (typeof hooks.beforeReplace === 'function') {
        await hooks.beforeReplace({signal, expectedStorageVersion, nextEnvelope});
      }
      if (signal?.aborted) throw new Error('TRANSPORT_ABORTED_BEFORE_WRITE');
      if (canonical.storageVersion !== expectedStorageVersion) {
        return {status: 'CONFLICT', storageVersion: canonical.storageVersion};
      }
      canonical = structuredClone(nextEnvelope);
      calls.writes += 1;
      if (typeof hooks.afterReplace === 'function') {
        await hooks.afterReplace({signal, envelope: structuredClone(canonical)});
      }
      return {status: 'REPLACED', storageVersion: canonical.storageVersion};
    }
  };
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => START});
  const store = createCoordinatorStateStore({backend, enabled: true});
  return {
    backend,
    calls,
    hooks,
    store,
    transport,
    envelope: () => structuredClone(canonical),
    restart() {
      const restartedBackend = createCoordinatorAtomicRecordBackend({transport, now: () => START});
      return {
        backend: restartedBackend,
        store: createCoordinatorStateStore({backend: restartedBackend, enabled: true})
      };
    }
  };
}

function claimInput(signal) {
  return {
    actionKey: ACTION_KEY,
    executionKey: EXECUTION_KEY,
    packetKey: PACKET_KEY,
    expectedRevision: 0,
    expectedOid: 'root',
    owner: 'cancel-test',
    now: START,
    ...(signal ? {signal} : {})
  };
}

async function createClaim(store) {
  const result = await store.claim(claimInput());
  assert.equal(result.status, 'CLAIMED');
  return result.claim;
}

function pendingTransition(claim) {
  return {
    kind: 'REVIEW_PENDING',
    actionKey: claim.actionKey,
    executionKey: claim.executionKey,
    reviewRequestId: 'request-cancel',
    sessionId: 'session-cancel',
    reviewer: {provider: 'synthetic', agent: 'agent', model: 'model', transport: 'test'},
    repository: 'Achi1984/meridian',
    pullRequest: 973,
    headSha: 'd'.repeat(40),
    baseSha: 'e'.repeat(40),
    diffDigest: 'f'.repeat(64),
    changedPathDigest: '1'.repeat(64),
    changedPathCount: 1,
    runId: 7001,
    runAttempt: 1,
    workflowId: 347821227,
    selectionRevision: 20,
    reviewDeadlineAt: START + 1000
  };
}

test('pre-aborted store operations perform no backend reads or writes', async () => {
  const {calls, store} = fixture();
  const controller = new AbortController();
  controller.abort();

  assert.equal((await store.read({signal: controller.signal})).reason, 'STATE_READ_ABORTED');
  assert.equal((await store.claim(claimInput(controller.signal))).status, 'CLAIM_UNKNOWN');
  assert.equal((await store.commit({
    claim: {},
    transition: {},
    signal: controller.signal
  })).status, 'UNKNOWN_RECONCILE');
  assert.equal((await store.reconcile(EXECUTION_KEY, {signal: controller.signal})).status, 'UNKNOWN');
  assert.deepEqual(calls, {reads: [], replaces: [], writes: 0});
});

test('abort during read is propagated and prevents later mutation work', async () => {
  const {calls, hooks, store} = fixture();
  const controller = new AbortController();
  const readStarted = deferred();
  const finishRead = deferred();
  hooks.beforeRead = async ({signal}) => {
    assert.equal(signal, controller.signal);
    readStarted.resolve();
    await finishRead.promise;
  };

  const pending = store.read({signal: controller.signal});
  await readStarted.promise;
  controller.abort();
  finishRead.resolve();

  assert.equal((await pending).reason, 'STATE_READ_ABORTED');
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.reads[0], controller.signal);
  assert.equal(calls.replaces.length, 0);
  assert.equal(calls.writes, 0);
});

test('store cancellation reaches the actual GitHub transport request', async () => {
  const controller = new AbortController();
  const requestStarted = deferred();
  let requestSignal;
  let requests = 0;
  const githubTransport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: (_url, options) => {
      requests += 1;
      requestSignal = options.signal;
      requestStarted.resolve();
      return new Promise(() => {});
    },
    credentials: {getAuthorizationHeader: () => '******'},
    defaultDeadlineMs: 1000
  });
  const backend = createCoordinatorAtomicRecordBackend({transport: githubTransport});
  const store = createCoordinatorStateStore({backend, enabled: true});

  const pending = store.read({signal: controller.signal});
  await requestStarted.promise;
  controller.abort();

  assert.equal((await pending).reason, 'STATE_READ_ABORTED');
  assert.equal(requests, 1);
  assert.ok(requestSignal instanceof AbortSignal);
  assert.equal(requestSignal.aborted, true);
});

test('abort before compare-and-swap prevents starting a replacement', async () => {
  const {calls, hooks, store} = fixture();
  const claim = await createClaim(store);
  const replacementsBefore = calls.replaces.length;
  const controller = new AbortController();
  hooks.beforeRead = async ({signal}) => {
    assert.equal(signal, controller.signal);
    controller.abort();
  };

  const result = await store.commit({
    claim,
    transition: pendingTransition(claim),
    signal: controller.signal
  });
  assert.equal(result.status, 'UNKNOWN_RECONCILE');
  assert.equal(calls.replaces.length, replacementsBefore);
  assert.equal(calls.writes, 1);
});

test('lost acknowledgement remains unknown and restart/duplicate cannot repeat the write', async () => {
  const state = fixture();
  const claim = await createClaim(state.store);
  state.hooks.afterReplace = async ({envelope}) => {
    if (envelope.transitionChain.at(-1)?.kind === 'REVIEW_PENDING') {
      throw new Error('LOST_ACK_AFTER_COMMIT');
    }
  };

  const uncertain = await state.store.commit({claim, transition: pendingTransition(claim)});
  assert.equal(uncertain.status, 'UNKNOWN_RECONCILE');
  assert.equal(state.envelope().claims[0].lastStage, 'REVIEW_PENDING');
  const writesAfterUnknown = state.calls.writes;

  const restarted = state.restart();
  const durable = await restarted.store.reconcile(EXECUTION_KEY);
  assert.equal(durable.status, 'READY');
  assert.equal(durable.claim.lastStage, 'REVIEW_PENDING');
  const duplicate = await restarted.store.commit({claim, transition: pendingTransition(claim)});
  assert.equal(duplicate.status, 'CONFLICT_RECONCILE');
  assert.equal(state.calls.writes, writesAfterUnknown);
});

test('abort during readback preserves the possible commit and stops subsequent work', async () => {
  const state = fixture();
  const claim = await createClaim(state.store);
  const controller = new AbortController();
  const readbackStarted = deferred();
  const finishReadback = deferred();
  let readsInCommit = 0;
  state.hooks.beforeRead = async ({signal}) => {
    readsInCommit += 1;
    assert.equal(signal, controller.signal);
    if (readsInCommit === 2) {
      readbackStarted.resolve();
      await finishReadback.promise;
    }
  };

  const replacementsBefore = state.calls.replaces.length;
  const pending = state.store.commit({
    claim,
    transition: pendingTransition(claim),
    signal: controller.signal
  });
  await readbackStarted.promise;
  controller.abort();
  finishReadback.resolve();

  assert.equal((await pending).status, 'UNKNOWN_RECONCILE');
  assert.equal(state.calls.replaces.length, replacementsBefore + 1);
  assert.equal(state.calls.writes, replacementsBefore + 1);
  assert.equal(state.envelope().claims[0].lastStage, 'REVIEW_PENDING');
  assert.equal(state.calls.reads.at(-1), controller.signal);
});

test('transport cancellation removes its listener and clears its independent deadline timer', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = [];
  const cleared = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = realSetTimeout(callback, delay, ...args);
    timers.push({timer, delay});
    return timer;
  };
  globalThis.clearTimeout = timer => {
    if (timers.some(entry => entry.timer === timer)) cleared.push(timer);
    return realClearTimeout(timer);
  };

  const controller = new AbortController();
  const listeners = {added: [], removed: []};
  const signal = {
    get aborted() {
      return controller.signal.aborted;
    },
    addEventListener(type, listener, options) {
      listeners.added.push({type, listener, options});
      controller.signal.addEventListener(type, listener, options);
    },
    removeEventListener(type, listener) {
      listeners.removed.push({type, listener});
      controller.signal.removeEventListener(type, listener);
    }
  };
  const fetchStarted = deferred();
  let fetchCalls = 0;
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: () => {
      fetchCalls += 1;
      fetchStarted.resolve();
      return new Promise(() => {});
    },
    credentials: {getAuthorizationHeader: () => '******'},
    defaultDeadlineMs: 1000
  });

  try {
    const pending = transport.readCanonicalEnvelope({signal});
    await fetchStarted.promise;
    controller.abort();
    await assert.rejects(pending,
      error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }

  assert.equal(fetchCalls, 1);
  assert.equal(listeners.added.length, 1);
  assert.equal(listeners.removed.length, 1);
  assert.equal(listeners.added[0].listener, listeners.removed[0].listener);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);
  assert.deepEqual(cleared, [timers[0].timer]);
});
