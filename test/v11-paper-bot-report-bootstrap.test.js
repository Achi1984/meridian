import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {mountPaperBotReportWorkspace} from '../v11/paper-bot-report-bootstrap.js';
import {presentSpotPaperPairedReport} from '../v11/spot-paper-paired-model.js';
import {presentSpotPaperBotOverview} from '../v11/spot-paper-bot-overview-model.js';
import {
  getAcceptedSpotPaperIdentity,
  SPOT_PAPER_DASHBOARD_SCHEMA,
  SPOT_PAPER_REPORT_ENVELOPE_SCHEMA
} from '../scripts/spot-paper-report-bridge/contract.mjs';
import {SPOT_PAPER_REPORT_ENDPOINT} from '../v11/spot-paper-cockpit-controller.js';
import {
  SPOT_PAPER_PAIRED_REPORT_ENDPOINT,
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA
} from '../v11/spot-paper-paired-report-connector.js';
import {
  SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT
} from '../v11/spot-paper-paired-progress-connector.js';
import {
  SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY,
  SPOT_PAPER_PAIRED_PROGRESS_STALE_AFTER_MS
} from '../v11/spot-paper-paired-progress-config.js';
import {validIdentity} from '../scripts/spot-paper-paired-progress/contract.mjs';
import {
  exportProgress
} from '../scripts/spot-paper-paired-progress/export.mjs';
import {
  handleSpotPaperPairedProgressGatewayRequest,
  spotPaperPairedProgressGatewayConfig
} from '../spot-paper-paired-progress-gateway.mjs';
import {progressJournalFixture, journalEnvelope} from './helpers/spot-paper-paired-progress-fixture.mjs';
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';
import {syntheticPairedEvaluatorFixture} from
  './helpers/spot-paper-paired-evaluator-fixture.mjs';
import {evaluatePairedPaperEvidence} from
  '../scripts/spot-paper-paired-report/evaluate.mjs';

const TOKEN = 'synthetic-paper-workspace-token';
const TARGET_MODEL = 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1';

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = new Map();
    this.text = '';
    this.parentNode = null;
    this.disabled = false;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Paper report workspace must render text nodes'); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.text = '';
    this.children = [];
    this.append(...nodes);
  }
  insertBefore(node, before) {
    const index = this.children.indexOf(before);
    if (index < 0) return this.append(node);
    node.parentNode = this;
    this.children.splice(index, 0, node);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  click() { for (const listener of this.listeners.get('click') || []) listener({target: this}); }
}

function syntheticDto() {
  const identity = getAcceptedSpotPaperIdentity();
  return {
    schemaVersion: SPOT_PAPER_DASHBOARD_SCHEMA,
    identity: {
      runId: identity.runId,
      sourceSha: identity.sourceSha,
      workflowSha: identity.workflowSha,
      workflowRunId: identity.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1,
      profileId: identity.profileId,
      model: identity.model,
      pair: identity.pair
    },
    acceptedDispatchContext: {
      status: 'PASS',
      workflowRunId: identity.workflowRunId,
      workflowRunNumber: 1,
      workflowRunAttempt: 1
    },
    snapshot: {
      status: 'COMPLETED_BOUNDED',
      completedAt: '2026-11-07T18:16:08.581Z',
      stopReason: 'CYCLE_LIMIT'
    },
    startingBalanceCents: '100000',
    cashCents: '89643',
    equityCents: '99525',
    realizedPnlCents: '-357',
    unrealizedPnlCents: '-118',
    feesCents: '350',
    buyCount: 4,
    sellCount: 3,
    fillCount: 7,
    openInventory: {status: 'OPEN_UNRESOLVED_AT_TERMINAL', quantitySat: '146122'},
    duration: {
      elapsedMs: identity.maxDurationMs - 57_098,
      requestedMs: identity.maxDurationMs,
      coverage: (identity.maxDurationMs - 57_098) / identity.maxDurationMs,
      status: 'PARTIAL_BOUNDED_DURATION'
    },
    coverage: {
      observations: identity.maxCycles,
      acceptedObservations: identity.maxCycles,
      dataGaps: 0,
      requests: identity.maxRequests
    },
    verification: {
      terminalReadback: 'PASS',
      assessment: 'COMPLETED',
      assessmentSignalReplay: 'NOT_PERFORMED',
      signalReplay: 'PASS',
      profitability: 'NOT_ASSESSED'
    }
  };
}

