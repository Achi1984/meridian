import { types } from 'node:util';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const STORE_FILE = 'replay-store.json';
const PENDING_FILE = 'replay-store.pending';
const LOCK_FILE = 'writer.lock';
const GENESIS = '0'.repeat(64);
const LIMIT_BYTES = 1024 * 1024;
const MAX_ENTRIES = 128;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FAILPOINTS = Object.freeze(['AFTER_PENDING_WRITE', 'AFTER_RENAME']);

export class ReplayStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReplayStoreError';
    this.code = code;
  }
}
const fail = code => {
  throw new ReplayStoreError(code);
};
const must = (ok, code) => {
  if (!ok) fail(code);
};
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function exactKeys(value, keys, code) {
  must(value !== null && typeof value === 'object' && !types.isProxy(value)
    && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, code);
  const names = Reflect.ownKeys(value);
  must(names.length === keys.length && names.every(k => typeof k === 'string' && keys.includes(k)), code);
}

function canonicalJson(input) {
  const seen = new Set();
  const walk = (value, depth) => {
    must(depth <= 12, 'HASH_CANONICAL_INVALID');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      must(Number.isSafeInteger(value), 'HASH_CANONICAL_INVALID');
      return value;
    }
    if (typeof value === 'string') {
      must(value.isWellFormed(), 'HASH_CANONICAL_INVALID');
      return value;
    }
    must(value !== null && typeof value === 'object' && !types.isProxy(value), 'HASH_CANONICAL_INVALID');
    must(Object.getPrototypeOf(value) === (Array.isArray(value) ? Array.prototype : Object.prototype), 'HASH_CANONICAL_INVALID');
    must(!seen.has(value), 'HASH_CANONICAL_INVALID');
    seen.add(value);
    const names = Reflect.ownKeys(value);
    must(names.every(name => typeof name === 'string'), 'HASH_CANONICAL_INVALID');
    const read = name => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      must(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'HASH_CANONICAL_INVALID');
      return walk(descriptor.value, depth + 1);
    };
    let result;
    if (Array.isArray(value)) {
      must(names.length === value.length + 1 && names.every(name => name === 'length' || /^(0|[1-9][0-9]*)$/.test(name)), 'HASH_CANONICAL_INVALID');
      result = Array.from({ length: value.length }, (_, index) => read(String(index)));
    } else {
      must(!names.some(name => name === '__proto__' || name === 'constructor' || name === 'prototype'), 'HASH_CANONICAL_INVALID');
      result = {};
      for (const name of [...names].sort()) result[name] = read(name);
    }
    seen.delete(value);
    return result;
  };
  return JSON.stringify(walk(input, 0));
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function strictRecord(value, keys, code = 'INVALID_OBJECT') {
  must(value !== null && typeof value === 'object' && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype, code);
  const names = Reflect.ownKeys(value);
  must(names.length === keys.length && names.every(k => typeof k === 'string' && keys.includes(k)), code);
  const copy = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    must(d && d.enumerable && Object.hasOwn(d, 'value'), 'ACCESSOR_OR_HIDDEN_FIELD');
    copy[key] = d.value;
  }
  return Object.freeze(copy);
}

function validateStoreScope(scope) {
  const v = strictRecord(scope, ['repository', 'headSha', 'baseSha'], 'STORE_SCOPE_INVALID');
  must(typeof v.repository === 'string' && v.repository.length <= 120 && REPO_RE.test(v.repository), 'STORE_SCOPE_INVALID');
  must(typeof v.headSha === 'string' && /^[a-f0-9]{40}$/.test(v.headSha), 'STORE_SCOPE_INVALID');
  must(typeof v.baseSha === 'string' && /^[a-f0-9]{40}$/.test(v.baseSha), 'STORE_SCOPE_INVALID');
  must(v.headSha !== v.baseSha, 'STORE_SCOPE_INVALID');
  return v;
}

