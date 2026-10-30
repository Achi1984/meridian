import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

import {
  createAtomicRecordEnvelope,
  createAtomicRecordMemoryTransport,
  createCoordinatorAtomicRecordBackend
} from '../scripts/autonomy/m11-coordinator-atomic-record-backend.mjs';
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

function makeResponse({status = 200, body = '{}', headers = {}, url, redirected = false}) {
  return {
    status,
    url,
    redirected,
    headers: new Headers(headers),
    body: streamFromString(body)
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
      if (typeof mutateHook === 'function') {
        const hooked = mutateHook({input, branchHead, requestUrl: requestUrl.toString()});
        if (hooked) return hooked;
      }
      const additions = input?.fileChanges?.additions;
      const path = additions?.[0]?.path;
      const content = additions?.[0]?.contents;
      if (input?.branch?.repositoryNameWithOwner !== REPOSITORY
        || input?.branch?.branchName !== STATE_BRANCH
        || input?.expectedHeadOid !== branchHead
        || !Array.isArray(additions) || additions.length !== 1
        || path !== STATE_PATH || typeof content !== 'string'
        || Array.isArray(input?.fileChanges?.deletions)) {
        return jsonResponse(requestUrl.toString(), {
          errors: [{message: 'expectedHeadOid mismatch'}]
        });
      }
      const parent = branchHead;
      const newHead = createCommitWithText(content, parent);
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
  server.setMutateHook(({input, branchHead, requestUrl}) => {
    const newHead = server.commitText(input.fileChanges.additions[0].contents);
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

  const reader = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const durable = await reader.readCanonicalEnvelope();
  assert.equal(durable.storageVersion, 1);
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
});

test('readback mismatch returns UNKNOWN after acknowledged mutation', async () => {
  const server = buildServer();
  server.setMutateHook(({input, branchHead, requestUrl}) => {
    const committedHead = server.commitText(input.fileChanges.additions[0].contents);
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

test('GraphQL mutation uses one file path, expectedHeadOid CAS, no deletions/force/main', async () => {
  const server = buildServer();
  const transport = createM11CoordinatorGithubStateTransport({
    enabled: true,
    fetchImpl: server.fetchImpl,
    credentials: credentials()
  });
  const current = await transport.readCanonicalEnvelope();
  const next = await makeNextEnvelopeFromClaim(current, {action: key('e'), execution: key('f')});
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
  assert.equal(Object.hasOwn(input.fileChanges, 'deletions'), false);
  assert.equal(Object.hasOwn(input, 'force'), false);
  assert.equal(JSON.stringify(payload).includes('main'), false);

  const restPaths = server.requestLog.map(entry => `${entry.method} ${entry.path}${entry.search}`);
  assert.ok(restPaths.some(item => item.includes(`/git/ref/heads/${STATE_BRANCH}`)));
  assert.ok(restPaths.every(item => !item.includes('/heads/main')));
  assert.deepEqual(GITHUB_STATE_TRANSPORT_PROPOSED_TARGET, {
    repositoryNameWithOwner: REPOSITORY,
    branchName: STATE_BRANCH,
    path: STATE_PATH,
    provisioning: 'UNPROVISIONED'
  });
});
