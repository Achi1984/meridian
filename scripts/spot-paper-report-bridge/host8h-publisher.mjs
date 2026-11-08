import {openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {
  normalizeSpotPaperHost8hReport, SPOT_PAPER_HOST8H_MAX_BYTES,
  SPOT_PAPER_HOST8H_RUN_ID, SPOT_PAPER_HOST8H_TRANSFER_SCHEMA
} from './host8h-contract.mjs';

export const UPLOAD_PATH = '/api/private/spot-paper-host8h-report/upload';
export const MAX_RECEIPT_BYTES = 4096;
const TOKEN_ENV = 'MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN';
const result = (outcome, reason) => ({outcome, reason});

// The gateway requires recursively sorted, whitespace-free canonical JSON.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function readSummaryFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > SPOT_PAPER_HOST8H_MAX_BYTES) throw Error('INVALID_INPUT');
    const bytes = Buffer.alloc(SPOT_PAPER_HOST8H_MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > SPOT_PAPER_HOST8H_MAX_BYTES) throw Error('INVALID_INPUT');
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

async function receiptBytes(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RECEIPT_BYTES)) {
    throw Error('INVALID_RECEIPT');
  }
  if (!response.body) throw Error('INVALID_RECEIPT');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, {once: true});
  if (signal.aborted) cancel();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RECEIPT_BYTES) throw Error('INVALID_RECEIPT');
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } finally { signal.removeEventListener("abort", cancel); cancel(); }
}

export async function publishHost8hSummary({bytes, endpoint, publish = false}, {
  env = process.env, transport = globalThis.fetch, now = Date.now, timeoutMs = 5000
} = {}) {
  let report;
  let url;
  let body;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > SPOT_PAPER_HOST8H_MAX_BYTES) {
      throw Error();
    }
    report = normalizeSpotPaperHost8hReport(
      JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), {now: now()});
    if (!report) throw Error();
    url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== UPLOAD_PATH) throw Error();
    body = canonical({schema: SPOT_PAPER_HOST8H_TRANSFER_SCHEMA,
      runId: SPOT_PAPER_HOST8H_RUN_ID, report});
    if (Buffer.byteLength(body) > SPOT_PAPER_HOST8H_MAX_BYTES) throw Error();
  } catch { return result('REJECTED', 'INVALID_INPUT_OR_ENDPOINT'); }
  if (!publish) return result('DRY_RUN', 'VALIDATED_NO_UPLOAD');
  const token = env[TOKEN_ENV];
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
    return result('REJECTED', 'UPLOAD_TOKEN_REQUIRED');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
    return result('REJECTED', 'INVALID_DEADLINE');
  }
  const controller = new AbortController();
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(result('UNKNOWN', 'DEADLINE_EXCEEDED'));
    }, timeoutMs);
  });
  const attempt = (async () => {
    try {
      const response = await transport(url.href, {method: 'POST', redirect: 'manual',
        signal: controller.signal, headers: {'content-type': 'application/json',
          authorization: `Bearer ${token}`}, body});
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => {});
        return result('REJECTED', 'REDIRECT_REJECTED');
      }
      const receipt = await receiptBytes(response, controller.signal);
      if ((response.status === 200 || response.status === 201) &&
          Object.keys(receipt).sort().join(',') === 'idempotent,observedAt,ok,runId' &&
          receipt.ok === true && receipt.runId === report.identity.runId &&
          receipt.observedAt === report.observedAt &&
          receipt.idempotent === (response.status === 200)) {
        return result(response.status === 200 ? 'IDEMPOTENT' : 'ACCEPTED', 'RECEIPT_VALIDATED');
      }
      const conflicts = {host8h_snapshot_out_of_order: 'STALE',
        host8h_snapshot_conflict: 'CONFLICT',
        host8h_terminal_regression_rejected: 'TERMINAL_REGRESSION'};
      if (response.status === 409 && receipt && Object.keys(receipt).join(',') === 'error' &&
          Object.hasOwn(conflicts, receipt.error)) return result('REJECTED', conflicts[receipt.error]);
      return result('UNKNOWN', 'UNCONFIRMED_RECEIPT');
    } catch { return result('UNKNOWN', 'TRANSPORT_OR_RECEIPT_FAILURE'); }
  })();
  try { return await Promise.race([attempt, deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  let output;
  try {
    if (argv.length !== 4 && argv.length !== 5 || argv[0] !== '--summary' ||
        argv[2] !== '--endpoint' || argv.length === 5 && argv[4] !== '--publish') throw Error();
    output = await publishHost8hSummary({bytes: readSummaryFile(argv[1]), endpoint: argv[3],
      publish: argv[4] === '--publish'}, dependencies);
  } catch { output = result('REJECTED', 'INVALID_ARGUMENTS_OR_FILE'); }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = await main();
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = ['DRY_RUN', 'ACCEPTED', 'IDEMPOTENT'].includes(output.outcome) ? 0 : 1;
}