function syntheticPairedReport() {
  const expected = syntheticExpectedPairedIdentity({modelPair: true});
  const report = syntheticPairedDashboard(expected);
  report.timing.valuationAt = Date.parse('2026-11-09T12:00:00.000Z');
  const challenger = report.arms.challenger;
  challenger.netPnlCents = 125;
  challenger.netEquityCents = 100_125;
  challenger.bookedFeesCents = 25;
  challenger.modeledSlippageCents = 10;
  challenger.fillCount = 7;
  return {expected, report};
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({
  fetchImpl = async () => new Response(null, {status: 404}),
  progressEnabled = false,
  progressExpectedIdentity,
  progressStaleAfterMs,
  now
} = {}) {
  const document = {createElement: tag => new Element(document, tag)};
  const parent = new Element(document, 'section');
  const overviewRoot = new Element(document, 'section');
  const pairedRoot = new Element(document, 'section');
  parent.append(overviewRoot, pairedRoot);
  const subscribers = new Set();
  const readers = new Set();
  let token = null;
  const access = {
    getToken: () => token,
    isUnlocked: () => token !== null,
    lock() {
      token = null;
      for (const clear of readers) clear();
      for (const listener of subscribers) listener({status: 'locked'});
    },
    registerReader(clear) {
      readers.add(clear);
      return () => readers.delete(clear);
    },
    subscribe(listener) {
      subscribers.add(listener);
      listener({status: token ? 'unlocked' : 'locked'});
      return () => subscribers.delete(listener);
    },
    unlock() {
      token = TOKEN;
      for (const listener of subscribers) listener({status: 'unlocked'});
    }
  };
  const workspace = mountPaperBotReportWorkspace(overviewRoot, pairedRoot, document, {
    access,
    fetchImpl,
    progressEnabled,
    ...(progressExpectedIdentity ? {progressExpectedIdentity} : {}),
    ...(progressStaleAfterMs === undefined ? {} : {progressStaleAfterMs}),
    ...(now ? {now} : {})
  });
  return {access, document, overviewRoot, pairedRoot, workspace};
}

function memoryFile(bytes, regular = true) {
  let cursor = 0;
  return {
    fd: 99,
    stat: async ({bigint = false} = {}) => ({
      isFile: () => regular,
      size: bigint ? BigInt(bytes.length) : bytes.length,
      dev: 1n, ino: regular ? 2n : 3n, mtimeNs: 1n, ctimeNs: 1n, nlink: 1n
    }),
    read: async (target, offset, length) => {
      const bytesRead = bytes.copy(target, offset, cursor, cursor + length);
      cursor += bytesRead;
      return {bytesRead};
    },
    close: async () => {}
  };
}

async function exportedProgress() {
  const source = progressJournalFixture();
  const bytes = Buffer.from(journalEnvelope(source.journal));
  const result = await exportProgress({
    runDirectory: '/offline-progress-fixture',
    expectedIdentity: source.expectedIdentity,
    now: () => source.now,
    io: {
      open: async (_path, flags) => memoryFile(
        flags & constants.O_DIRECTORY ? Buffer.alloc(0) : bytes,
        !(flags & constants.O_DIRECTORY)),
      lstat: async () => { throw Object.assign(new Error('absent'), {code: 'ENOENT'}); }
    }
  });
  assert.equal(result.status, 'EXPORTED');
  return {source, progress: result.progress};
}

test('progress connector configuration pins the reviewed identity and finite valuation age', () => {
  const identity = JSON.parse(readFileSync(new URL(
    '../docs/operations/receipts/btc-eur-paired-diag-20261110-001.expected-identity.json',
    import.meta.url), 'utf8'));
  assert.deepEqual(SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY, identity);
  assert.equal(validIdentity(SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY), true);
  assert.equal(SPOT_PAPER_PAIRED_PROGRESS_STALE_AFTER_MS, 5 * 60 * 1000);
  assert.ok(Number.isSafeInteger(SPOT_PAPER_PAIRED_PROGRESS_STALE_AFTER_MS));
});

test('workspace requires unlock and explicit refresh; lock clears read DTO and unmount cleans controls', async () => {
  const paired = syntheticPairedReport();
  const calls = [];
  let options;
  const report = syntheticDto();
  const h = harness({
    fetchImpl: async (url, init) => {
      calls.push(url);
      options = {url, ...init};
      if (url === SPOT_PAPER_PAIRED_REPORT_ENDPOINT) {
        return new Response(JSON.stringify({
          schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
          runId: paired.expected.runId,
          report: paired.report
        }), {status: 200, headers: {'content-type': 'application/json'}});
      }
      return new Response(JSON.stringify({
        schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
        runId: report.identity.runId,
        report
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }
  });
  h.workspace.setActive(true);
  assert.equal((await h.workspace.refresh()), undefined);
  assert.equal(calls.length, 0, 'locked access does not dispatch a report read');
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.match(h.overviewRoot.textContent, /In Vorbereitung/);
  assert.match(h.pairedRoot.textContent, /Noch kein Bericht geladen/);

  h.access.unlock();
  await tick();
  assert.deepEqual(calls, [SPOT_PAPER_PAIRED_REPORT_ENDPOINT],
    'unlock while active dispatches one authenticated paired read');
  await h.workspace.refresh();
  assert.equal(calls.length, 2);
  assert.equal(options.url, SPOT_PAPER_REPORT_ENDPOINT);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.match(h.overviewRoot.textContent, new RegExp(TARGET_MODEL));
  assert.match(h.overviewRoot.parentNode.textContent,
    /belegt aber nicht die 5-Minuten-Trend-Identität/);
  assert.match(h.overviewRoot.textContent, /\+1,25\s+€/);
  assert.match(h.overviewRoot.textContent, /1\.001,25\s+€/);
  assert.match(h.overviewRoot.textContent, /0,25\s+€/);
  assert.match(h.overviewRoot.textContent, /0,10\s+€/);
  assert.match(h.overviewRoot.textContent, /paired-synthetic-test-only/);
  assert.doesNotMatch(h.overviewRoot.textContent, /Läuft · Aktuell/);
  assert.match(h.overviewRoot.textContent, new RegExp(TARGET_MODEL),
    'the overview retains the intended trend-model identity');
  assert.doesNotMatch(h.overviewRoot.textContent, /BTC_EUR_SMA5_SMA20_V1/,
    'the legacy model is not presented as the paired trend challenger');

  h.access.lock();
  assert.doesNotMatch(h.overviewRoot.textContent, /BTC_EUR_SMA5_SMA20_V1/);
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.equal(calls.length, 2);
  h.workspace.dispose();
  assert.equal(h.overviewRoot.children.length, 0);
  assert.equal(h.pairedRoot.children.length, 0);
});

test('paired DTO is read through the real workspace mount and remains visibly synthetic in tests', async () => {
  const {expected, report} = syntheticPairedReport();
  const calls = [];
  let options;
  const h = harness({
    fetchImpl: async (url, init) => {
      calls.push(url);
      options = {url, ...init};
      assert.equal(url, SPOT_PAPER_PAIRED_REPORT_ENDPOINT);
      return new Response(JSON.stringify({
        schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
        runId: expected.runId,
        report
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }
  });
  h.workspace.setActive(true);
  h.access.unlock();
  await tick();
  assert.equal(calls.length, 1, 'unlock while active reads paired data once');
  assert.equal(calls[0], SPOT_PAPER_PAIRED_REPORT_ENDPOINT);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.match(h.pairedRoot.textContent, /SYNTHETIC FIXTURE/);
  assert.match(h.pairedRoot.textContent,
    /BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1/);
  assert.match(h.pairedRoot.textContent, /RUNNING_SNAPSHOT/);
  assert.match(h.pairedRoot.parentNode.textContent, /Gepaarter Bericht geladen/);
  assert.match(h.pairedRoot.textContent, /Eigenkapital netto1\.001,25\s+€/);
  assert.match(h.pairedRoot.textContent, /Netto-PnL\+1,25\s+€/);
  assert.match(h.overviewRoot.textContent, /\+1,25\s+€/);
  await h.workspace.refreshPaired();
  await tick();
  assert.equal(calls.length, 2, 'explicit refresh remains available');

  h.access.lock();
  assert.doesNotMatch(h.pairedRoot.textContent, /paired-synthetic-test-only/);
  assert.match(h.pairedRoot.parentNode.textContent, /Gesperrt/);
  h.workspace.dispose();
});

test('paired transport, missing publication, identity and schema failures remain distinct', async () => {
  const cases = [
    {status: 503, body: {error: 'spot_paper_paired_transport_not_provisioned'},
      expected: /Transport ist nicht provisioniert/,
      panelExpected: /Transport nicht provisioniert/, panelState: 'unprovisioned'},
    {status: 404, body: {error: 'spot_paper_paired_report_not_found'},
      expected: /Kein gepaarter Bericht veröffentlicht/,
      panelExpected: /Kein gepaarter Bericht veröffentlicht/, panelState: 'empty'},
    {status: 409, body: {error: 'spot_paper_paired_identity_mismatch'},
      expected: /Identität stimmt nicht/, panelState: 'unavailable'},
    {status: 422, body: {error: 'spot_paper_paired_schema_unsupported'},
      expected: /Schema wird nicht unterstützt/, panelState: 'unavailable'},
    {status: 422, body: {error: 'spot_paper_paired_identity_unsupported'},
      expected: /Trend-Identität ist bis zum kanonischen #1319-Vertrag nicht unterstützt/,
      panelState: 'unavailable'},
    {status: 422, body: {error: 'spot_paper_paired_report_invalid'},
      expected: /gepaarte Bericht konnte nicht validiert werden/,
      panelState: 'unavailable'}
  ];
  for (const item of cases) {
    const h = harness({fetchImpl: async url => {
      assert.equal(url, SPOT_PAPER_PAIRED_REPORT_ENDPOINT);
      return new Response(JSON.stringify(item.body), {
        status: item.status,
        headers: {'content-type': 'application/json'}
      });
    }});
    h.workspace.setActive(true);
    h.access.unlock();
    await tick();
    await h.workspace.refreshPaired();
    assert.match(h.pairedRoot.parentNode.textContent, item.expected);
    assert.equal(h.pairedRoot.attrs['data-state'], item.panelState);
    assert.doesNotMatch(h.pairedRoot.textContent,
      /CORRUPT_UNKNOWN|gemeinsamer Bericht konnte nicht geprüft werden/);
    assert.match(h.pairedRoot.textContent, /Kennzahlen und Identität bleiben/);
    if (item.panelExpected) assert.match(h.pairedRoot.textContent, item.panelExpected);
    h.workspace.dispose();
  }

  const unauthorized = harness({fetchImpl: async () => new Response(
    JSON.stringify({error: 'read_token_required'}), {
      status: 401, headers: {'content-type': 'application/json'}
    })});
  unauthorized.workspace.setActive(true);
  unauthorized.access.unlock();
  await tick();
  await unauthorized.workspace.refreshPaired();
  assert.equal(unauthorized.access.isUnlocked(), false);
  assert.match(unauthorized.pairedRoot.parentNode.textContent,
    /Authentifizierung fehlgeschlagen/);
  assert.doesNotMatch(unauthorized.pairedRoot.textContent, /SYNTHETIC FIXTURE/);
  unauthorized.workspace.dispose();
});

test('paired source loads once on active unlock; inactive navigation never fetches', async () => {
  const calls = [];
  const h = harness({fetchImpl: async url => {
    calls.push(url);
    return new Response(null, {status: 404});
  }});
  h.workspace.setActive(true);
  assert.equal(calls.length, 0, 'inactive access does not dispatch');
  h.access.unlock();
  await tick();
  assert.deepEqual(calls, [SPOT_PAPER_PAIRED_REPORT_ENDPOINT]);
  await h.workspace.refresh();
  assert.equal(calls.length, 2);
  assert.match(h.overviewRoot.parentNode.textContent, /Kein authentifizierter Bericht verfügbar/);
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.match(h.overviewRoot.textContent, /In Vorbereitung/);
  assert.match(h.pairedRoot.textContent, /Kein gepaarter Bericht veröffentlicht/);
  assert.match(h.pairedRoot.parentNode.textContent, /Kein gepaarter Bericht veröffentlicht/);
  h.workspace.setActive(false);
  h.workspace.setActive(true);
  await tick();
  assert.equal(calls.length, 3,
    'one fresh paired read occurs on the next authenticated active-tab entry');
  h.workspace.dispose();
});

test('active entry reads once and navigation or lock fences late private repaint', async () => {
  for (const lockOnExit of [false, true]) {
    const {expected, report} = syntheticPairedReport();
    let calls = 0;
    let signal;
    let resolveResponse;
    const pendingResponse = new Promise(resolve => { resolveResponse = resolve; });
    const h = harness({fetchImpl: async (url, init) => {
      calls++;
      signal = init.signal;
      assert.equal(url, SPOT_PAPER_PAIRED_REPORT_ENDPOINT);
      return pendingResponse;
    }});
    h.access.unlock();
    h.workspace.setActive(true);
    await tick();
    assert.equal(calls, 1);
    h.workspace.setActive(true);
    await h.workspace.refreshPaired();
    assert.equal(calls, 1, 'repeated activation and refresh remain single-flight');
    if (lockOnExit) h.access.lock();
    else h.workspace.setActive(false);
    assert.equal(signal.aborted, true);
    resolveResponse(new Response(JSON.stringify({
      schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
      runId: expected.runId,
      report
    }), {status: 200, headers: {'content-type': 'application/json'}}));
    await tick();
    assert.doesNotMatch(h.overviewRoot.textContent, /paired-synthetic-test-only/);
    assert.doesNotMatch(h.pairedRoot.textContent, /paired-synthetic-test-only/);
    h.workspace.dispose();
  }
});

test('successful paired read clears a prior missing-publication message', async () => {
  const {expected, report} = syntheticPairedReport();
  let calls = 0;
  const h = harness({fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(null, {status: 404});
    return new Response(JSON.stringify({
      schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
      runId: expected.runId,
      report
    }), {status: 200, headers: {'content-type': 'application/json'}});
  }});
  h.workspace.setActive(true);
  h.access.unlock();
  await tick();
  assert.match(h.pairedRoot.parentNode.textContent, /Kein gepaarter Bericht veröffentlicht/);
  await h.workspace.refreshPaired();
  await tick();
  assert.equal(calls, 2);
  assert.match(h.pairedRoot.parentNode.textContent, /Gepaarter Bericht geladen/);
  assert.doesNotMatch(h.pairedRoot.parentNode.textContent,
    /Kein gepaarter Bericht veröffentlicht/);
  h.workspace.dispose();
});

test('producer checkpoint crosses the authenticated gateway into the challenger card and three-arm DOM', async () => {
  const {source, progress} = await exportedProgress();
  const sameRunReport = syntheticPairedDashboard(source.expectedIdentity);
  sameRunReport.timing.valuationAt = progress.valuationAt;
  const sameTime = presentSpotPaperPairedReport(sameRunReport, {
    progressSnapshot: {status: 'AVAILABLE', progress, ageMs: 0},
    expectedIdentity: source.expectedIdentity
  });
  assert.equal(sameTime.checkpoint.sourceRelation, 'CHECKPOINT_PRECEDENCE');
  assert.equal(sameTime.checkpoint.terminalEvidence, 'RUNNING_SNAPSHOT');
  assert.equal(sameTime.checkpoint.independentAuthentication, 'NOT_ESTABLISHED');
  const separateTimeReport = structuredClone(sameRunReport);
  separateTimeReport.timing.valuationAt++;
  assert.equal(presentSpotPaperPairedReport(separateTimeReport, {
    progressSnapshot: {status: 'AVAILABLE', progress, ageMs: 0},
    expectedIdentity: source.expectedIdentity
  }).checkpoint.sourceRelation, 'SEPARATE_VALUATIONS');
  const mismatchedReport = structuredClone(sameRunReport);
  mismatchedReport.identity.configSha256 = 'f'.repeat(64);
  assert.equal(presentSpotPaperPairedReport(mismatchedReport, {
    progressSnapshot: {status: 'AVAILABLE', progress, ageMs: 0},
    expectedIdentity: source.expectedIdentity
  }).checkpoint.status, 'IDENTITY_MISMATCH');
  assert.equal(presentSpotPaperBotOverview([], {
    pairedProgress: {status: 'AVAILABLE', progress, ageMs: 0},
    pairedReport: mismatchedReport,
    expectedIdentity: source.expectedIdentity
  }).bots[0].stateReason, 'PAIRED_PROGRESS_IDENTITY_MISMATCH');
  const reader = TOKEN;
  const uploader = 'separate-progress-uploader';
  const config = spotPaperPairedProgressGatewayConfig({
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON:
      JSON.stringify(source.expectedIdentity),
    MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256:
      createHash('sha256').update(uploader).digest('hex'),
    MERIDIAN_READ_TOKEN_SHA256: createHash('sha256').update(reader).digest('hex')
  });
  const progressReads = [];
  const fetchImpl = async (url, options) => {
    if (url !== SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT) {
      return new Response(null, {status: 404});
    }
    progressReads.push(options);
    const request = Readable.from([]);
    Object.assign(request, {url: new URL(url).pathname, method: options.method,
      headers: options.headers});
    const result = await handleSpotPaperPairedProgressGatewayRequest(request, {
      config,
      getStore: () => ({get: async identity => {
        assert.deepEqual(identity, source.expectedIdentity);
        return progress;
      }}),
      authorizedRead: req => req.headers.authorization === 'Bearer ' + reader,
      signal: options.signal
    });
    return new Response(JSON.stringify(result.body), {status: result.status,
      headers: {'content-type': 'application/json'}});
  };
  const h = harness({
    fetchImpl,
    progressEnabled: true,
    progressExpectedIdentity: source.expectedIdentity,
    progressStaleAfterMs: 30_000,
    now: () => progress.exportedAt + 1
  });
  h.workspace.setActive(true);
  h.access.unlock();
  await tick();
  await tick();

  assert.equal(progressReads.length, 1, 'one authenticated progress GET on entry');
  assert.equal(progressReads[0].method, 'GET');
  assert.equal(progressReads[0].headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(progressReads[0].cache, 'no-store');
  assert.equal(progressReads[0].credentials, 'omit');
  assert.equal(progressReads[0].redirect, 'error');
  assert.equal(progressReads[0].referrerPolicy, 'no-referrer');
  assert.match(h.overviewRoot.textContent, /Checkpoint · beobachtet/);
  assert.match(h.overviewRoot.textContent, /−5,00\s+€ Verlust/);
  assert.match(h.overviewRoot.textContent, /0,00\s+€/);
  assert.match(h.overviewRoot.textContent, /Bewertung:/);
  assert.match(h.overviewRoot.textContent, /01\.01\.1970, 01:02:01/);
  assert.match(h.overviewRoot.textContent, /Gemeldeter LaufstatusUnbekannt/);
  assert.doesNotMatch(h.overviewRoot.textContent,
    /BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1|CASH_CONTROL_V1/,
    'the overview adapter projects only the trend challenger');
  assert.match(h.pairedRoot.textContent, /Beobachteter Checkpoint/);
  assert.match(h.pairedRoot.textContent, /STALE/);
  assert.match(h.pairedRoot.textContent, /Aufgezeichneter EndstatusUNKNOWN/);
  assert.match(h.pairedRoot.textContent, /Unabhängige AbschlussauthentifizierungNO_FINAL_REPORT/);
  assert.match(h.pairedRoot.textContent, /−5,00\s+€ Verlust/);
  assert.match(h.pairedRoot.textContent, /0,00\s+€/);
  assert.match(h.pairedRoot.textContent, /Gebuchte Gebühren/);
  assert.match(h.pairedRoot.textContent, /Modellierter Slippage/);
  assert.match(h.pairedRoot.textContent, /Fills/);
  assert.match(h.pairedRoot.textContent, /Position offen|Keine offene Position/);
  assert.doesNotMatch(h.pairedRoot.textContent, /Laufstatus: Läuft|RUNNING/);
  assert.match(h.pairedRoot.textContent, /BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1/);
  assert.match(h.pairedRoot.textContent, /BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1/);
  assert.match(h.pairedRoot.textContent, /CASH_CONTROL_V1/);

  await h.workspace.refreshProgress();
  await tick();
  assert.equal(progressReads.length, 2, 'manual refresh performs one further bounded read');
  h.access.lock();
  assert.doesNotMatch(h.overviewRoot.textContent, /btc-eur-paired-diag/);
  assert.doesNotMatch(h.pairedRoot.textContent, /btc-eur-paired-diag/);
  h.workspace.dispose();
});

test('historical final report and current progress remain separate in either response order', async () => {
  const {source, progress} = await exportedProgress();
  const oldFinal = evaluatePairedPaperEvidence(
    syntheticPairedEvaluatorFixture({modelPair: true}));
  assert.equal(oldFinal.evidenceStatus, 'VERIFIED_COMPLETE');
  oldFinal.identity.runId = 'btc-eur-trend-host-8h-002';
  const oldFinalResponse = () => new Response(JSON.stringify({
    schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
    runId: oldFinal.identity.runId,
    report: oldFinal
  }), {status: 200, headers: {'content-type': 'application/json'}});
  const progressResponse = () => new Response(JSON.stringify(progress), {
    status: 200, headers: {'content-type': 'application/json'}
  });

  for (const first of ['progress', 'final']) {
    const pending = new Map();
    const h = harness({
      progressEnabled: true,
      progressExpectedIdentity: source.expectedIdentity,
      progressStaleAfterMs: 30_000,
      now: () => progress.exportedAt + 1,
      fetchImpl: async url => {
        if (url === SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT ||
            url === SPOT_PAPER_PAIRED_REPORT_ENDPOINT) {
          return new Promise(resolve => pending.set(url, resolve));
        }
        return new Response(null, {status: 404});
      }
    });
    h.workspace.setActive(true);
    h.access.unlock();
    for (let attempt = 0; attempt < 20 && pending.size < 2; attempt++) await tick();
    assert.equal(pending.size, 2, 'both independent reads start on workspace entry');
    const firstUrl = first === 'progress' ?
      SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT : SPOT_PAPER_PAIRED_REPORT_ENDPOINT;
    const secondUrl = first === 'progress' ?
      SPOT_PAPER_PAIRED_REPORT_ENDPOINT : SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT;
    pending.get(firstUrl)(first === 'progress' ? progressResponse() : oldFinalResponse());
    for (let attempt = 0; attempt < 10; attempt++) await tick();
    pending.get(secondUrl)(secondUrl === SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT ?
      progressResponse() : oldFinalResponse());
    for (let attempt = 0; attempt < 10; attempt++) await tick();

    assert.match(h.overviewRoot.textContent, /Checkpoint · beobachtet/);
    assert.match(h.overviewRoot.textContent, /−5,00\s+€ Verlust/);
    assert.match(h.pairedRoot.textContent, /Beobachteter Checkpoint/);
    assert.match(h.pairedRoot.textContent,
      /QuellprioritätDer Abschlussbericht gehört zu einem anderen, historischen Lauf/);
    assert.match(h.pairedRoot.textContent,
      /Separater historischer Abschlussberichtbtc-eur-trend-host-8h-002/);
    assert.match(h.pairedRoot.textContent, /Unabhängige AbschlussauthentifizierungNO_FINAL_REPORT/);
    assert.match(h.pairedRoot.textContent, /Terminal-BerichtevidenzNO_TERMINAL_REPORT/);
    assert.match(h.pairedRoot.textContent, /Run-IDbtc-eur-trend-host-8h-002/);
    assert.match(h.pairedRoot.textContent, /VERIFIED_COMPLETE/);
    h.workspace.dispose();
  }
});

test('progress read is aborted and cannot repaint after lock or navigation', async () => {
  const {source, progress} = await exportedProgress();
  for (const exit of ['lock', 'navigation']) {
    let signal;
    let resolveResponse;
    const responsePending = new Promise(resolve => { resolveResponse = resolve; });
    const h = harness({
      progressEnabled: true,
      progressExpectedIdentity: source.expectedIdentity,
      fetchImpl: async (url, options) => {
        if (url === SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT) {
          signal = options.signal;
          return responsePending;
        }
        return new Response(null, {status: 404});
      }
    });
    h.access.unlock();
    h.workspace.setActive(true);
    await tick();
    assert.equal(signal.aborted, false);
    if (exit === 'lock') h.access.lock();
    else h.workspace.setActive(false);
    assert.equal(signal.aborted, true);
    resolveResponse(new Response(JSON.stringify(progress), {
      status: 200, headers: {'content-type': 'application/json'}
    }));
    await tick();
    assert.doesNotMatch(h.overviewRoot.textContent, /paired-trend-synthetic-001/);
    assert.doesNotMatch(h.pairedRoot.textContent, /paired-trend-synthetic-001/);
    h.workspace.dispose();
  }
});

test('M11 strategy bootstrap mounts both reviewed panels under existing navigation and owns the only click path', () => {
  const source = readFileSync(new URL('../v11/strategy-workspace-bootstrap.js', import.meta.url), 'utf8');
  assert.match(source, /mountPaperBotReportWorkspace/);
  assert.match(source, /paper-bot-overview-section/);
  assert.match(source, /paired-paper-report-section/);
  assert.match(source, /Run-, Quellen-, Profil-, Fingerabdruck- und Host-Identität bleiben unbekannt/);
  assert.match(source, /paperBotReportWorkspace\?\.setActive\(button\.dataset\.v==='strategies'\)/);
  assert.match(source, /botReports\.open=true/);
  assert.equal((source.match(/addEventListener\(['"]click['"]/g) || []).length, 2,
    'one nav and one strategy shortcut listener remain; no report polling listener is added');
  assert.doesNotMatch(source, /\bsetInterval\s*\(|\bsetTimeout\s*\(/);
});
