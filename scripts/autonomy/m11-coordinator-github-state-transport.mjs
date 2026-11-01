import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createCoordinatorAtomicRecordBackend} from './m11-coordinator-atomic-record-backend.mjs';

const API_ORIGIN = 'https://api.github.com';
const GRAPHQL_PATH = '/graphql';
const REPOSITORY_NAME_WITH_OWNER = 'Achi1984/meridian';
const STATE_BRANCH_NAME = 'meridian-coordinator-state';
const STATE_FILE_PATH = 'state/m11-coordinator.json';
const DEFAULT_DEADLINE_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_DEADLINE_MS = 30000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_OPERATION_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_OPERATION_REQUESTS = 5;
const MAX_RESPONSE_CHUNKS = 65536;
const USER_AGENT = 'meridian-m11-github-state-transport/1.0';
const HEX40 = /^[a-f0-9]{40}$/;

export const GITHUB_STATE_TRANSPORT_PROPOSED_TARGET = Object.freeze({
  repositoryNameWithOwner: REPOSITORY_NAME_WITH_OWNER,
  branchName: STATE_BRANCH_NAME,
  path: STATE_FILE_PATH,
  provisioning: 'UNPROVISIONED'
});

export const GITHUB_STATE_TRANSPORT_ERROR = Object.freeze({
  DISABLED: 'DISABLED',
  INVALID_EXPECTED_STORAGE_VERSION: 'INVALID_EXPECTED_STORAGE_VERSION',
  INVALID_NEXT_ENVELOPE: 'INVALID_NEXT_ENVELOPE',
  INVALID_APPEND_ONLY_HISTORY: 'INVALID_APPEND_ONLY_HISTORY',
  STORAGE_VERSION_MISMATCH: 'STORAGE_VERSION_MISMATCH',
  NO_READ_BINDING: 'NO_READ_BINDING',
  LOCAL_CONCURRENT_MUTATION: 'LOCAL_CONCURRENT_MUTATION',
  SAME_VERSION_DIFFERENT_OID: 'SAME_VERSION_DIFFERENT_OID',
  TRANSPORT_UNAVAILABLE: 'TRANSPORT_UNAVAILABLE',
  REDIRECT_FORBIDDEN: 'REDIRECT_FORBIDDEN',
  OFF_ORIGIN: 'OFF_ORIGIN',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  CORRUPT_CHAIN: 'CORRUPT_CHAIN',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  MUTATION_CONFLICT: 'MUTATION_CONFLICT',
  MUTATION_UNKNOWN: 'MUTATION_UNKNOWN',
  MUTATION_ACK_LOST: 'MUTATION_ACK_LOST',
  READBACK_MISMATCH: 'READBACK_MISMATCH'
});

class GithubStateTransportError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GithubStateTransportError';
    this.code = code;
  }
}

function fail(code) {
  throw new GithubStateTransportError(code);
}

function clone(value) {
  return structuredClone(value);
}

function isSafeStorageVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function digestText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function decodeBase64Content(value) {
  if (typeof value !== 'string') fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  const sanitized = value.replace(/\r?\n/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sanitized)) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  }
  try {
    const bytes = Buffer.from(sanitized, 'base64');
    if (bytes.toString('base64') !== sanitized) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  }
}

function encodeEnvelope(envelope) {
  let text;
  try {
    text = JSON.stringify(envelope);
  } catch {
    fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
  }
  if (typeof text !== 'string') fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
  return text;
}

function parseJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  }
  return parsed;
}

function readResponseLength(response, maxResponseBytes) {
  const raw = response.headers?.get?.('content-length');
  if (raw === null || raw === undefined) return;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxResponseBytes) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
  }
}

