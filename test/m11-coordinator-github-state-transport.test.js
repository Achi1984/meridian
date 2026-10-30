import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
import {createCoordinatorStateStore} from '../scripts/autonomy/m11-coordinator-state-store.mjs';
import {
  createM11CoordinatorGithubStateTransport,
  GITHUB_STATE_TRANSPORT_ERROR,
  GITHUB_STATE_TRANSPORT_PROPOSED_TARGET
} from '../scripts/autonomy/m11-coordinator-github-state-transport.mjs';

const REPOSITORY = 'Achi1984/meridian';
const STATE_BRANCH = 'meridian-coordinator-state';
const STATE_PATH = 'state/m11-coordinator.json';

function key(char) {
  return char.repeat(64);
}

function oid(seed) {
  return createHash('sha1').update(seed).digest('hex');
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

function decodeGraphqlContents(content) {
  if (typeof content !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
    return null;
  }
  try {
    const bytes = Buffer.from(content, 'base64');
    if (bytes.toString('base64') !== content) return null;
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return null;
  }
}

function makeResponse({status = 200, body = '{}', headers = {}, url, redirected = false, bodyStream = null}) {
  return {
    status,
    url,
    redirected,
    headers: new Headers(headers),
    body: bodyStream ?? streamFromString(body)
  };
}

function hangingBody() {
  return {
    getReader() {
      return {
        read() {
          return new Promise(() => {});
        },
        cancel() {
          return Promise.resolve();
        },
        releaseLock() {}
      };
    }
  };
}

function zeroChunkBody() {
  return {
    getReader() {
      return {
        read() {
          return Promise.resolve({done: false, value: new Uint8Array()});
        },
        cancel() {
          return Promise.resolve();
        },
        releaseLock() {}
      };
    }
  };
}

function credentials() {
  return {
    getAuthorizationHeader() {
      return 'Bearer test-token';
    }
  };
}

function buildServer(initialEnvelope = createAtomicRecordEnvelope()) {
  const requestLog = [];
  const commits = new Map();
  const trees = new Map();
  const blobs = new Map();
  let branchHead = null;
  let sequence = 0;
  let mutateHook = null;
  let afterRefHook = null;
  let blobOverride = null;
  let forceOversize = false;
  let forceRedirect = false;
  let lastDecodedContent = null;

  function nextSha(prefix) {
    sequence += 1;
    return oid(`${prefix}-${sequence}`);
  }

  function createCommitWithText(text, parent = branchHead) {
    const blobSha = nextSha('blob');
    blobs.set(blobSha, text);
    const treeSha = nextSha('tree');
    trees.set(treeSha, [{path: STATE_PATH, type: 'blob', mode: '100644', sha: blobSha}]);
    const commitSha = nextSha('commit');
    commits.set(commitSha, {sha: commitSha, treeSha, parents: parent ? [parent] : []});
    branchHead = commitSha;
    return commitSha;
  }

  createCommitWithText(JSON.stringify(initialEnvelope), null);

  function jsonResponse(url, payload, extra = {}) {
    const text = JSON.stringify(payload);
    const headers = {'content-type': 'application/json', ...extra.headers};
    return makeResponse({
      status: extra.status ?? 200,
      body: text,
      headers: forceOversize ? {...headers, 'content-length': String(4 * 1024 * 1024)} : headers,
      url,
      redirected: forceRedirect
    });
  }

  async function fetchImpl(url, options = {}) {
    const requestUrl = typeof url === 'string' ? new URL(url) : url;
    const method = options.method ?? 'GET';
    const body = typeof options.body === 'string' ? options.body : null;
    requestLog.push({method, path: requestUrl.pathname, search: requestUrl.search, body});

    if (requestUrl.origin !== 'https://api.github.com') {
      return jsonResponse(requestUrl.toString(), {message: 'off-origin'}, {status: 404});
    }

    const branchRefPath = `/repos/${REPOSITORY}/git/ref/heads/${STATE_BRANCH}`;
    if (method === 'GET' && requestUrl.pathname === branchRefPath) {
      const response = jsonResponse(requestUrl.toString(), {
        ref: `refs/heads/${STATE_BRANCH}`,
        object: {type: 'commit', sha: branchHead}
      });
      if (typeof afterRefHook === 'function') afterRefHook();
      return response;
    }

    const commitPrefix = `/repos/${REPOSITORY}/git/commits/`;
    if (method === 'GET' && requestUrl.pathname.startsWith(commitPrefix)) {
      const commitSha = requestUrl.pathname.slice(commitPrefix.length);
      const commit = commits.get(commitSha);
      if (!commit) return jsonResponse(requestUrl.toString(), {message: 'not found'}, {status: 404});
      return jsonResponse(requestUrl.toString(), {
        sha: commit.sha,
        tree: {sha: commit.treeSha},
        parents: commit.parents.map(parent => ({sha: parent}))
      });
    }

    const treePrefix = `/repos/${REPOSITORY}/git/trees/`;
    if (method === 'GET' && requestUrl.pathname.startsWith(treePrefix)) {
      const treeSha = requestUrl.pathname.slice(treePrefix.length);
      const tree = trees.get(treeSha);
      if (!tree) return jsonResponse(requestUrl.toString(), {message: 'not found'}, {status: 404});
      return jsonResponse(requestUrl.toString(), {sha: treeSha, truncated: false, tree});
    }

    const blobPrefix = `/repos/${REPOSITORY}/git/blobs/`;
    if (method === 'GET' && requestUrl.pathname.startsWith(blobPrefix)) {
      const blobSha = requestUrl.pathname.slice(blobPrefix.length);
      const blobText = blobOverride ?? blobs.get(blobSha);
      if (blobText === undefined) return jsonResponse(requestUrl.toString(), {message: 'not found'}, {status: 404});
      return jsonResponse(requestUrl.toString(), {
        sha: blobSha,
        encoding: 'base64',
        content: Buffer.from(blobText, 'utf8').toString('base64')
      });
    }

    if (method === 'POST' && requestUrl.pathname === '/graphql') {
      const parsed = JSON.parse(body || '{}');
      const input = parsed?.variables?.input;
      const additions = input?.fileChanges?.additions;
      const path = additions?.[0]?.path;
      const contentText = decodeGraphqlContents(additions?.[0]?.contents);
      if (input?.branch?.repositoryNameWithOwner !== REPOSITORY
        || input?.branch?.branchName !== STATE_BRANCH
        || !Array.isArray(additions) || additions.length !== 1
        || path !== STATE_PATH
        || Array.isArray(input?.fileChanges?.deletions)) {
        return jsonResponse(requestUrl.toString(), {
          errors: [{message: 'invalid mutation shape'}]
        });
      }
      if (input?.expectedHeadOid !== branchHead) {
        return jsonResponse(requestUrl.toString(), {
          errors: [{message: 'expectedHeadOid mismatch', extensions: {code: 'EXPECTED_HEAD_OID_MISMATCH'}}]
        });
      }
      if (contentText === null) {
        return jsonResponse(requestUrl.toString(), {errors: [{message: 'contents must be RFC4648 base64'}]});
      }
      if (typeof mutateHook === 'function') {
        const hooked = mutateHook({input, contentText, branchHead, requestUrl: requestUrl.toString()});
        if (hooked) return hooked;
      }
      const parent = branchHead;
      lastDecodedContent = contentText;
      const newHead = createCommitWithText(contentText, parent);
      return jsonResponse(requestUrl.toString(), {
        data: {
          createCommitOnBranch: {
            commit: {
              oid: newHead,
              parents: {nodes: [{oid: parent}]}
            }
          }
        }
      });
    }

    return jsonResponse(requestUrl.toString(), {message: 'not found'}, {status: 404});
  }

  return {
    fetchImpl,
    requestLog,
    setMutateHook(hook) {
      mutateHook = hook;
    },
    setAfterRefHook(hook) {
      afterRefHook = hook;
    },
    setBlobOverride(text) {
      blobOverride = text;
    },
    setForceOversize(value) {
      forceOversize = value;
    },
    setForceRedirect(value) {
      forceRedirect = value;
    },
    lastDecodedContent() {
      return lastDecodedContent;
    },
    readHead() {
      return branchHead;
    },
    commitText(text) {
      return createCommitWithText(text, branchHead);
    },
    moveHead(sha) {
      branchHead = sha;
    }
  };
}

async function makeNextEnvelopeFromClaim(baseEnvelope, {action = key('a'), execution = key('b')} = {}) {
  const transport = createAtomicRecordMemoryTransport({initialEnvelope: baseEnvelope});
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => 1000});
  const claim = await backend.createOnlyClaim({
    actionKey: action,
    executionKey: execution,
    packetKey: key('c'),
    maxPackets: 3,
    maxActiveClaims: 1,
    owner: 'test-owner',
    expectedRevision: baseEnvelope.snapshot.revision,
    expectedOid: baseEnvelope.snapshot.oid,
    createdAt: 1000
  });
  assert.equal(claim.status, 'CREATED');
  return backend.exportCanonicalEnvelope();
}

