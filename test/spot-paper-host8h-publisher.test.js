import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {publishHost8hSummary, readSummaryFile, main, UPLOAD_PATH} from '../scripts/spot-paper-report-bridge/host8h-publisher.mjs';
import {getSpotPaperHost8hIdentity, SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA} from '../scripts/spot-paper-report-bridge/host8h-contract.mjs';
import {handleSpotPaperHost8hReportGatewayRequest, spotPaperHost8hReportGatewayConfig} from '../spot-paper-host8h-report-gateway.mjs';

const observedAt = '2026-11-08T14:00:00.000Z';
const now = () => Date.parse(observedAt) + 60_000;
const endpoint = `https://private.invalid${UPLOAD_PATH}`;
const token = 'offline-fixture-secret';
const env = {MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN: token};
const summary = () => ({schemaVersion: SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA,
  source: 'Read-only host summary exporter; transport authentication is separate', observedAt,
  identity: getSpotPaperHost8hIdentity(), snapshot: {status: 'INCOMPLETE_UNKNOWN',
    runId: getSpotPaperHost8hIdentity().runId, verifiedTerminal: false, report: null},
  sourceEvidence: {journalStatus: 'UNKNOWN_WRITER_OR_INTERRUPTED', journalSequence: 1,
    cycleCount: 0, observationCount: 0, dataGapCount: 0, assessmentOutcome: 'UNKNOWN'},
  metrics: null, assessment: null});
const options = () => ({bytes: Buffer.from(JSON.stringify(summary())), endpoint, publish: true});
const receipt = status => new Response(JSON.stringify({ok: true,
  runId: getSpotPaperHost8hIdentity().runId, observedAt, idempotent: status === 200}), {status});

test('default dry run does not read token or call transport; arguments inert', async () => {
  const deps = {now, env: new Proxy({}, {get() {throw Error('secret read');}}),
    transport() {throw Error('network');}};
  assert.equal((await publishHost8hSummary({...options(), publish: false}, deps)).outcome, 'DRY_RUN');
  assert.equal((await main([], deps)).outcome, 'REJECTED');
});

test('invalid contract, oversized bytes and unsafe endpoint never send', async () => {
  let calls = 0;
  const deps = {now, env, transport() {calls++;}};
  for (const url of ['http://private.invalid'+UPLOAD_PATH, endpoint+'?token=x',
    endpoint+'#x', 'https://user:pass@private.invalid'+UPLOAD_PATH, 'https://private.invalid/wrong']) {
    assert.equal((await publishHost8hSummary({...options(), endpoint: url}, deps)).outcome, 'REJECTED');
  }
  for (const bytes of [Buffer.alloc(262145), Buffer.from('{}'),
    Buffer.from(JSON.stringify({...summary(), identity: {...summary().identity, runId: 'other'}}))]) {
    assert.equal((await publishHost8hSummary({...options(), bytes}, deps)).outcome, 'REJECTED');
  }
  assert.equal(calls, 0);
});

test('200/201 receipts validated, original observation time unchanged, one request', async () => {
  for (const status of [200, 201]) {
    let calls = 0;
    const output = await publishHost8hSummary(options(), {env, now, transport: async (url, init) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      assert.equal(JSON.parse(init.body).report.observedAt, observedAt);
      return receipt(status);
    }});
    assert.equal(output.outcome, status === 200 ? 'IDEMPOTENT' : 'ACCEPTED');
    assert.equal(calls, 1);
  }
});

test('canonical upload accepted by actual gateway offline', async () => {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const config = spotPaperHost8hReportGatewayConfig({
    MERIDIAN_READ_TOKEN_SHA256: hash('different-read-token'),
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN_SHA256: hash(token),
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_APPROVED: 'true'});
  const output = await publishHost8hSummary(options(), {env, now, transport: async (url, init) => {
    const response = await handleSpotPaperHost8hReportGatewayRequest({url, method: init.method,
      headers: init.headers}, {config, now, getStore: () => ({putLatest: async () => 'INSERTED'}),
      readBody: async () => Buffer.from(init.body)});
    return new Response(JSON.stringify(response.body), {status: response.status});
  }});
  assert.equal(output.outcome, 'ACCEPTED');
});

test('bounded receipts distinguish stale, conflict and terminal regression', async () => {
  for (const [error, reason] of [['host8h_snapshot_out_of_order', 'STALE'],
    ['host8h_snapshot_conflict', 'CONFLICT'], ['host8h_terminal_regression_rejected', 'TERMINAL_REGRESSION']]) {
    const output = await publishHost8hSummary(options(), {env, now,
      transport: async () => new Response(JSON.stringify({error}), {status: 409})});
    assert.deepEqual(output, {outcome: 'REJECTED', reason});
  }
});

test('redirect, forged/malformed/oversized receipt cannot report accepted or leak secrets', async () => {
  for (const response of [new Response('', {status: 302, headers: {location: 'https://other.invalid'}}),
    new Response(token, {status: 201}), new Response('x'.repeat(4097), {status: 201}),
    new Response(JSON.stringify({ok: true, runId: 'wrong', observedAt, idempotent: false}), {status: 201}),
    new Response('{}', {status: 201, headers: {'content-length': '5000'}})]) {
    const output = await publishHost8hSummary(options(), {env, now, transport: async () => response});
    assert.ok(!['ACCEPTED', 'IDEMPOTENT'].includes(output.outcome));
    assert.ok(!JSON.stringify(output).includes(token));
  }
});

test('stalled request and body time out UNKNOWN with abort and no retries', async () => {
  for (const bodyStall of [false, true]) {
    let calls = 0;
    let signal;
    const output = await publishHost8hSummary(options(), {env, now, timeoutMs: 10,
      transport: async (_url, init) => {
        calls++; signal = init.signal;
        return bodyStall ? new Response(new ReadableStream({start() {}}), {status: 201}) :
          new Promise(() => {});
      }});
    assert.deepEqual(output, {outcome: 'UNKNOWN', reason: 'DEADLINE_EXCEEDED'});
    assert.equal(calls, 1); assert.equal(signal.aborted, true);
  }
});

test('bounded regular-file reader rejects symlinks and oversized files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'host8h-publisher-'));
  try {
    const file = join(dir, 'summary.json');
    writeFileSync(file, options().bytes);
    assert.deepEqual(readSummaryFile(file), options().bytes);
    symlinkSync(file, join(dir, 'link'));
    assert.throws(() => readSummaryFile(join(dir, 'link')));
    assert.throws(() => readSummaryFile(dir));
    writeFileSync(file, Buffer.alloc(262145));
    assert.throws(() => readSummaryFile(file));
  } finally {rmSync(dir, {recursive: true, force: true});}
});