function createOperation({signal, deadlineMs, maxResponseBytes}) {
  const controller = new AbortController();
  const deadlineAt = performance.now() + deadlineMs;
  let rejectAbort;
  let abortError = null;
  const aborted = new Promise((resolve, reject) => {
    rejectAbort = reject;
  });
  aborted.catch(() => {});
  const abort = () => {
    if (abortError) return;
    abortError = new GithubStateTransportError(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    controller.abort();
    rejectAbort(abortError);
  };
  const onAbort = () => abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', onAbort, {once: true});
  const timeout = setTimeout(abort, deadlineMs);
  let requestCount = 0;
  let totalBytes = 0;
  return {
    signal: controller.signal,
    maxResponseBytes,
    race(promise) {
      this.assertActive();
      if (abortError) return Promise.reject(abortError);
      return Promise.race([Promise.resolve(promise), aborted]);
    },
    assertActive() {
      if (!abortError && performance.now() >= deadlineAt) abort();
      if (abortError) throw abortError;
    },
    async yield() {
      await this.race(new Promise(resolve => setImmediate(resolve)));
      this.assertActive();
    },
    reserveRequest() {
      this.assertActive();
      requestCount += 1;
      if (requestCount > MAX_OPERATION_REQUESTS) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
    },
    addBytes(count) {
      totalBytes += count;
      if (totalBytes > MAX_OPERATION_BYTES) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
    },
    finish() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

async function readTextBounded(response, operation) {
  readResponseLength(response, operation.maxResponseBytes);
  const reader = response.body?.getReader?.();
  if (!reader) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let total = 0;
  let chunks = 0;
  let chunksSinceYield = 0;
  let text = '';
  const cancel = () => {
    try {
      Promise.resolve(reader.cancel()).catch(() => {});
    } catch {}
  };
  operation.signal.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      operation.assertActive();
      let chunk;
      try {
        chunk = await operation.race(reader.read());
      } catch {
        fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
      }
      operation.assertActive();
      if (chunk.done) break;
      if (!chunk.value || !ArrayBuffer.isView(chunk.value)) {
        fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
      }
      chunks += 1;
      chunksSinceYield += 1;
      if (chunks > MAX_RESPONSE_CHUNKS) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
      total += chunk.value.byteLength;
      if (total > operation.maxResponseBytes) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
      operation.addBytes(chunk.value.byteLength);
      try {
        text += decoder.decode(chunk.value, {stream: true});
      } catch {
        fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
      }
      if (chunk.value.byteLength === 0 || chunksSinceYield >= 64) {
        try {
          await operation.yield();
          chunksSinceYield = 0;
        } catch {
          fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
        }
      }
    }
    try {
      text += decoder.decode();
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }
    operation.assertActive();
    return text;
  } finally {
    operation.signal.removeEventListener('abort', cancel);
    cancel();
    try {
      reader.releaseLock();
    } catch {}
  }
}

function validateAppendOnlyHistory(currentEnvelope, nextEnvelope) {
  if (!Array.isArray(currentEnvelope.transitionChain) || !Array.isArray(nextEnvelope.transitionChain)) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_APPEND_ONLY_HISTORY);
  }
  if (nextEnvelope.transitionChain.length !== currentEnvelope.transitionChain.length + 1) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_APPEND_ONLY_HISTORY);
  }
  for (let index = 0; index < currentEnvelope.transitionChain.length; index += 1) {
    if (JSON.stringify(currentEnvelope.transitionChain[index]) !== JSON.stringify(nextEnvelope.transitionChain[index])) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_APPEND_ONLY_HISTORY);
    }
  }
}

async function canonicalReplay(envelope) {
  const readOnlyTransport = Object.freeze({
    async readCanonicalEnvelope() {
      return clone(envelope);
    },
    async replaceCanonicalEnvelope() {
      throw new Error('READ_ONLY');
    }
  });
  const backend = createCoordinatorAtomicRecordBackend({transport: readOnlyTransport});
  return backend.exportCanonicalEnvelope();
}