test('default-disabled transport performs zero I/O and throws DISABLED', async () => {
  let called = false;
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: false,
    fetchImpl: async () => {
      called = true;
      throw new Error('should-not-call');
    }
  });
  assert.equal(transport.available, false);
  assert.equal(transport.disabledReason, GITHUB_STATE_TRANSPORT_ERROR.DISABLED);
  await assert.rejects(transport.readCanonicalEnvelope(), error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.DISABLED);
  assert.equal(called, false);
});

test('configuration and authorization are explicitly typed and bounded', async () => {
  const fetchImpl = async () => makeResponse({url: 'https://api.github.com/'});
  assert.throws(() => createM11CoordinatorGithubStateTransport({enabled: 1, fetchImpl}), /enabled must be a boolean/);
  assert.throws(() => createM11CoordinatorGithubStateTransport({enabled: true}), /fetchImpl must be a function/);
  assert.throws(
    () => createM11CoordinatorGithubStateTransport({enabled: false, fetchImpl, defaultDeadlineMs: 30001}),
    /defaultDeadlineMs/
  );
  assert.throws(
    () => createM11CoordinatorGithubStateTransport({enabled: false, fetchImpl, maxResponseBytes: 1024 * 1024 + 1}),
    /maxResponseBytes/
  );
  let fetchCalled = false;
  const invalidAuthorization = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: async () => {
      fetchCalled = true;
      return makeResponse({url: 'https://api.github.com/'});
    },
    credentials: {getAuthorizationHeader: () => ({})}
  });
  await assert.rejects(
    invalidAuthorization.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  assert.equal(fetchCalled, false);
});