function validateIdentity(identity) {
  const v = strictRecord(identity, ['repository', 'requestId', 'opId', 'headSha', 'baseSha'], 'IDENTITY_INVALID');
  must(typeof v.repository === 'string' && v.repository.length <= 120 && REPO_RE.test(v.repository), 'IDENTITY_INVALID');
  must(typeof v.requestId === 'string' && ID_RE.test(v.requestId), 'IDENTITY_INVALID');
  must(typeof v.opId === 'string' && ID_RE.test(v.opId), 'IDENTITY_INVALID');
  must(typeof v.headSha === 'string' && /^[a-f0-9]{40}$/.test(v.headSha), 'IDENTITY_INVALID');
  must(typeof v.baseSha === 'string' && /^[a-f0-9]{40}$/.test(v.baseSha), 'IDENTITY_INVALID');
  must(v.headSha !== v.baseSha, 'IDENTITY_INVALID');
  const fingerprint = digest(v);
  return Object.freeze({ identity: v, fingerprint });
}

function validateCas(expected) {
  const v = strictRecord(expected, ['revision', 'head'], 'CAS_TOKEN_INVALID');
  must(Number.isSafeInteger(v.revision) && v.revision >= 0 && isHash(v.head), 'CAS_TOKEN_INVALID');
  return v;
}

function validateOptions(options) {
  if (options === undefined) return Object.freeze({ failpoint: null });
  const v = strictRecord(options, ['failpoint'], 'OPTIONS_INVALID');
  must(v.failpoint === null || FAILPOINTS.includes(v.failpoint), 'OPTIONS_INVALID');
  return v;
}

function privateRoot(root) {
  must(typeof root === 'string' && isAbsolute(root) && resolve(root) === root, 'STORE_PATH_INVALID');
  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') fail('STORE_MISSING');
    throw error;
  }
  must(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(root) === root, 'STORE_ROOT_UNSAFE');
  must((stat.mode & 0o077) === 0, 'STORE_ROOT_UNSAFE');
  if (typeof process.getuid === 'function') must(stat.uid === process.getuid(), 'STORE_ROOT_UNSAFE');
  must(Number.isSafeInteger(stat.dev) && Number.isSafeInteger(stat.ino), 'STORE_ROOT_UNSAFE');
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function pinnedRoot(root, expectedIdentity) {
  const current = privateRoot(root);
  must(current.dev === expectedIdentity.dev && current.ino === expectedIdentity.ino, 'STORE_ROOT_UNSAFE');
}

