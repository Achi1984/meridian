#!/usr/bin/env node
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {
  MAX_PROGRESS_BYTES, PROGRESS_ENDPOINT, canonicalJson, exactKeys,
  validateProgress
} from './contract.mjs';

export const PROGRESS_RECEIPT_SCHEMA = 'SPOT_PAPER_PAIRED_PROGRESS_RECEIPT_V1';
export const MAX_RECEIPT_BYTES = 4096;
export const PUBLISH_TOKEN_ENV = 'MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_PUBLISH_TOKEN';
const result = status => ({status});
const validTimeout = value => Number.isSafeInteger(value) && value >= 1 && value <= 10_000;

async function cancelResponse(response) {
  try { await response?.body?.cancel(); } catch {}
}

async function readReceipt(response, signal) {
  let reader;
  let cancellation;
  const cancel = () => {
    if (!cancellation) cancellation = Promise.resolve().then(() => reader.cancel()).catch(() => {});
    return cancellation;
  };
  const abort = () => { void cancel(); };
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(
      response.headers?.get?.('content-type') ?? '')) throw new Error();
    const length = response.headers?.get?.('content-length');
    if (length != null && (!/^\d+$/.test(length) ||
        Number(length) > MAX_RECEIPT_BYTES)) throw new Error();
    reader = response.body?.getReader?.();
    if (!reader) throw new Error();
    signal.addEventListener('abort', abort, {once: true});
    let size = 0;
    const chunks = [];
    while (true) {
      if (signal.aborted) throw new Error();
      const {done, value} = await reader.read();
      if (signal.aborted) throw new Error();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error();
      size += value.byteLength;
      if (size > MAX_RECEIPT_BYTES) throw new Error();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally {
    signal.removeEventListener('abort', abort);
    if (reader) {
      await cancel();
      try { reader.releaseLock(); } catch {}
    } else await cancelResponse(response);
  }
}

export async function publishProgress(payload, {
  expectedIdentity, enabled = false, token, fetchImpl = globalThis.fetch,
  timeoutMs = 8_000
} = {}) {
  const progress = validateProgress(payload, expectedIdentity);
  if (!progress || typeof enabled !== 'boolean' || !validTimeout(timeoutMs)) {
    return result('REJECTED');
  }
  if (!enabled) return result('DRY_RUN');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    return result('AUTH_REQUIRED');
  }
  if (typeof fetchImpl !== 'function') return result('UNKNOWN');
  const controller = new AbortController();
  const deadlineAt = performance.now() + timeoutMs;
  const expired = () => controller.signal.aborted || performance.now() >= deadlineAt;
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(result('UNKNOWN'));
    }, timeoutMs);
  });
  const operation = Promise.resolve().then(() => {
    if (expired()) {
      controller.abort();
      return null;
    }
    return fetchImpl(PROGRESS_ENDPOINT, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json',
        authorization: 'Bearer ' + token},
      body: canonicalJson(progress),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
  }).then(async response => {
    if (expired() || response?.redirected ||
        response?.type === 'opaqueredirect' ||
        response?.url && response.url !== PROGRESS_ENDPOINT) {
      await cancelResponse(response);
      return result('UNKNOWN');
    }
    if (response?.status === 401 || response?.status === 403) {
      await cancelResponse(response);
      return result('AUTH_REQUIRED');
    }
    if (response?.ok !== true || response?.status !== 200) {
      await cancelResponse(response);
      return result('UNKNOWN');
    }
    const receipt = await readReceipt(response, controller.signal);
    if (expired() || !exactKeys(receipt,
      ['schemaVersion', 'status', 'journalSequence', 'journalSha256']) ||
        receipt.schemaVersion !== PROGRESS_RECEIPT_SCHEMA || receipt.status !== 'ACCEPTED' ||
        receipt.journalSequence !== progress.journalSequence ||
        receipt.journalSha256 !== progress.journalSha256) return result('UNKNOWN');
    return result('PUBLISHED');
  }).catch(() => result('UNKNOWN'));
  try { return await Promise.race([operation, deadline]); }
  finally { clearTimeout(timer); }
}

export async function readProgressJsonFile(path, {timeoutMs = 2_000, openImpl = open} = {}) {
  if (typeof path !== 'string' || !path || !validTimeout(timeoutMs) ||
      typeof openImpl !== 'function') throw new Error('INVALID_INPUT');
  const deadlineAt = performance.now() + timeoutMs;
  let timedOut = false;
  const expired = () => timedOut || performance.now() >= deadlineAt;
  let timer;
  const operation = (async () => {
    const handle = await openImpl(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (expired()) throw new Error();
      const stat = await handle.stat();
      if (expired() || !stat.isFile() || stat.size > MAX_PROGRESS_BYTES) throw new Error();
      const bytes = Buffer.alloc(MAX_PROGRESS_BYTES + 1);
      let size = 0;
      while (true) {
        if (expired()) throw new Error();
        const {bytesRead} = await handle.read(bytes, size, bytes.length - size, null);
        if (expired()) throw new Error();
        size += bytesRead;
        if (size > MAX_PROGRESS_BYTES) throw new Error();
        if (!bytesRead) break;
      }
      if (expired()) throw new Error();
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, size)));
    } finally { await handle.close(); }
  })();
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('INVALID_INPUT')); }, timeoutMs);
  });
  try { return await Promise.race([operation, deadline]); }
  catch { throw new Error('INVALID_INPUT'); }
  finally { clearTimeout(timer); }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  try {
    let snapshot;
    let expected;
    let enabled = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '--publish' && !enabled) enabled = true;
      else if (arg === '--snapshot' && !snapshot && args[index + 1] &&
          !args[index + 1].startsWith('--')) snapshot = args[++index];
      else if (arg === '--expected-identity' && !expected && args[index + 1] &&
          !args[index + 1].startsWith('--')) expected = args[++index];
      else throw new Error();
    }
    if (!snapshot || !expected) throw new Error();
    const [payload, expectedIdentity] = await Promise.all([
      readProgressJsonFile(snapshot), readProgressJsonFile(expected)
    ]);
    return await publishProgress(payload, {
      expectedIdentity, enabled, token: env[PUBLISH_TOKEN_ENV]
    });
  } catch { return result('REJECTED'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await main();
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exitCode = ['DRY_RUN', 'PUBLISHED'].includes(outcome.status) ? 0 : 1;
}