test('real backend replay supports claim transition and restart from persisted JSON', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => 2000});
  const snapshot = await backend.readSnapshot();
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.oid, 'root');

  const created = await backend.createOnlyClaim({
    actionKey: key('a'),
    executionKey: key('b'),
    packetKey: key('c'),
    maxPackets: 3,
    maxActiveClaims: 1,
    owner: 'owner-1',
    expectedRevision: snapshot.revision,
    expectedOid: snapshot.oid,
    createdAt: 2000
  });
  assert.equal(created.status, 'CREATED');
  const envelope = await backend.exportCanonicalEnvelope();
  assert.equal(envelope.storageVersion, 1);
  assert.equal(envelope.snapshot.revision, 0);
  assert.equal(envelope.snapshot.oid, 'root');

  const restartedTransport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const restarted = createCoordinatorAtomicRecordBackend({transport: restartedTransport});
  const restartEnvelope = await restarted.exportCanonicalEnvelope();
  assert.deepEqual(restartEnvelope, envelope);
});

test('real state-store lifecycle persists history and counters across transport restart', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const backend = createCoordinatorAtomicRecordBackend({transport, now: () => 2000});
  const store = createCoordinatorStateStore({backend, enabled: true});
  const initial = await store.read();
  assert.equal(initial.status, 'READY');

  const actionKey = key('1');
  const executionKey = key('2');
  const claimed = await store.claim({
    actionKey,
    executionKey,
    packetKey: key('3'),
    expectedRevision: initial.snapshot.revision,
    expectedOid: initial.snapshot.oid,
    owner: 'transport-owner',
    now: 2000
  });
  assert.equal(claimed.status, 'CLAIMED');

  let currentClaim = claimed.claim;
  const transitions = [
    {
      kind: 'REVIEW_PENDING',
      actionKey,
      executionKey,
      reviewRequestId: 'transport-review',
      sessionId: 'transport-session',
      reviewer: {provider: 'synthetic', agent: 'agent', model: 'model', transport: 'test'},
      repository: REPOSITORY,
      pullRequest: 1,
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      diffDigest: 'c'.repeat(64),
      changedPathDigest: 'd'.repeat(64),
      changedPathCount: 1,
      runId: 9001,
      runAttempt: 1,
      workflowId: 9002,
      selectionRevision: 7,
      reviewDeadlineAt: 3000
    },
    {kind: 'DISPATCH_ACKED', reviewRequestId: 'transport-review', sessionId: 'transport-session'},
    {kind: 'OBSERVE_PREPARING'},
    {
      kind: 'REVIEW_RESULT',
      completionState: 'COMPLETE',
      verdict: 'GREEN_LIGHT',
      reviewRequestId: 'transport-review',
      sessionId: 'transport-session'
    },
    {kind: 'RECEIPT_PREPARING', completionState: 'COMPLETE', verdict: 'GREEN_LIGHT'},
    {kind: 'RECEIPT_POSTING'},
    {
      kind: 'RECEIPT_DELIVERED',
      receiptId: 'transport-receipt',
      completionState: 'COMPLETE',
      verdict: 'GREEN_LIGHT'
    }
  ];
  for (const transition of transitions) {
    const result = await store.commit({claim: currentClaim, transition});
    assert.equal(result.status, 'COMMITTED', transition.kind);
    currentClaim = result.claim;
  }

  const beforeRestart = await backend.exportCanonicalEnvelope();
  const readyBeforeRestart = await store.read();
  const reconciledBeforeRestart = await store.reconcile(executionKey);
  const transitionKinds = [
    'REVIEW_PENDING',
    'DISPATCH_ACKED',
    'OBSERVE_PREPARING',
    'REVIEW_RESULT',
    'RECEIPT_PREPARING',
    'RECEIPT_POSTING',
    'RECEIPT_DELIVERED'
  ];
  assert.deepEqual(beforeRestart.transitionChain.map(record => record.kind), ['CLAIM_CREATED', ...transitionKinds]);
  assert.equal(beforeRestart.storageVersion, 8);
  assert.equal(beforeRestart.transitionChain.length, 8);
  assert.equal(beforeRestart.snapshot.revision, 7);
  assert.equal(readyBeforeRestart.status, 'READY');
  assert.deepEqual(readyBeforeRestart.snapshot, beforeRestart.snapshot);
  assert.equal(reconciledBeforeRestart.status, 'READY');
  assert.equal(reconciledBeforeRestart.claim.lastStage, 'RECEIPT_DELIVERED');
  assert.equal(beforeRestart.admissionState.totalQuota, 3);
  assert.equal(beforeRestart.admissionState.consumedQuota, 1);
  assert.equal(beforeRestart.admissionState.activeGate, null);
  for (const kind of transitionKinds) {
    assert.equal(backend.committedTransitionCount(kind), 1, kind);
  }
  const perKindHistoryCounts = Object.fromEntries(transitionKinds.map(kind => [
    kind,
    beforeRestart.transitionChain.filter(record => record.kind === kind).length
  ]));
  assert.deepEqual(perKindHistoryCounts, Object.fromEntries(transitionKinds.map(kind => [kind, 1])));

  const persistedText = server.lastDecodedContent();
  assert.equal(persistedText, JSON.stringify(beforeRestart));
  const writes = server.requestLog.filter(entry => entry.path === '/graphql');
  assert.equal(writes.length, 8);
  const finalWrite = JSON.parse(writes.at(-1).body);
  const encodedEnvelope = finalWrite.variables.input.fileChanges.additions[0].contents;
  assert.equal(encodedEnvelope, Buffer.from(persistedText, 'utf8').toString('base64'));
  assert.equal(decodeGraphqlContents(encodedEnvelope), persistedText);

  const restartedTransport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const restartedBackend = createCoordinatorAtomicRecordBackend({transport: restartedTransport});
  const restartedStore = createCoordinatorStateStore({backend: restartedBackend, enabled: true});
  const afterRestart = await restartedBackend.exportCanonicalEnvelope();
  const readyAfterRestart = await restartedStore.read();
  const reconciledAfterRestart = await restartedStore.reconcile(executionKey);
  assert.deepEqual(afterRestart, beforeRestart);
  assert.deepEqual(readyAfterRestart, readyBeforeRestart);
  assert.equal(reconciledAfterRestart.status, 'READY');
  assert.equal(reconciledAfterRestart.claim.lastStage, 'RECEIPT_DELIVERED');
  assert.equal(afterRestart.admissionState.consumedQuota, 1);
  assert.equal(afterRestart.admissionState.activeGate, null);
});