function syncDir(root) {
  const fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeExclusive(path, body) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, body, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readState(root, expectedScope) {
  const fd = openSync(join(root, STORE_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
  let body;
  try {
    const stat = fstatSync(fd);
    must(stat.isFile() && stat.size <= LIMIT_BYTES, 'STORE_FILE_UNSAFE');
    must((stat.mode & 0o077) === 0, 'STORE_FILE_UNSAFE');
    if (typeof process.getuid === 'function') must(stat.uid === process.getuid(), 'STORE_FILE_UNSAFE');
    body = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }

  let state;
  try {
    state = JSON.parse(body);
  } catch {
    fail('STORE_CORRUPT');
  }

  exactKeys(state, ['schema', 'storeScope', 'revision', 'head', 'entries'], 'STORE_CORRUPT');
  must(state.schema === 1, 'STORE_CORRUPT');
  const scope = validateStoreScope(state.storeScope);
  must(scope.repository === expectedScope.repository
    && scope.headSha === expectedScope.headSha
    && scope.baseSha === expectedScope.baseSha, 'STORE_SCOPE_MISMATCH');
  must(Number.isSafeInteger(state.revision) && state.revision >= 0, 'STORE_CORRUPT');
  must(isHash(state.head), 'STORE_CORRUPT');
  must(Array.isArray(state.entries) && state.entries.length === state.revision && state.entries.length <= MAX_ENTRIES, 'STORE_CORRUPT');

  const requests = new Map();
  const operations = new Map();
  let previous = GENESIS;

  for (let i = 0; i < state.entries.length; i++) {
    const entry = state.entries[i];
    exactKeys(entry, ['revision', 'previous', 'type', 'payload', 'hash'], 'STORE_CHAIN_INVALID');
    must(entry.revision === i + 1 && entry.previous === previous, 'STORE_CHAIN_INVALID');
    must(entry.type === 'RESERVE' || entry.type === 'UNKNOWN', 'STORE_CHAIN_INVALID');
    must(entry.hash === digest({ revision: entry.revision, previous: entry.previous, type: entry.type, payload: entry.payload }), 'STORE_CHAIN_INVALID');

    const payload = strictRecord(entry.payload, ['identity', 'fingerprint'], 'STORE_HISTORY_INVALID');
    const parsed = validateIdentity(payload.identity);
    must(payload.fingerprint === parsed.fingerprint, 'STORE_HISTORY_INVALID');
    must(parsed.identity.repository === scope.repository
      && parsed.identity.headSha === scope.headSha
      && parsed.identity.baseSha === scope.baseSha, 'STORE_HISTORY_INVALID');

    const prior = requests.get(parsed.identity.requestId);
    if (!prior) {
      must(!operations.has(parsed.identity.opId), 'STORE_HISTORY_INVALID');
      operations.set(parsed.identity.opId, parsed.identity.requestId);
      requests.set(parsed.identity.requestId, {
        identity: parsed.identity,
        fingerprint: parsed.fingerprint,
        status: 'NONE',
      });
    } else {
      must(prior.fingerprint === parsed.fingerprint, 'STORE_HISTORY_INVALID');
      must(prior.identity.opId === parsed.identity.opId, 'STORE_HISTORY_INVALID');
      must(operations.get(parsed.identity.opId) === parsed.identity.requestId, 'STORE_HISTORY_INVALID');
    }

    const record = requests.get(parsed.identity.requestId);
    if (entry.type === 'RESERVE') {
      must(record.status === 'NONE', 'STORE_HISTORY_INVALID');
      record.status = 'RESERVED_OFFLINE';
    } else {
      must(record.status === 'RESERVED_OFFLINE', 'STORE_HISTORY_INVALID');
      record.status = 'UNKNOWN_OUTCOME';
    }

    previous = entry.hash;
  }

  must(previous === state.head, 'STORE_CHAIN_INVALID');
  return { state, requests, operations, scope };
}

function summarize(current) {
  const records = [...current.requests.values()].map(row => freeze({
    identity: row.identity,
    fingerprint: row.fingerprint,
    status: row.status,
  }));
  return freeze({
    revision: current.state.revision,
    head: current.state.head,
    storeScope: current.scope,
    records,
    offlineOnly: true,
    authenticated: false,
    authorized: false,
    mayMerge: false,
    mayDispatch: false,
    mayActivate: false,
  });
}

function emptyState(scope) {
  return {
    schema: 1,
    storeScope: scope,
    revision: 0,
    head: GENESIS,
    entries: [],
  };
}

export function createReplayStore(root, storeScope) {
  const scope = validateStoreScope(storeScope);
  must(typeof root === 'string' && isAbsolute(root) && resolve(root) === root, 'STORE_PATH_INVALID');
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') fail('STORE_ALREADY_EXISTS');
    throw error;
  }
  privateRoot(root);
  writeExclusive(join(root, LOCK_FILE), 'INITIALIZING_OFFLINE_ONLY\n');
  syncDir(root);
  writeExclusive(join(root, STORE_FILE), JSON.stringify(emptyState(scope)) + '\n');
  syncDir(root);
  unlinkSync(join(root, LOCK_FILE));
  syncDir(root);
  return openReplayStore(root, scope);
}

export function openReplayStore(root, storeScope) {
  const scope = validateStoreScope(storeScope);
  const rootIdentity = privateRoot(root);
  must(existsSync(join(root, STORE_FILE)), 'STORE_MISSING');
  must(!existsSync(join(root, LOCK_FILE)), 'STORE_LOCKED_RECONCILE_REQUIRED');
  must(!existsSync(join(root, PENDING_FILE)), 'STORE_UNCERTAIN_RECONCILE_REQUIRED');
  readState(root, scope);

  const snapshot = () => {
    pinnedRoot(root, rootIdentity);
    must(!existsSync(join(root, LOCK_FILE)), 'STORE_LOCKED_RECONCILE_REQUIRED');
    must(!existsSync(join(root, PENDING_FILE)), 'STORE_UNCERTAIN_RECONCILE_REQUIRED');
    return summarize(readState(root, scope));
  };

  const mutate = (expected, makeEntry, options) => {
    const cas = validateCas(expected);
    const config = validateOptions(options);
    pinnedRoot(root, rootIdentity);
    let lockHeld = false;
    let uncertain = false;
    let phase = 'START';

    try {
      try {
        writeExclusive(join(root, LOCK_FILE), 'OFFLINE_WRITER_NO_AUTOMATIC_RECOVERY\n');
      } catch (error) {
        if (error && error.code === 'EEXIST') fail('STORE_LOCKED_RECONCILE_REQUIRED');
        throw error;
      }
      lockHeld = true;
      syncDir(root);
      phase = 'LOCKED';

      if (existsSync(join(root, PENDING_FILE))) {
        uncertain = true;
        fail('STORE_UNCERTAIN_RECONCILE_REQUIRED');
      }

      let current = readState(root, scope);
      must(current.state.revision === cas.revision && current.state.head === cas.head, 'CAS_CONFLICT_RECONCILE_REQUIRED');
      const spec = makeEntry(current);
      if (!spec) {
        const result = summarize(current);
        unlinkSync(join(root, LOCK_FILE));
        syncDir(root);
        lockHeld = false;
        return result;
      }

      must(current.state.entries.length < MAX_ENTRIES, 'STORE_CAPACITY_REACHED');
      const entry = {
        revision: current.state.revision + 1,
        previous: current.state.head,
        type: spec.type,
        payload: spec.payload,
      };
      entry.hash = digest(entry);

      const next = {
        schema: 1,
        storeScope: current.scope,
        revision: entry.revision,
        head: entry.hash,
        entries: [...current.state.entries, entry],
      };
      const body = JSON.stringify(next) + '\n';
      must(Buffer.byteLength(body) <= LIMIT_BYTES, 'STORE_CAPACITY_REACHED');

      writeExclusive(join(root, PENDING_FILE), body);
      phase = 'PENDING_WRITTEN';
      if (config.failpoint === 'AFTER_PENDING_WRITE') {
        uncertain = true;
        fail('FAILPOINT_TRIGGERED');
      }

      renameSync(join(root, PENDING_FILE), join(root, STORE_FILE));
      syncDir(root);
      phase = 'RENAMED';
      if (config.failpoint === 'AFTER_RENAME') {
        uncertain = true;
        fail('FAILPOINT_TRIGGERED');
      }

      current = readState(root, scope);
      must(current.state.revision === next.revision && current.state.head === next.head, 'STORE_WRITE_UNCERTAIN');
      const result = summarize(current);
      unlinkSync(join(root, LOCK_FILE));
      syncDir(root);
      lockHeld = false;
      return result;
    } catch (error) {
      if (lockHeld && !uncertain && phase !== 'PENDING_WRITTEN' && phase !== 'RENAMED') {
        try {
          unlinkSync(join(root, LOCK_FILE));
          syncDir(root);
          lockHeld = false;
        } catch {
          // Preserve fail-closed behavior if lock cleanup itself is uncertain.
        }
      }
      throw error;
    }
  };

  return Object.freeze({
    snapshot,
    reserve(identity, expected, options) {
      const parsed = validateIdentity(identity);
      must(parsed.identity.repository === scope.repository
        && parsed.identity.headSha === scope.headSha
        && parsed.identity.baseSha === scope.baseSha, 'STORE_SCOPE_MISMATCH');
      return mutate(expected, ({ requests, operations }) => {
        const prior = requests.get(parsed.identity.requestId);
        if (prior) {
          must(prior.fingerprint === parsed.fingerprint, 'DUPLICATE_SCOPE_CONFLICT');
          if (prior.status === 'UNKNOWN_OUTCOME') fail('UNKNOWN_OUTCOME_BLOCKED');
          return null;
        }
        must(!operations.has(parsed.identity.opId), 'OP_ID_REUSED');
        return {
          type: 'RESERVE',
          payload: { identity: parsed.identity, fingerprint: parsed.fingerprint },
        };
      }, options);
    },
    markUnknown(identity, expected, options) {
      const parsed = validateIdentity(identity);
      must(parsed.identity.repository === scope.repository
        && parsed.identity.headSha === scope.headSha
        && parsed.identity.baseSha === scope.baseSha, 'STORE_SCOPE_MISMATCH');
      return mutate(expected, ({ requests }) => {
        const prior = requests.get(parsed.identity.requestId);
        must(prior && prior.fingerprint === parsed.fingerprint, 'REQUEST_NOT_RESERVED');
        if (prior.status === 'UNKNOWN_OUTCOME') return null;
        must(prior.status === 'RESERVED_OFFLINE', 'REQUEST_NOT_RESERVED');
        return {
          type: 'UNKNOWN',
          payload: { identity: parsed.identity, fingerprint: parsed.fingerprint },
        };
      }, options);
    },
  });
}
