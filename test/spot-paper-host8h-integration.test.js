import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {
  buildSpotPaperHost8hSummary
} from '../scripts/spot-paper-report-bridge/host8h-presentation.mjs';
import {
  getSpotPaperHost8hIdentity,
  isSpotPaperHost8hEnvelope,
  normalizeSpotPaperHost8hReport,
  SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
  SPOT_PAPER_HOST8H_TRANSFER_SCHEMA
} from '../scripts/spot-paper-report-bridge/host8h-contract.mjs';
import {
  handleSpotPaperHost8hReportGatewayRequest,
  spotPaperHost8hReportGatewayConfig
} from '../spot-paper-host8h-report-gateway.mjs';
import {createPrivateReportStore} from '../private-report-store.mjs';
import {mountSpotPaperHost8hDashboard} from '../v11/spot-paper-host8h-controller.js';
import {HOST_LAUNCH_MANIFEST} from '../scripts/spot-paper-pilot/host-entrypoint.mjs';

const READ_TOKEN = 'fixture-host8h-read-token';
const UPLOAD_TOKEN = 'fixture-host8h-upload-token';
const NOW = Date.parse('2026-11-08T14:00:00.000Z');
const identity = getSpotPaperHost8hIdentity();
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ?
  JSON.stringify(value) : Array.isArray(value) ?
    `[${value.map(canonical).join(',')}]` :
    `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

function journal({terminal = false} = {}) {
  const events = [{id: 'run-start', type: 'start', at: NOW - 60_000}];
  if (terminal) {
    for (let cycle = 0; cycle < 470; cycle++) {
      events.push({id: `observation:${cycle + 1}`, type: 'observation', at: NOW - 30_000});
    }
    for (let cycle = 0; cycle < 10; cycle++) {
      events.push({id: `gap:${cycle + 471}`, type: 'data_gap', at: NOW - 1_000});
    }
    events.push({id: 'run-terminal', type: 'terminal', at: NOW - 1_000});
  } else {
    events.push(
      {id: 'observation:1', type: 'observation', at: NOW - 30_000},
      {id: 'gap:2', type: 'data_gap', at: NOW - 1_000}
    );
  }
  return {
    schemaVersion: 'SPOT_PAPER_PILOT_JOURNAL_V1',
    runId: identity.runId,
    sequence: events.length,
    reconciliationStatus: terminal ? 'READ_ONLY_VERIFIED' : 'UNKNOWN_WRITER_OR_INTERRUPTED',
    manifest: {
      schemaVersion: 'SPOT_PAPER_PILOT_MANIFEST_V1',
      model: HOST_LAUNCH_MANIFEST.model,
      mode: 'paper',
      pair: 'BTC/EUR',
      startedAt: NOW - 60_000,
      limits: {
        maxCycles: HOST_LAUNCH_MANIFEST.maxCycles,
        maxRequests: HOST_LAUNCH_MANIFEST.maxRequests,
        maxDurationMs: HOST_LAUNCH_MANIFEST.maxDurationMs
      }
    },
    checkpoint: {
      cycle: terminal ? 480 : 2,
      counters: {requests: terminal ? 950 : 4, bytes: 42},
      stopReason: terminal ? 'DURATION_LIMIT' : null,
      ledger: {
        cashCents: 98_900,
        realizedPnlCents: 0,
        feesCents: 100,
        position: {quantitySat: 10_000_000, entryCostCents: 1_000},
        lastMark: {
          bidNano: 10_000_000_000,
          exitPriceNano: '9990000000',
          netExitCents: 1_105,
          unrealizedPnlCents: 5
        },
        fills: [{side: 'BUY', quantitySat: 10_000_000}]
      }
    },
    events
  };
}

function terminalAssessment() {
  return {
    schemaVersion: 'SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1',
    outcome: 'COMPLETED',
    assessment: {
      terminalVerified: true,
      boundedTermination: true,
      runId: identity.runId,
      profileId: identity.profileId,
      sourceSha: identity.sourceSha,
      outcome: 'COMPLETED',
      elapsedMs: 28_800_000,
      durationCoverage: 1,
      durationStatus: 'FULL_REQUESTED_DURATION',
      cycleCount: 480,
      cycleCoverage: 1,
      acceptedObservations: 470,
      acceptedObservationCoverage: 470 / 480,
      observations: 470,
      dataGaps: 10,
      requests: 950,
      cashCents: 98_900,
      equityCents: 99_005,
      realizedPnlCents: -1_000,
      unrealizedPnlCents: 5,
      feesCents: 100,
      position: {
        quantitySat: 10_000_000,
        entryCostCents: 1_000
      },
      positionStatus: 'OPEN_UNRESOLVED_AT_TERMINAL',
      lastMark: {
        bidNano: 10_000_000_000,
        exitPriceNano: '9990000000'
      },
      fills: [{side: 'BUY'}, {side: 'SELL'}]
    }
  };
}

function summary(status = 'RUNNING_OBSERVED') {
  return buildSpotPaperHost8hSummary({
    hostSnapshot: {status, runId: identity.runId, verifiedTerminal: status === 'VERIFIED_TERMINAL'},
    journal: journal({terminal: status === 'VERIFIED_TERMINAL'}),
    assessment: status === 'VERIFIED_TERMINAL' ? terminalAssessment() : null,
    observedAt: new Date(NOW).toISOString()
  });
}

function gatewayConfig() {
  return spotPaperHost8hReportGatewayConfig({
    MERIDIAN_READ_TOKEN_SHA256: hash(READ_TOKEN),
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_ENABLED: 'true',
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_DEPLOYMENT_VERIFIED: 'true',
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_APPROVED: 'true',
    MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN_SHA256: hash(UPLOAD_TOKEN)
  });
}

function request(method, url, token, body) {
  const bytes = body === undefined ? null : Buffer.from(body);
  return {
    method, url,
    headers: {
      authorization: token ? 'Bearer ' + token : '',
      ...(bytes ? {
        'content-type': 'application/json',
        'content-length': String(bytes.byteLength)
      } : {})
    },
    ...(bytes ? {[Symbol.asyncIterator]: async function* () { yield bytes; }} : {})
  };
}

const authorizedRead = req => req.headers.authorization === 'Bearer ' + READ_TOKEN;

test('gateway rejects contradictory terminal outcomes and nonboolean termination before storing', async () => {
  const mutations = [
    report => {
      report.assessment.assessment.outcome = 'FAILED';
      report.sourceEvidence.assessmentOutcome = 'FAILED';
    },
    report => { report.assessment.outcome = 'FAILED'; },
    report => { report.sourceEvidence.assessmentOutcome = 'FAILED'; },
    ...[null, 'true', 1, undefined].map(value => report => {
      report.assessment.assessment.boundedTermination = value;
    })
  ];
  let writes = 0;
  for (const mutate of mutations) {
    const report = summary('VERIFIED_TERMINAL');
    mutate(report);
    assert.equal(normalizeSpotPaperHost8hReport(report, {now: NOW}), null);
    const response = await handleSpotPaperHost8hReportGatewayRequest(request('POST',
      '/api/private/spot-paper-host8h-report/upload', UPLOAD_TOKEN,
      canonical({schema: SPOT_PAPER_HOST8H_TRANSFER_SCHEMA, runId: identity.runId, report})), {
      config: gatewayConfig(), authorizedRead, now: () => NOW,
      getStore: () => ({putLatest: async () => { writes++; return 'INSERTED'; }})
    });
    assert.equal(response.status, 400);
  }
  assert.equal(writes, 0);
  for (const outcome of ['COMPLETED', 'FAILED', 'UNKNOWN']) {
    const report = summary('VERIFIED_TERMINAL');
    report.assessment.outcome = outcome;
    report.assessment.assessment.outcome = outcome;
    report.sourceEvidence.assessmentOutcome = outcome;
    report.assessment.assessment.boundedTermination = false;
    assert.ok(normalizeSpotPaperHost8hReport(report, {now: NOW}));
  }
});

class Store {
  row = null;
  conflictNext = false;
  async putLatest(input) {
    if (this.conflictNext) {
      this.conflictNext = false;
      return 'CONFLICT';
    }
    if (!this.row) {
      this.row = {
        run_id: input.runId,
        config_hash: input.configHash,
        content_sha256: input.digest,
        observed_at: input.observedAt,
        journal_sequence: input.journalSequence,
        envelope: structuredClone(input.envelope)
      };
      return 'INSERTED';
    }
    if (this.row.content_sha256 === input.digest) return 'IDENTICAL';
    const previousStatus = this.row.envelope.report.snapshot.status;
    const nextStatus = input.envelope.report.snapshot.status;
    if (previousStatus === 'VERIFIED_TERMINAL' && nextStatus !== 'VERIFIED_TERMINAL') {
      return 'TERMINAL_REGRESSION';
    }
    if (Date.parse(this.row.observed_at) > Date.parse(input.observedAt) ||
        (this.row.observed_at === input.observedAt &&
          this.row.journal_sequence > input.journalSequence)) return 'STALE';
    if (Date.parse(this.row.observed_at) < Date.parse(input.observedAt) &&
        this.row.journal_sequence <= input.journalSequence ||
        this.row.observed_at === input.observedAt &&
          this.row.journal_sequence < input.journalSequence) {
      this.row = {
        run_id: input.runId,
        config_hash: input.configHash,
        content_sha256: input.digest,
        observed_at: input.observedAt,
        journal_sequence: input.journalSequence,
        envelope: structuredClone(input.envelope)
      };
      return 'INSERTED';
    }
    return 'CONFLICT';
  }
  async get(runId) { return this.row?.run_id === runId ? this.row : null; }
}

test('host8h exporter limits fields to a bounded provisional journal snapshot', () => {
  const report = summary();
  assert.equal(report.snapshot.status, 'RUNNING_OBSERVED');
  assert.equal(report.snapshot.verifiedTerminal, false);
  assert.equal(report.assessment, null);
  assert.equal(report.metrics.cashCents, 98_900);
  assert.equal(report.metrics.equityCents, 100_005);
  assert.equal(report.metrics.realizedPnlCents + report.metrics.unrealizedPnlCents,
    report.metrics.equityCents - report.metrics.initialCashCents);
  assert.equal(report.metrics.totalPnlCents, 5);
  assert.equal(report.metrics.bookedFeesCents, 100);
  assert.ok(report.metrics.estimatedExitFeeCents >= 0);
  assert.ok(Number.isSafeInteger(report.metrics.estimatedExitSlippageCents),
    JSON.stringify(report.metrics));
  assert.equal(report.metrics.fillCount, 1);
  assert.equal(report.metrics.closedTradeCount, 0);
  assert.equal(report.identity.currency, 'EUR');
  assert.equal(report.identity.leverage, 1);
  assert.equal(report.identity.positionMode, 'LONG_ONLY');
  assert.ok(normalizeSpotPaperHost8hReport(report, {now: NOW}));
  const broken = journal();
  broken.checkpoint.cycle = 1;
  assert.throws(() => buildSpotPaperHost8hSummary({
    hostSnapshot: {status: 'RUNNING_OBSERVED', runId: identity.runId},
    journal: broken,
    observedAt: new Date(NOW).toISOString()
  }), /HOST8H_JOURNAL_SNAPSHOT_INCONSISTENT/);
});

test('terminal host8h metrics require a matching terminal assessment', () => {
  const report = summary('VERIFIED_TERMINAL');
  assert.equal(report.snapshot.verifiedTerminal, true);
  assert.equal(report.assessment.outcome, 'COMPLETED');
  assert.equal(report.metrics.fillCount, 2);
  assert.equal(report.metrics.closedTradeCount, 1);
  assert.equal(report.metrics.totalPnlCents, -995);
  assert.ok(normalizeSpotPaperHost8hReport(report, {now: NOW}));
  assert.throws(() => buildSpotPaperHost8hSummary({
    hostSnapshot: {status: 'VERIFIED_TERMINAL', runId: identity.runId, verifiedTerminal: true},
    journal: journal({terminal: true}),
    observedAt: new Date(NOW).toISOString()
  }), /HOST8H_TERMINAL_ASSESSMENT_REQUIRED/);
  assert.throws(() => buildSpotPaperHost8hSummary({
    hostSnapshot: {status: 'VERIFIED_TERMINAL', runId: identity.runId, verifiedTerminal: false},
    journal: journal({terminal: true}),
    assessment: terminalAssessment(),
    observedAt: new Date(NOW).toISOString()
  }), /HOST8H_STATUS_IDENTITY_INVALID/);
  const mismatched = structuredClone(report);
  mismatched.assessment.assessment.sourceSha = 'a'.repeat(64);
  assert.equal(normalizeSpotPaperHost8hReport(mismatched, {now: NOW}), null);
});

test('host8h contract rejects USD relabeling, stale identities, and over-limit data', () => {
  const report = summary();
  report.identity = {...report.identity, currency: 'USD'};
  assert.equal(normalizeSpotPaperHost8hReport(report, {now: NOW}), null);
  const mismatch = summary();
  mismatch.identity = {...mismatch.identity, runId: 'spot-paper-42404743386-1'};
  assert.equal(normalizeSpotPaperHost8hReport(mismatch, {now: NOW}), null);
  const tooMany = summary();
  tooMany.metrics.requests = 961;
  assert.equal(normalizeSpotPaperHost8hReport(tooMany, {now: NOW}), null);
  const rawJournal = summary();
  rawJournal.journal = {secret: 'not-for-browser'};
  assert.equal(normalizeSpotPaperHost8hReport(rawJournal, {now: NOW}), null);
  const excessiveSequence = summary();
  excessiveSequence.sourceEvidence.journalSequence = 483;
  assert.equal(normalizeSpotPaperHost8hReport(excessiveSequence, {now: NOW}), null);
  const envelope = {
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: summary()
  };
  assert.equal(isSpotPaperHost8hEnvelope(envelope, {now: NOW}), true);
  envelope.report.identity = {...envelope.report.identity, pair: 'BTC/USD'};
  assert.equal(isSpotPaperHost8hEnvelope(envelope, {now: NOW}), false);
});

test('host8h gateway isolates admission, requires separate upload auth, and rejects stale updates', async () => {
  const config = gatewayConfig();
  const store = new Store();
  const deps = {
    config, getStore: () => store, authorizedRead, now: () => NOW
  };
  const upload = report => handleSpotPaperHost8hReportGatewayRequest(
    request('POST', '/api/private/spot-paper-host8h-report/upload', UPLOAD_TOKEN,
      canonical({schema: SPOT_PAPER_HOST8H_TRANSFER_SCHEMA, runId: identity.runId, report})),
    deps
  );
  const read = token => handleSpotPaperHost8hReportGatewayRequest(
    request('GET', '/api/private/spot-paper-host8h-report', token), deps
  );
  assert.equal((await read('')).status, 401);
  assert.equal((await handleSpotPaperHost8hReportGatewayRequest(
    request('POST', '/api/private/spot-paper-host8h-report/upload', READ_TOKEN,
      canonical({schema: SPOT_PAPER_HOST8H_TRANSFER_SCHEMA, runId: identity.runId,
        report: summary()})), deps
  )).status, 401);
  assert.equal((await upload({
    ...summary(),
    identity: {...identity, runId: 'other-host8h-run'}
  })).status, 400);
  assert.equal((await handleSpotPaperHost8hReportGatewayRequest(
    request('POST', '/api/private/spot-paper-host8h-report/upload', UPLOAD_TOKEN,
      'x'.repeat(256 * 1024 + 1)), deps
  )).status, 413);
  assert.equal((await upload(summary())).status, 201);
  const saved = await read(READ_TOKEN);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.report.metrics.totalPnlCents, 5);
  const old = summary();
  old.observedAt = '2026-11-08T13:59:00.000Z';
  old.sourceEvidence.journalSequence = 1;
  assert.equal((await upload(old)).status, 409);
  assert.equal((await upload(summary())).status, 200);
  store.conflictNext = true;
  const conflict = await upload(summary());
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'host8h_snapshot_conflict');
  assert.equal((await upload(summary('VERIFIED_TERMINAL'))).status, 201);
  const terminalRow = structuredClone(store.row);
  const regression = await upload(summary());
  assert.equal(regression.status, 409);
  assert.equal(regression.body.error, 'host8h_terminal_regression_rejected');
  assert.deepEqual(store.row, terminalRow, 'terminal state and provenance survive a running replay');
  const legacy = await handleSpotPaperHost8hReportGatewayRequest(
    request('GET', '/api/private/spot-paper-report', READ_TOKEN), deps
  );
  assert.equal(legacy, null);
});

test('host8h gateway fails closed and reports unprovisioned transport without data', async () => {
  const result = await handleSpotPaperHost8hReportGatewayRequest(
    request('GET', '/api/private/spot-paper-host8h-report', READ_TOKEN),
    {config: spotPaperHost8hReportGatewayConfig({}), authorizedRead}
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'host8h_transport_not_provisioned');
});

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() {
    return this.text + this.children.map(child => child.textContent).join('');
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.text = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
}

function dashboardDependencies(fetchImpl, {
  unlocked = true, now = () => NOW, staleAfterMs = 5 * 60 * 1000
} = {}) {
  const root = new Element();
  const document = {createElement: () => new Element()};
  const listeners = new Set(), readers = new Set();
  const access = {
    getToken: () => unlocked ? READ_TOKEN : null,
    isUnlocked: () => unlocked,
    lock: () => { unlocked = false; for(const clear of readers)clear(); for(const listener of listeners)listener({status:'locked'}); },
    registerReader: clear => { readers.add(clear); return () => readers.delete(clear); },
    subscribe: listener => {
      listeners.add(listener);
      listener({status: unlocked ? 'unlocked' : 'locked'});
      return () => listeners.delete(listener);
    }
  };
  const windowListeners = new Map();
  const window = {
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: name => windowListeners.delete(name)
  };
  const timers = [];
  const controller = mountSpotPaperHost8hDashboard(root, document, window, {
    access,
    fetchImpl,
    now,
    staleAfterMs,
    schedule: (callback, delay) => {
      const timer = {callback, delay, cancelled: false};
      timers.push(timer);
      return timer;
    },
    cancelSchedule: timer => {
      timer.cancelled = true;
    }
  });
  return {root, controller, timers, access, windowListeners,
    unlock(){unlocked=true;for(const listener of listeners)listener({status:'unlocked'});},
    fire(name){windowListeners.get(name)?.();}};
}

function response(body, status = 200) {
  const bytes = Buffer.from(JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: name => name === 'content-type' ? 'application/json' :
        name === 'content-length' ? String(bytes.byteLength) : null
    },
    arrayBuffer: async () => bytes
  };
}

test('Dashboard host8h read is authenticated, bounded, and refreshes only while active', async () => {
  const calls = [];
  const deps = dashboardDependencies(async (url, options) => {
    calls.push({url, options});
    return response({
      schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
      runId: identity.runId,
      report: summary()
    });
  });
  deps.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/private\/spot-paper-host8h-report$/);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + READ_TOKEN);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(deps.root.getAttribute('data-state'), 'running_observed');
  assert.match(deps.root.textContent, /Zwischenstand/);
  deps.controller.dispose();
});

test('Dashboard reports missing provisioning and cancels in-flight reads when inactive', async () => {
  const unavailable = dashboardDependencies(async () => response({
    error: 'host8h_transport_not_provisioned'
  }, 503));
  unavailable.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(unavailable.root.textContent, /Paper-Daten noch nicht verbunden/);
  assert.doesNotMatch(unavailable.root.textContent, /provisioniert|Upload-Credential|Gateway-Freigaben|injizierter UI-Snapshot/);
  unavailable.controller.dispose();

  let resolveResponse;
  let capturedSignal;
  const pending = dashboardDependencies((url, options) => {
    capturedSignal = options.signal;
    return new Promise(resolve => { resolveResponse = resolve; });
  });
  pending.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  pending.controller.setActive(false);
  assert.equal(capturedSignal.aborted, true);
  resolveResponse(response({
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: summary()
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(pending.root.textContent, /Zwischenstand/);
  pending.controller.dispose();
});

test('Dashboard distinguishes a missing summary from a missing route on bounded 404s', async () => {
  const missingSummary = dashboardDependencies(async () =>
    response({error: 'host8h_report_not_found'}, 404));
  missingSummary.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(missingSummary.root.textContent, /Der erste Paper-Bericht fehlt noch/);
  missingSummary.controller.dispose();

  const missingRoute = dashboardDependencies(async () => response({error: 'not_found'}, 404));
  missingRoute.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(missingRoute.root.textContent, /Paper-Daten noch nicht verbunden/);
  missingRoute.controller.dispose();
});

test('Dashboard freshness expires locally and cancels its timer when inactive', async () => {
  let clock = NOW;
  const freshnessWindow = 60_000;
  let calls = 0;
  const deps = dashboardDependencies(async () => {
    calls++;
    return response({
      schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
      runId: identity.runId,
      report: summary()
    });
  }, {now: () => clock, staleAfterMs: freshnessWindow});
  deps.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deps.root.getAttribute('data-state'), 'running_observed');
  const timer = deps.timers.find(candidate =>
    !candidate.cancelled && candidate.delay === freshnessWindow + 1);
  assert.ok(timer, 'a one-shot local timer is scheduled for the freshness boundary');
  clock = NOW + freshnessWindow + 1;
  timer.cancelled = true;
  timer.callback();
  assert.equal(deps.root.getAttribute('data-state'), 'stale');
  assert.match(deps.root.textContent, /Bericht veraltet/);
  assert.equal(deps.root.textContent.includes('Paper-Daten noch nicht verbunden'), false);
  assert.equal(calls, 1, 'freshness expiry is local and does not poll the endpoint');
  deps.controller.dispose();

  const active = dashboardDependencies(async () => response({
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: summary()
  }));
  active.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  const pendingTimer = active.timers.find(candidate =>
    !candidate.cancelled && candidate.delay === 5 * 60 * 1000 + 1);
  assert.ok(pendingTimer);
  active.controller.setActive(false);
  assert.equal(pendingTimer.cancelled, true);
  active.controller.dispose();
});

test('Dashboard rejects out-of-order and terminal-to-running snapshots without replacement', async () => {
  const responses = [
    summary('VERIFIED_TERMINAL'),
    {...summary(), observedAt: new Date(NOW + 1_000).toISOString()}
  ];
  let clock = NOW;
  const deps = dashboardDependencies(async () => response({
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: responses.shift()
  }), {now: () => clock});
  deps.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deps.root.getAttribute('data-state'), 'verified_terminal');
  const terminalText = deps.root.textContent;
  clock = NOW + 2_000;
  await deps.controller.refresh();
  assert.equal(deps.root.getAttribute('data-state'), 'verified_terminal');
  assert.match(deps.root.textContent, /widersprüchlicher Bericht wurde verworfen/);
  assert.match(deps.root.textContent, /Lauf beendet · Abschluss geprüft/);
  assert.ok(deps.root.textContent.includes('Zuletzt beobachtet' + new Intl.DateTimeFormat('de-DE', {dateStyle:'medium', timeStyle:'medium'}).format(new Date('2026-11-08T14:00:00.000Z')) + ' (lokal)'));
  assert.ok(deps.root.textContent.includes('Beobachtungszeit (UTC)2026-11-08T14:00:00.000Z'));
  assert.ok(deps.root.textContent.includes('Datenlücken10'));
  assert.notEqual(deps.root.textContent, terminalText);
  deps.controller.dispose();

  const orderedResponses = [
    summary(),
    {...summary(), observedAt: '2026-11-08T13:59:00.000Z'}
  ];
  const outOfOrder = dashboardDependencies(async () => response({
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: orderedResponses.shift()
  }));
  outOfOrder.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  const acceptedText = outOfOrder.root.textContent;
  await outOfOrder.controller.refresh();
  assert.equal(outOfOrder.root.getAttribute('data-state'), 'running_observed');
  assert.match(outOfOrder.root.textContent, /widersprüchlicher Bericht wurde verworfen/);
  assert.ok(outOfOrder.root.textContent.includes('Beobachtungszeit (UTC)2026-11-08T14:00:00.000Z'));
  assert.notEqual(outOfOrder.root.textContent, acceptedText);
  outOfOrder.controller.dispose();

  const sequenceResponses = [
    summary(),
    {...summary(), observedAt: new Date(NOW + 1_000).toISOString(),
      sourceEvidence: {...summary().sourceEvidence, journalSequence: 2}}
  ];
  clock = NOW;
  const sequenceRegression = dashboardDependencies(async () => response({
    schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
    runId: identity.runId,
    report: sequenceResponses.shift()
  }), {now: () => clock});
  sequenceRegression.controller.setActive(true);
  await new Promise(resolve => setImmediate(resolve));
  clock = NOW + 2_000;
  await sequenceRegression.controller.refresh();
  assert.equal(sequenceRegression.root.getAttribute('data-state'), 'running_observed');
  assert.match(sequenceRegression.root.textContent, /widersprüchlicher Bericht wurde verworfen/);
  assert.ok(sequenceRegression.root.textContent.includes('Beobachtungszeit (UTC)2026-11-08T14:00:00.000Z'));
  sequenceRegression.controller.dispose();
});

test('host8h database upsert refuses sequence regression despite a later timestamp', async () => {
  const statements = [];
  let storedStatus = 'RUNNING_OBSERVED';
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO')) return {rowCount: 0, rows: []};
      if (sql.includes('SELECT config_hash, content_sha256')) {
        return {rowCount: 1, rows: [{
          config_hash: 'c'.repeat(64),
          content_sha256: 'd'.repeat(64),
          observed_at: new Date(NOW).toISOString(),
          journal_sequence: 9,
          envelope: {report: {snapshot: {status: storedStatus}}}
        }]};
      }
      return {rowCount: 0, rows: []};
    },
    release() {}
  };
  const db = {connect: async () => client, query: async () => ({rows: []})};
  const store = createPrivateReportStore(db, {
    tableName: 'meridian_spot_paper_host8h_reports'
  });
  const result = await store.putLatest({
    runId: identity.runId,
    configHash: 'c'.repeat(64),
    digest: 'e'.repeat(64),
    envelope: {},
    observedAt: new Date(NOW + 60_000).toISOString(),
    journalSequence: 8
  });
  assert.equal(result, 'STALE');
  storedStatus = 'VERIFIED_TERMINAL';
  const terminalRegression = await store.putLatest({
    runId: identity.runId,
    configHash: 'c'.repeat(64),
    digest: 'e'.repeat(64),
    envelope: {report: {snapshot: {status: 'RUNNING_OBSERVED'}}},
    observedAt: new Date(NOW + 60_000).toISOString(),
    journalSequence: 8
  });
  assert.equal(terminalRegression, 'TERMINAL_REGRESSION');
  const insert = statements.find(sql => sql.startsWith('INSERT INTO'));
  assert.match(insert, /observed_at < EXCLUDED\.observed_at[\s\S]*journal_sequence <= EXCLUDED\.journal_sequence/);
  assert.match(insert, /observed_at = EXCLUDED\.observed_at[\s\S]*journal_sequence < EXCLUDED\.journal_sequence/);
  assert.match(insert, /IS DISTINCT FROM\s+'VERIFIED_TERMINAL'[\s\S]*EXCLUDED\.envelope #>>/);
  assert.match(statements.find(sql => sql.startsWith('SELECT config_hash')), /envelope/);
});


test('Dashboard restores selected tab after pageshow but requires re-unlock before a new read', async () => {
  let reads=0,resolveLate,signal;
  const deps=dashboardDependencies((_url,options)=>{
    reads++;signal=options.signal;
    if(reads===1)return new Promise(resolve=>{resolveLate=resolve;});
    return Promise.resolve(response({schema:SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,runId:identity.runId,report:summary()}));
  });
  deps.controller.setActive(true);assert.equal(reads,1);
  deps.fire('pagehide');assert.equal(signal.aborted,true);assert.equal(deps.access.isUnlocked(),false);
  deps.fire('pageshow');assert.equal(reads,1);assert.equal(deps.root.getAttribute('data-state'),'auth-required');
  resolveLate(response({schema:SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,runId:identity.runId,report:summary()}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.doesNotMatch(deps.root.textContent,/Eigenkapital|Netto-Gewinn/);
  deps.unlock();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,2);assert.equal(deps.root.getAttribute('data-state'),'running_observed');
  deps.fire('pageshow');assert.equal(reads,2,'duplicate pageshow does not poll');
  deps.controller.dispose();assert.equal(deps.windowListeners.size,0);
  deps.fire('pagehide');deps.fire('pageshow');deps.unlock();assert.equal(reads,2);assert.equal(deps.root.textContent,'');
});

test('Dashboard pageshow never activates a previously inactive or explicitly deselected tab', async () => {
  for(const deselect of [false,true]){
    let reads=0;
    const deps=dashboardDependencies(async()=>{reads++;return response({error:'host8h_transport_not_provisioned'},503);});
    if(deselect){deps.controller.setActive(true);await new Promise(resolve=>setImmediate(resolve));}
    deps.fire('pagehide');
    if(deselect)deps.controller.setActive(false);
    deps.fire('pageshow');deps.unlock();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,deselect?1:0);deps.controller.dispose();
  }
});