test('replace validates wrong version, stale expected head conflict, and no binding', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current);

  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 99, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING
  );

  const t1 = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const t2 = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const e1 = await t1.readCanonicalEnvelope();
  const e2 = await t2.readCanonicalEnvelope();
  const n1 = await makeNextEnvelopeFromClaim(e1, {action: key('d'), execution: key('e')});
  const n2 = await makeNextEnvelopeFromClaim(e2, {action: key('f'), execution: key('1')});
  const winner = await t1.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: n1});
  assert.equal(winner.status, 'REPLACED');
  const loser = await t2.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: n2});
  assert.equal(loser.status, 'CONFLICT');
});

test('only explicit atomic-head mismatch evidence is a conflict', async () => {
  for (const payload of [
    {errors: [{message: 'expectedHeadOid is stale'}]},
    {data: {createCommitOnBranch: null}, errors: [{extensions: {code: 'EXPECTED_HEAD_OID_MISMATCH'}}]}
  ]) {
    const server = buildServer();
    server.setMutateHook(({requestUrl}) => makeResponse({
      status: 200,
      url: requestUrl,
      body: JSON.stringify(payload)
    }));
    const transport = createM11CoordinatorGithubStateTransport({
      enabled: true,
      fetchImpl: server.fetchImpl,
      credentials: credentials()
    });
    const current = await transport.readCanonicalEnvelope();
    const next = await makeNextEnvelopeFromClaim(current);
    await assert.rejects(
      transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
      error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN
    );
    assert.equal(server.requestLog.filter(entry => entry.path === '/graphql').length, 1);
  }
});

