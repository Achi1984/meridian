import {createHash} from 'node:crypto';
import {createCoordinatorAtomicRecordBackend} from './m11-coordinator-atomic-record-backend.mjs';

const API_ORIGIN = 'https://api.github.com';
const GRAPHQL_PATH = '/graphql';
const REPOSITORY_NAME_WITH_OWNER = 'Achi1984/meridian';
const STATE_BRANCH_NAME = 'meridian-coordinator-state';
const STATE_FILE_PATH = 'state/m11-coordinator.json';
const DEFAULT_DEADLINE_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
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
  let sanitized = value.replace(/\n/g, '');
  if (sanitized.length === 0 || sanitized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(sanitized)) {
    fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  }
  try {
    return Buffer.from(sanitized, 'base64').toString('utf8');
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

function bindAbort(signal, controller) {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, {once: true});
  return () => signal.removeEventListener('abort', abort);
}

async function readTextBounded(response, {signal, maxResponseBytes}) {
  readResponseLength(response, maxResponseBytes);
  const reader = response.body?.getReader?.();
  if (!reader) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let total = 0;
  let text = '';
  const cancel = () => {
    try {
      Promise.resolve(reader.cancel()).catch(() => {});
    } catch {}
  };
  signal?.addEventListener?.('abort', cancel, {once: true});
  try {
    while (true) {
      if (signal?.aborted) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
      }
      if (signal?.aborted) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxResponseBytes) fail(GITHUB_STATE_TRANSPORT_ERROR.RESPONSE_TOO_LARGE);
      text += decoder.decode(chunk.value, {stream: true});
    }
    text += decoder.decode();
    return text;
  } finally {
    signal?.removeEventListener?.('abort', cancel);
    cancel();
    try {
      reader.releaseLock();
    } catch {}
  }
}