export function createM11CoordinatorGithubStateTransport({
  enabled = false,
  fetchImpl,
  credentials = null,
  now = Date.now,
  defaultDeadlineMs = DEFAULT_DEADLINE_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  if (!Number.isSafeInteger(defaultDeadlineMs) || defaultDeadlineMs < 1 || defaultDeadlineMs > MAX_DEADLINE_MS) {
    throw new Error('defaultDeadlineMs must be between 1 and 30000');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new Error('maxResponseBytes must be between 1024 and 1048576');
  }
  if (enabled && (!credentials || typeof credentials.getAuthorizationHeader !== 'function')) {
    throw new Error('credentials.getAuthorizationHeader is required when enabled');
  }
  if (typeof now !== 'function') throw new Error('now must be a function');

  const branchRef = `heads/${STATE_BRANCH_NAME}`;
  const storageBindings = new Map();
  const storageIdentities = new Map();
  const poisonedStorageVersions = new Set();
  const consumedStorageVersions = new Set();
  const inFlightMutations = new Set();

  async function requestJson(operation, {path, method = 'GET', body = null}) {
    operation.reserveRequest();
    const requestUrl = new URL(path, API_ORIGIN);
    let serializedBody = null;
    if (body !== null) {
      try {
        serializedBody = JSON.stringify(body);
      } catch {
        fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
      }
      operation.assertActive();
      const requestBytes = Buffer.byteLength(serializedBody, 'utf8');
      if (requestBytes > MAX_REQUEST_BYTES) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
      operation.addBytes(requestBytes);
    }
    let authorization;
    try {
      authorization = credentials?.getAuthorizationHeader?.();
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    }
    if (typeof authorization !== 'string' || authorization.length === 0 || authorization.length > 8192
      || /[\r\n]/.test(authorization)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    }
    operation.assertActive();
    let response;
    try {
      const pendingResponse = Promise.resolve(fetchImpl(requestUrl, {
        method,
        redirect: 'error',
        signal: operation.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization,
          'user-agent': USER_AGENT,
          'x-github-api-version': '2022-11-28',
          ...(body === null ? {} : {'content-type': 'application/json; charset=utf-8'})
        },
        ...(body === null ? {} : {body: serializedBody})
      }));
      pendingResponse.then(lateResponse => {
        if (!operation.signal.aborted) return;
        try {
          Promise.resolve(lateResponse?.body?.cancel?.()).catch(() => {});
        } catch {}
      }, () => {});
      response = await operation.race(pendingResponse);
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    }
    operation.assertActive();

    if (!response || typeof response.status !== 'number') {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    }
    if (response.type === 'opaqueredirect' || response.redirected) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.REDIRECT_FORBIDDEN);
    }
    let responseUrl;
    try {
      responseUrl = new URL(response.url || '');
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }
    if (responseUrl.origin !== API_ORIGIN) fail(GITHUB_STATE_TRANSPORT_ERROR.OFF_ORIGIN);
    if (responseUrl.href !== requestUrl.href) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    if (response.status >= 500) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    if (response.status === 404) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    if (response.status < 200 || response.status >= 300) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const text = await readTextBounded(response, operation);
    const payload = parseJson(text);
    operation.assertActive();
    return {status: response.status, payload};
  }

  async function readStateByRef(operation) {
    const refResponse = await requestJson(operation, {
      path: `/repos/Achi1984/meridian/git/ref/${branchRef}`
    });
    const readHeadOid = refResponse.payload?.object?.sha;
    if (refResponse.payload?.ref !== `refs/${branchRef}`
      || refResponse.payload?.object?.type !== 'commit'
      || !HEX40.test(readHeadOid)) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);

    const commitResponse = await requestJson(operation, {
      path: `/repos/Achi1984/meridian/git/commits/${readHeadOid}`
    });
    const treeSha = commitResponse.payload?.tree?.sha;
    if (commitResponse.payload?.sha !== readHeadOid || !HEX40.test(treeSha)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }

    const treeResponse = await requestJson(operation, {
      path: `/repos/Achi1984/meridian/git/trees/${treeSha}?recursive=1`
    });
    if (treeResponse.payload?.sha !== treeSha || treeResponse.payload?.truncated === true
      || !Array.isArray(treeResponse.payload?.tree)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }
    const matchingNodes = treeResponse.payload.tree.filter(entry => entry?.path === STATE_FILE_PATH);
    if (matchingNodes.length !== 1) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    const node = matchingNodes[0];
    if (!node || node.type !== 'blob' || !HEX40.test(node.sha)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }

    const blobResponse = await requestJson(operation, {
      path: `/repos/Achi1984/meridian/git/blobs/${node.sha}`
    });
    if (blobResponse.payload?.sha !== node.sha || blobResponse.payload?.encoding !== 'base64') {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }
    const envelopeText = decodeBase64Content(blobResponse.payload?.content);
    const envelopeDigest = digestText(envelopeText);
    const parsedEnvelope = parseJson(envelopeText);
    let envelope;
    try {
      envelope = await canonicalReplay(parsedEnvelope);
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.CORRUPT_CHAIN);
    }
    operation.assertActive();
    return Object.freeze({
      readHeadOid,
      envelope,
      envelopeText,
      envelopeDigest,
      observedAtMs: now()
    });
  }

  function registerReadBinding(binding) {
    const version = binding.envelope.storageVersion;
    if (poisonedStorageVersions.has(version)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID);
    }
    const identity = storageIdentities.get(version);
    if (identity && (identity.readHeadOid !== binding.readHeadOid
      || identity.envelopeDigest !== binding.envelopeDigest)) {
      storageBindings.delete(version);
      poisonedStorageVersions.add(version);
      fail(GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID);
    }
    if (!identity) storageIdentities.set(version, Object.freeze({
      readHeadOid: binding.readHeadOid,
      envelopeDigest: binding.envelopeDigest
    }));
    if (!consumedStorageVersions.has(version)) storageBindings.set(version, binding);
  }

  function consumeMutationOpportunity(expectedStorageVersion) {
    if (!isSafeStorageVersion(expectedStorageVersion)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_EXPECTED_STORAGE_VERSION);
    }
    if (poisonedStorageVersions.has(expectedStorageVersion)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID);
    }
    if (inFlightMutations.has(expectedStorageVersion)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.LOCAL_CONCURRENT_MUTATION);
    }
    if (consumedStorageVersions.has(expectedStorageVersion)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING);
    }
    const binding = storageBindings.get(expectedStorageVersion);
    if (!binding) fail(GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING);
    storageBindings.delete(expectedStorageVersion);
    consumedStorageVersions.add(expectedStorageVersion);
    inFlightMutations.add(expectedStorageVersion);
    return binding;
  }

  async function mutateWithExpectedHead(operation, {expectedHeadOid, contentText}) {
    const query = `
mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      parents(first: 1) {
        nodes {
          oid
        }
      }
    }
  }
}`.trim();
    const response = await requestJson(operation, {
      path: GRAPHQL_PATH,
      method: 'POST',
      body: {
        query,
        variables: {
          input: {
            branch: {
              repositoryNameWithOwner: REPOSITORY_NAME_WITH_OWNER,
              branchName: STATE_BRANCH_NAME
            },
            expectedHeadOid,
            message: {headline: 'm11 coordinator state update'},
            fileChanges: {
              additions: [{path: STATE_FILE_PATH, contents: Buffer.from(contentText, 'utf8').toString('base64')}]
            }
          }
        }
      }
    });

    if (Object.hasOwn(response.payload, 'errors')) {
      const errors = response.payload.errors;
      if (!Array.isArray(errors)
        || errors.some(item => !item || typeof item !== 'object' || Array.isArray(item)
          || typeof item.message !== 'string'
          || (Object.hasOwn(item, 'extensions')
            && (!item.extensions || typeof item.extensions !== 'object' || Array.isArray(item.extensions))))) {
        fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
      }
      if (errors.length > 0) {
        fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
      }
    }
    if (!response.payload.data || typeof response.payload.data !== 'object'
      || Array.isArray(response.payload.data)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const result = response.payload.data.createCommitOnBranch;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const commit = result.commit;
    if (!commit || typeof commit !== 'object' || Array.isArray(commit)
      || !Array.isArray(commit.parents?.nodes)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const commitOid = commit?.oid;
    const parentOid = commit?.parents?.nodes?.[0]?.oid;
    if (!HEX40.test(commitOid) || !HEX40.test(parentOid)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    if (parentOid !== expectedHeadOid) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_ACK_LOST);
    }
    return Object.freeze({status: 'REPLACED', commitOid});
  }

  return Object.freeze({
    enabled,
    available: enabled === true,
    disabledReason: enabled === true ? null : GITHUB_STATE_TRANSPORT_ERROR.DISABLED,
    proposedTarget: GITHUB_STATE_TRANSPORT_PROPOSED_TARGET,

    async readCanonicalEnvelope({signal = null} = {}) {
      if (enabled !== true) fail(GITHUB_STATE_TRANSPORT_ERROR.DISABLED);
      const operation = createOperation({signal, deadlineMs: defaultDeadlineMs, maxResponseBytes});
      try {
        const binding = await readStateByRef(operation);
        operation.assertActive();
        registerReadBinding(binding);
        return clone(binding.envelope);
      } finally {
        operation.finish();
      }
    },

    async replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope, signal = null}) {
      if (enabled !== true) fail(GITHUB_STATE_TRANSPORT_ERROR.DISABLED);
      const operation = createOperation({signal, deadlineMs: defaultDeadlineMs, maxResponseBytes});
      let ownsInFlightMarker = false;
      try {
        operation.assertActive();
        const binding = consumeMutationOpportunity(expectedStorageVersion);
        ownsInFlightMarker = true;
        let canonicalNext;
        try {
          canonicalNext = await canonicalReplay(nextEnvelope);
        } catch {
          fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
        }
        operation.assertActive();
        if (!isSafeStorageVersion(canonicalNext.storageVersion)) {
          fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
        }
        if (canonicalNext.storageVersion !== expectedStorageVersion + 1) {
          fail(GITHUB_STATE_TRANSPORT_ERROR.STORAGE_VERSION_MISMATCH);
        }
        validateAppendOnlyHistory(binding.envelope, canonicalNext);

        const candidateText = encodeEnvelope(canonicalNext);
        operation.assertActive();
        const candidateDigest = digestText(candidateText);
        const mutation = await mutateWithExpectedHead(operation, {
          expectedHeadOid: binding.readHeadOid,
          contentText: candidateText
        });
        operation.assertActive();
        const readback = await readStateByRef(operation);
        operation.assertActive();
        const readbackMatches = readback.readHeadOid === mutation.commitOid
          && readback.envelopeDigest === candidateDigest
          && readback.envelope.storageVersion === canonicalNext.storageVersion;
        if (!readbackMatches) fail(GITHUB_STATE_TRANSPORT_ERROR.READBACK_MISMATCH);
        registerReadBinding(readback);
        operation.assertActive();
        return Object.freeze({status: 'REPLACED', storageVersion: readback.envelope.storageVersion});
      } finally {
        if (ownsInFlightMarker) inFlightMutations.delete(expectedStorageVersion);
        operation.finish();
      }
    }
  });
}