test('two competing transports: exactly one winner via expectedHeadOid CAS', async () => {
  const server = buildServer();
  const a = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const b = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const readA = await a.readCanonicalEnvelope();
  const readB = await b.readCanonicalEnvelope();
  const nextA = await makeNextEnvelopeFromClaim(readA, {action: key('2'), execution: key('3')});
  const nextB = await makeNextEnvelopeFromClaim(readB, {action: key('4'), execution: key('5')});
  const [left, right] = await Promise.all([
    a.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: nextA}),
    b.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: nextB})
  ]);
  const statuses = [left.status, right.status].sort();
  assert.deepEqual(statuses, ['CONFLICT', 'REPLACED']);
  const graphqlCalls = server.requestLog.filter(entry => entry.path === '/graphql');
  assert.equal(graphqlCalls.length, 2);
});

test('concurrent duplicate replace on same transport fails locally before second send', async () => {
  const server = buildServer();
  server.setMutateHook(({requestUrl}) => makeResponse({
    status: 200,
    url: requestUrl,
    body: JSON.stringify({
      data: {
        createCommitOnBranch: {
          commit: {oid: oid('slow-commit'), parents: {nodes: [{oid: server.readHead()}]}}
        }
      }
    })
  }));
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current);

  const first = transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next});
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.LOCAL_CONCURRENT_MUTATION
  );
  await assert.rejects(first, error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.READBACK_MISMATCH);
  const graphqlCalls = server.requestLog.filter(entry => entry.path === '/graphql');
  assert.equal(graphqlCalls.length, 1);
});

test('lost ACK is UNKNOWN/no-retry and persisted write is later readable', async () => {
  const server = buildServer();
  server.setMutateHook(({contentText, branchHead, requestUrl}) => {
    const newHead = server.commitText(contentText);
    return makeResponse({
      status: 200,
      url: requestUrl,
      body: JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: {oid: newHead, parents: {nodes: [{oid: `${branchHead.slice(0, 39)}0`}]}}
          }
        }
      })
    });
  });

  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current, {action: key('6'), execution: key('7')});
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MUTATION_ACK_LOST
  );
  const graphqlCalls = server.requestLog.filter(entry => entry.path === '/graphql');
  assert.equal(graphqlCalls.length, 1);

  const durable = await transport.readCanonicalEnvelope();
  assert.equal(durable.storageVersion, 1);
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING
  );
  assert.equal(server.requestLog.filter(entry => entry.path === '/graphql').length, 1);
});