function isMutationConflict(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.every(item => {
    const message = typeof item?.message === 'string' ? item.message : '';
    return /expectedHeadOid|head oid|head sha|stale/i.test(message);
  });
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
  fetchImpl = globalThis.fetch,
  credentials = null,
  now = Date.now,
  defaultDeadlineMs = DEFAULT_DEADLINE_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  if (!Number.isSafeInteger(defaultDeadlineMs) || defaultDeadlineMs < 1) {
    throw new Error('defaultDeadlineMs must be a positive integer');
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024) {
    throw new Error('maxResponseBytes must be >= 1024');
  }
  if (enabled && (!credentials || typeof credentials.getAuthorizationHeader !== 'function')) {
    throw new Error('credentials.getAuthorizationHeader is required when enabled');
  }
  if (typeof now !== 'function') throw new Error('now must be a function');

  const branchRef = `heads/${STATE_BRANCH_NAME}`;
  const storageBindings = new Map();
  const poisonedStorageVersions = new Set();
  const inFlightMutations = new Set();

  async function requestJson({path, method = 'GET', body = null, signal = null}) {
    const timeoutController = new AbortController();
    const releaseAbort = bindAbort(signal, timeoutController);
    const timeout = setTimeout(() => timeoutController.abort(new Error('TIMEOUT')), defaultDeadlineMs);
    let response;
    try {
      response = await fetchImpl(new URL(path, API_ORIGIN), {
        method,
        redirect: 'error',
        signal: timeoutController.signal,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: credentials?.getAuthorizationHeader?.(),
          'user-agent': USER_AGENT,
          'x-github-api-version': '2022-11-28',
          ...(body === null ? {} : {'content-type': 'application/json; charset=utf-8'})
        },
        ...(body === null ? {} : {body: JSON.stringify(body)})
      });
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
      releaseAbort();
    }

    if (!response || typeof response.status !== 'number') {
      fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    }
    if (response.type === 'opaqueredirect' || response.redirected) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.REDIRECT_FORBIDDEN);
    }
    const responseUrl = new URL(response.url || '', API_ORIGIN);
    if (responseUrl.origin !== API_ORIGIN) fail(GITHUB_STATE_TRANSPORT_ERROR.OFF_ORIGIN);
    if (response.status >= 500) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    if (response.status === 404) fail(GITHUB_STATE_TRANSPORT_ERROR.TRANSPORT_UNAVAILABLE);
    if (response.status === 409) {
      return {status: 409, payload: null};
    }
    if (response.status < 200 || response.status >= 300) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const text = await readTextBounded(response, {signal, maxResponseBytes});
    const payload = parseJson(text);
    return {status: response.status, payload};
  }

  async function readStateByRef() {
    const refResponse = await requestJson({
      path: `/repos/Achi1984/meridian/git/ref/${branchRef}`
    });
    const readHeadOid = refResponse.payload?.object?.sha;
    if (!HEX40.test(readHeadOid)) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);

    const commitResponse = await requestJson({
      path: `/repos/Achi1984/meridian/git/commits/${readHeadOid}`
    });
    const treeSha = commitResponse.payload?.tree?.sha;
    if (!HEX40.test(treeSha)) fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);

    const treeResponse = await requestJson({
      path: `/repos/Achi1984/meridian/git/trees/${treeSha}?recursive=1`
    });
    if (treeResponse.payload?.truncated === true || !Array.isArray(treeResponse.payload?.tree)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }
    const node = treeResponse.payload.tree.find(entry => entry?.path === STATE_FILE_PATH);
    if (!node || node.type !== 'blob' || !HEX40.test(node.sha)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    }

    const blobResponse = await requestJson({
      path: `/repos/Achi1984/meridian/git/blobs/${node.sha}`
    });
    if (blobResponse.payload?.encoding !== 'base64') fail(GITHUB_STATE_TRANSPORT_ERROR.MALFORMED_RESPONSE);
    const envelopeText = decodeBase64Content(blobResponse.payload?.content);
    const envelopeDigest = digestText(envelopeText);
    const parsedEnvelope = parseJson(envelopeText);
    let envelope;
    try {
      envelope = await canonicalReplay(parsedEnvelope);
    } catch {
      fail(GITHUB_STATE_TRANSPORT_ERROR.CORRUPT_CHAIN);
    }
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
    const existing = storageBindings.get(version);
    if (existing && existing.readHeadOid !== binding.readHeadOid) {
      storageBindings.delete(version);
      poisonedStorageVersions.add(version);
      fail(GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID);
    }
    if (existing && existing.envelopeDigest !== binding.envelopeDigest) {
      storageBindings.delete(version);
      poisonedStorageVersions.add(version);
      fail(GITHUB_STATE_TRANSPORT_ERROR.SAME_VERSION_DIFFERENT_OID);
    }
    storageBindings.set(version, binding);
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
    const binding = storageBindings.get(expectedStorageVersion);
    if (!binding) fail(GITHUB_STATE_TRANSPORT_ERROR.NO_READ_BINDING);
    storageBindings.delete(expectedStorageVersion);
    inFlightMutations.add(expectedStorageVersion);
    return binding;
  }

  async function mutateWithExpectedHead({expectedHeadOid, contentText}) {
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
    const response = await requestJson({
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
              additions: [{path: STATE_FILE_PATH, contents: contentText}]
            }
          }
        }
      }
    });

    if (response.status === 409) return Object.freeze({status: 'CONFLICT'});
    if (Array.isArray(response.payload?.errors) && response.payload.errors.length > 0) {
      if (isMutationConflict(response.payload.errors)) {
        return Object.freeze({status: 'CONFLICT'});
      }
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_UNKNOWN);
    }
    const commit = response.payload?.data?.createCommitOnBranch?.commit;
    const commitOid = commit?.oid;
    const parentOid = commit?.parents?.nodes?.[0]?.oid;
    if (!HEX40.test(commitOid) || !HEX40.test(parentOid)) {
      fail(GITHUB_STATE_TRANSPORT_ERROR.MUTATION_ACK_LOST);
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
      const binding = await readStateByRef({signal});
      registerReadBinding(binding);
      return clone(binding.envelope);
    },

    async replaceCanonicalEnvelope({expectedStorageVersion, nextEnvelope, signal = null}) {
      if (enabled !== true) fail(GITHUB_STATE_TRANSPORT_ERROR.DISABLED);
      const binding = consumeMutationOpportunity(expectedStorageVersion);
      try {
        let canonicalNext;
        try {
          canonicalNext = await canonicalReplay(nextEnvelope);
        } catch {
          fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
        }
        if (!isSafeStorageVersion(canonicalNext.storageVersion)) {
          fail(GITHUB_STATE_TRANSPORT_ERROR.INVALID_NEXT_ENVELOPE);
        }
        if (canonicalNext.storageVersion !== expectedStorageVersion + 1) {
          fail(GITHUB_STATE_TRANSPORT_ERROR.STORAGE_VERSION_MISMATCH);
        }
        validateAppendOnlyHistory(binding.envelope, canonicalNext);

        const candidateText = encodeEnvelope(canonicalNext);
        const candidateDigest = digestText(candidateText);
        const mutation = await mutateWithExpectedHead({
          expectedHeadOid: binding.readHeadOid,
          contentText: candidateText,
          signal
        });
        if (mutation.status === 'CONFLICT') {
          return Object.freeze({status: 'CONFLICT', storageVersion: expectedStorageVersion});
        }
        const readback = await readStateByRef({signal});
        const readbackMatches = readback.readHeadOid === mutation.commitOid
          && readback.envelopeDigest === candidateDigest
          && readback.envelope.storageVersion === canonicalNext.storageVersion;
        if (!readbackMatches) fail(GITHUB_STATE_TRANSPORT_ERROR.READBACK_MISMATCH);
        storageBindings.set(readback.envelope.storageVersion, readback);
        return Object.freeze({status: 'REPLACED', storageVersion: readback.envelope.storageVersion});
      } finally {
        inFlightMutations.delete(expectedStorageVersion);
      }
    }
  });
}