test('lost ACK without a write cannot reauthorize the consumed version', async () => {
  const server = buildServer();
  server.setMutateHook(({requestUrl}) => makeResponse({
    status: 200,
    url: requestUrl,
    body: JSON.stringify({errors: [{message: 'write result was not confirmed'}]})
  }));
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current);
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN
  );
  await Promise.all([transport.readCanonicalEnvelope(), transport.readCanonicalEnvelope()]);
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING
  );
  assert.equal(server.requestLog.filter(entry => entry.path === '/graphql').length, 1);
});

test('corrupt transition chain fails closed', async () => {
  const corrupt = {
    storageVersion: 1,
    snapshot: {revision: 0, oid: 'root', chainValid: true},
    admissionState: createAtomicRecordEnvelope().admissionState,
    claims: [],
    transitionChain: [{storageVersion: 1}]
  };
  const server = buildServer(corrupt);
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  await assert.rejects(
    transport.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.CORRUPT_CHAIN
  );
});

test('same storageVersion observed at different readHeadOid is UNKNOWN', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  await transport.readCanonicalEnvelope();
  const currentText = JSON.stringify(createAtomicRecordEnvelope());
  server.commitText(currentText);
  await assert.rejects(
    transport.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID
  );
});

test('read remains immutable even if branch moves after ref resolution', async () => {
  const baseEnvelope = createAtomicRecordEnvelope();
  const nextEnvelope = await makeNextEnvelopeFromClaim(baseEnvelope, {action: key('8'), execution: key('9')});
  const server = buildServer(baseEnvelope);
  const oldHead = server.readHead();
  const newHead = server.commitText(JSON.stringify(nextEnvelope));
  server.moveHead(oldHead);
  server.setAfterRefHook(() => {
    server.moveHead(newHead);
  });

  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const read = await transport.readCanonicalEnvelope();
  assert.equal(read.storageVersion, 0);
});

test('malformed, oversize, and redirect responses fail closed', async () => {
  const serverMalformed = buildServer();
  serverMalformed.setBlobOverride('%%%');
  const malformed = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: serverMalformed.fetchImpl,
    credentials: credentials()
  });
  await assert.rejects(
    malformed.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE
  );

  const serverOversize = buildServer();
  serverOversize.setForceOversize(true);
  const oversize = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: serverOversize.fetchImpl,
    credentials: credentials()
  });
  await assert.rejects(
    oversize.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE
  );

  const serverRedirect = buildServer();
  serverRedirect.setForceRedirect(true);
  const redirected = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: serverRedirect.fetchImpl,
    credentials: credentials()
  });
  await assert.rejects(
    redirected.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.REDIRECT_FORBIDDEN
  );

  const wrongRefServer = buildServer();
  const wrongRefFetch = async (url, options) => {
    const response = await wrongRefServer.fetchImpl(url, options);
    if (new URL(url).pathname !== `/repos/${REPOSITORY}/git/ref/heads/${STATE_BRANCH}`) return response;
    return makeResponse({
      url: response.url,
      body: JSON.stringify({
        ref: 'refs/heads/main',
        object: {type: 'commit', sha: wrongRefServer.readHead()}
      })
    });
  };
  const wrongRef = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: wrongRefFetch,
    credentials: credentials()
  });
  await assert.rejects(
    wrongRef.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE
  );

  const wrongUrlServer = buildServer();
  const wrongUrlFetch = async (url, options) => {
    const response = await wrongUrlServer.fetchImpl(url, options);
    if (new URL(url).pathname !== `/repos/${REPOSITORY}/git/ref/heads/${STATE_BRANCH}`) return response;
    return {...response, url: 'https://api.github.com/repos/Achi1984/meridian/git/ref/heads/main'};
  };
  const wrongUrl = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: wrongUrlFetch,
    credentials: credentials()
  });
  await assert.rejects(
    wrongUrl.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE
  );

  const invalidUtf8Server = buildServer();
  const invalidUtf8Fetch = async (url, options) => {
    const response = await invalidUtf8Server.fetchImpl(url, options);
    if (!new URL(url).pathname.startsWith(`/repos/${REPOSITORY}/git/blobs/`)) return response;
    const payload = JSON.parse(await new Response(response.body).text());
    payload.content = '/w==';
    return makeResponse({url: response.url, body: JSON.stringify(payload)});
  };
  const invalidUtf8 = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: invalidUtf8Fetch,
    credentials: credentials()
  });
  await assert.rejects(
    invalidUtf8.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE
  );
});

test('commit, tree, blob, and state-path identities must match the requested resources', async () => {
  const cases = [
    {
      name: 'commit SHA',
      matches: path => path.startsWith(`/repos/${REPOSITORY}/git/commits/`),
      corrupt: payload => {
        payload.sha = oid('wrong-commit');
      }
    },
    {
      name: 'tree SHA',
      matches: path => path.startsWith(`/repos/${REPOSITORY}/git/trees/`),
      corrupt: payload => {
        payload.sha = oid('wrong-tree');
      }
    },
    {
      name: 'blob SHA',
      matches: path => path.startsWith(`/repos/${REPOSITORY}/git/blobs/`),
      corrupt: payload => {
        payload.sha = oid('wrong-blob');
      }
    },
    {
      name: 'unique state path',
      matches: path => path.startsWith(`/repos/${REPOSITORY}/git/trees/`),
      corrupt: payload => {
        payload.tree.push({...payload.tree[0]});
      }
    }
  ];
  for (const testCase of cases) {
    const server = buildServer();
    const fetchImpl = async (url, options) => {
      const response = await server.fetchImpl(url, options);
      if (!testCase.matches(new URL(url).pathname)) return response;
      const payload = JSON.parse(await new Response(response.body).text());
      testCase.corrupt(payload);
      return makeResponse({url: response.url, body: JSON.stringify(payload)});
    };
    const transport = createM11CoordinatorGithubStateTransport({
      enabled: true,
      fetchImpl,
      credentials: credentials()
    });
    await assert.rejects(
      transport.readCanonicalEnvelope(),
      error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE,
      testCase.name
    );
  }
});

test('one deadline covers response bodies, ignored aborts, and empty chunks', async () => {
  const hangingServer = buildServer();
  let hangingCalls = 0;
  const hangingFetch = async (url, options) => {
    hangingCalls += 1;
    const response = await hangingServer.fetchImpl(url, options);
    return {...response, body: hangingBody()};
  };
  const hanging = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: hangingFetch,
    credentials: credentials(),
    defaultDeadlineMs: 20
  });
  await assert.rejects(
    hanging.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(hangingCalls, 1);
  assert.equal(hangingServer.requestLog.length, 1);

  const emptyServer = buildServer();
  const emptyFetch = async (url, options) => {
    const response = await emptyServer.fetchImpl(url, options);
    return {...response, body: zeroChunkBody()};
  };
  const emptyStream = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: emptyFetch,
    credentials: credentials(),
    defaultDeadlineMs: 20
  });
  await assert.rejects(
    emptyStream.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  assert.equal(emptyServer.requestLog.length, 1);

  const delayedServer = buildServer();
  let delayedCalls = 0;
  const delayedFetch = (url, options) => {
    delayedCalls += 1;
    return new Promise(resolve => {
      setTimeout(() => resolve(makeResponse({url: new URL(url).toString()})), 50);
    });
  };
  const delayed = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: delayedFetch,
    credentials: credentials(),
    defaultDeadlineMs: 10
  });
  await assert.rejects(
    delayed.readCanonicalEnvelope(),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(delayedCalls, 1);
  assert.equal(delayedServer.requestLog.length, 0);
});

test('abort before mutation and during readback sends no follow-up requests', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current);
  const beforeMutation = new AbortController();
  beforeMutation.abort();
  await assert.rejects(
    transport.replaceCanonicalEnvelope({
      expectedStorageVersion: 0,
      nextEnvelope: next,
      signal: beforeMutation.signal
    }),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  assert.equal(server.requestLog.filter(entry => entry.path === '/graphql').length, 0);

  const readbackServer = buildServer();
  const readbackAbort = new AbortController();
  let postSeen = false;
  const readbackFetch = async (url, options) => {
    const requestUrl = new URL(url);
    if (postSeen && requestUrl.pathname.endsWith(`/git/ref/heads/${STATE_BRANCH}`)) {
      return makeResponse({
        url: requestUrl.toString(),
        bodyStream: hangingBody()
      });
    }
    const response = await readbackServer.fetchImpl(url, options);
    if (requestUrl.pathname === '/graphql') {
      postSeen = true;
      setTimeout(() => readbackAbort.abort(), 5);
    }
    return response;
  };
  const duringReadback = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: readbackFetch,
    credentials: credentials(),
    defaultDeadlineMs: 1000
  });
  const readbackCurrent = await duringReadback.readCanonicalEnvelope();
  const readbackNext = await makeNextEnvelopeFromClaim(readbackCurrent);
  await assert.rejects(
    duringReadback.replaceCanonicalEnvelope({
      expectedStorageVersion: 0,
      nextEnvelope: readbackNext,
      signal: readbackAbort.signal
    }),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE
  );
  const afterPost = readbackServer.requestLog.filter(entry => entry.path === '/graphql').length;
  assert.equal(afterPost, 1);
  assert.equal(readbackServer.requestLog.filter(entry => entry.path.includes('/git/commits/')).length, 1);
});

test('readback mismatch returns UNKNOWN after acknowledged mutation', async () => {
  const server = buildServer();
  server.setMutateHook(({input, branchHead, requestUrl}) => {
    const committedHead = server.commitText(decodeGraphqlContents(input.fileChanges.additions[0].contents));
    server.commitText(JSON.stringify(createAtomicRecordEnvelope()));
    return makeResponse({
      status: 200,
      url: requestUrl,
      body: JSON.stringify({
        data: {
          createCommitOnBranch: {
            commit: {oid: committedHead, parents: {nodes: [{oid: branchHead}]}}
          }
        }
      })
    });
  });
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current, {action: key('a'), execution: key('d')});
  await assert.rejects(
    transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next}),
    error => error?.code === GITHUB_STATE_TRANSPORT_ERROR.READBACK_MISMATCH
  );
});

test('GraphQL mutation base64-encodes exact contents and uses expectedHeadOid CAS', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current, {action: key('e'), execution: key('f')});
  const headBefore = server.readHead();
  const result = await transport.replaceCanonicalEnvelope({expectedStorageVersion: 0, nextEnvelope: next});
  assert.equal(result.status, 'REPLACED');

  const graphql = server.requestLog.find(entry => entry.path === '/graphql');
  assert.ok(graphql);
  const payload = JSON.parse(graphql.body);
  const input = payload.variables.input;
  assert.equal(input.branch.repositoryNameWithOwner, REPOSITORY);
  assert.equal(input.branch.branchName, STATE_BRANCH);
  assert.equal(input.fileChanges.additions.length, 1);
  assert.equal(input.fileChanges.additions[0].path, STATE_PATH);
  assert.equal(
    input.fileChanges.additions[0].contents,
    Buffer.from(JSON.stringify(next), 'utf8').toString('base64')
  );
  assert.equal(server.lastDecodedContent(), JSON.stringify(next));
  assert.equal(Object.hasOwn(input.fileChanges, 'deletions'), false);
  assert.equal(Object.hasOwn(input, 'force'), false);
  assert.equal(JSON.stringify(payload).includes('main'), false);

  const restPaths = server.requestLog.map(entry => `${entry.method} ${entry.path}${entry.search}`);
  assert.ok(restPaths.some(item => item.includes(`/git/ref/heads/${STATE_BRANCH}`)));
  assert.ok(restPaths.every(item => !item.includes('/heads/main')));

  const plaintextPayload = structuredClone(payload);
  plaintextPayload.variables.input.expectedHeadOid = server.readHead();
  plaintextPayload.variables.input.fileChanges.additions[0].contents = JSON.stringify(next);
  const headBeforePlaintext = server.readHead();
  const plaintextResponse = await server.fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    body: JSON.stringify(plaintextPayload)
  });
  const plaintextResult = await new Response(plaintextResponse.body).json();
  assert.match(plaintextResult.errors[0].message, /RFC4648 base64/);
  assert.equal(server.readHead(), headBeforePlaintext);
  assert.notEqual(server.readHead(), headBefore);
  assert.deepEqual(GITHUB_STATE_TRANSPORT_PROPOSED_TARGET, {
    repositoryNameWithOwner: REPOSITORY,
    branchName: STATE_BRANCH,
    path: STATE_PATH,
    provisioning: 'UNPROVISIONED'
  });
});
