import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createPaperReportBridge,
  MAX_PAPER_REPORT_BYTES,
  PAPER_REPORT_ENVELOPE_SCHEMA
} from '../scripts/memecoin-paper-report-bridge/index.mjs';
import {projectOperatorReport} from '../scripts/memecoin-paper/operator-report.mjs';
import {reportFixtures} from './fixtures/memecoin-paper-operator-report/scenarios.mjs';
import {createPaperReportConnector} from '../v11/paper-report-connector.js';
import {presentPaperCockpitReport} from '../v11/paper-cockpit-model.js';
import {renderPaperCockpit} from '../v11/paper-cockpit-view.js';

const NOW = Date.parse('2026-01-02T00:00:00.000Z');

function reportFixture(kind = 'observation') {
  const report = projectOperatorReport(kind === 'synthetic'
    ? reportFixtures.positiveReplay()
    : reportFixtures.readOnlyCheckpoint());
  report.evidence.observedFrom = '2026-01-01T10:00:00.000Z';
  report.evidence.observedThrough = '2026-01-01T10:01:00.000Z';
  return report;
}

function envelopeBytes(report, runId = report.experiment.id, schema = PAPER_REPORT_ENVELOPE_SCHEMA) {
  return new TextEncoder().encode(JSON.stringify({schema, runId, report}));
}

function bridge(bytes, options = {}) {
  return createPaperReportBridge({
    readSource: async ({signal}) => {
      assert.equal(signal instanceof AbortSignal, true);
      return bytes;
    },
    enabled: true,
    now: () => NOW,
    ...options
  });
}

function response(bytes, {
  status = 200,
  contentLength = String(bytes.byteLength),
  contentType = 'application/json; charset=utf-8',
  onCancel = () => {},
  stalled = false
} = {}) {
  const body = new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      if (!stalled) controller.close();
    },
    cancel() { return onCancel(); }
  });
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (name === 'content-type') return contentType;
        if (name === 'content-length') return contentLength;
        return null;
      }
    },
    body
  };
}

class Element {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = tagName;
    this.children = [];
    this.attrs = {};
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Report text must not be interpreted as HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}

function documentHarness() {
  const document = {createElement: tag => new Element(document, tag)};
  return {root: new Element(document, 'section'), document};
}

const visit = element => [element, ...element.children.flatMap(visit)];

test('bridge stays disabled until opt-in and accepts a bounded observation DTO', async () => {
  const report = reportFixture();
  report.valuation.cashCents = '90071992547409931234';
  report.valuation.realizedNetPnlCents = '-12345678901234567890';
  report.trading.paperEntryFills = null;
  report.evidence.coverage.discovery.sourceTruncated = true;
  report.evidence.coverage.discovery.unaccountedObservedRecords = 2;
  report.candidates.detailsCoverage.sourceTruncated = true;
  report.candidates.detailsCoverage.unaccounted = 2;
  const bytes = envelopeBytes(report);
  let sourceReads = 0;
  const disabled = createPaperReportBridge({
    readSource: async () => { sourceReads += 1; return bytes; },
    now: () => NOW
  });
  assert.equal((await disabled.read()).status, 'DISABLED');
  assert.equal(sourceReads, 0);

  const result = await bridge(bytes, {staleAfterMs: 60_000}).read();
  assert.equal(result.status, 'STALE');
  assert.equal(result.runId, report.experiment.id);
  assert.equal(result.report.experiment.sourceProvenance, 'CALLER_LABEL_ONLY_NOT_AUTHENTICATED');
  assert.equal(result.report.valuation.cashCents, '90071992547409931234');
  assert.equal(result.report.valuation.realizedNetPnlCents, '-12345678901234567890');

  const model = presentPaperCockpitReport(result.report, {now: NOW, staleAfterMs: 60_000});
  assert.equal(model.experiment.id, result.runId);
  assert.equal(model.experiment.mode.label, 'Observation-only');
  assert.equal(model.trading.fillCount, null);
  assert.equal(model.candidates.considered, null);
  assert.equal(model.valuation.cash.label, '90071992547409931234 cents');
  assert.equal(model.valuation.realizedNet.label, '−12345678901234567890 cents');
  assert.equal(model.evidence.coverage, 'PARTIAL');
  assert.equal(model.evidence.freshness.status, 'STALE');
});

test('synthetic and observation provenance remain distinct in the cockpit model', async () => {
  const observation = await bridge(envelopeBytes(reportFixture())).read();
  const syntheticReport = reportFixture('synthetic');
  const synthetic = await bridge(envelopeBytes(syntheticReport)).read();

  assert.equal(presentPaperCockpitReport(observation.report).experiment.mode.label, 'Observation-only');
  assert.equal(
    presentPaperCockpitReport(synthetic.report).experiment.mode.label,
    'Simulated trading · synthetic fixture'
  );
  assert.equal(synthetic.report.experiment.sourceProvenance, 'SYNTHETIC_FIXTURE_DECLARED');
});

test('malformed, oversized, unsupported, or identity-mismatched envelopes reject closed', async () => {
  const report = reportFixture();
  const invalidCases = [
    {bytes: new TextEncoder().encode('{'), code: 'INVALID_JSON'},
    {bytes: new Uint8Array(MAX_PAPER_REPORT_BYTES + 1), code: 'OVERSIZED'},
    {
      bytes: envelopeBytes(report, report.experiment.id, 'UNSUPPORTED_ENVELOPE_V9'),
      code: 'UNSUPPORTED_ENVELOPE'
    },
    {
      bytes: envelopeBytes({...report, schema: 'MEMECOIN_PAPER_OPERATOR_REPORT_V2'}),
      code: 'UNSUPPORTED_SCHEMA'
    },
    {bytes: envelopeBytes(report, 'another-run'), code: 'RUN_ID_MISMATCH'}
  ];
  for (const {bytes, code} of invalidCases) {
    const result = await bridge(bytes).read();
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, code);
    assert.equal(result.report, null);
  }
});

test('missing report values remain absent and the model keeps them unknown', async () => {
  const report = reportFixture();
  delete report.trading.paperEntryFills;
  delete report.candidates.considered;
  delete report.valuation.cashCents;
  const result = await bridge(envelopeBytes(report)).read();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(Object.hasOwn(result.report.trading, 'paperEntryFills'), false);
  assert.equal(Object.hasOwn(result.report.candidates, 'considered'), false);
  assert.equal(Object.hasOwn(result.report.valuation, 'cashCents'), false);
  const model = presentPaperCockpitReport(result.report);
  assert.equal(model.trading.fillCount, null);
  assert.equal(model.candidates.considered, null);
  assert.equal(model.valuation.cash.label, 'Unavailable');
});

test('future observation timestamps reject and partial coverage remains explicit', async () => {
  const report = reportFixture();
  report.evidence.observedThrough = new Date(NOW + 1).toISOString();
  const future = await bridge(envelopeBytes(report)).read();
  assert.equal(future.status, 'REJECTED');
  assert.equal(future.reason, 'FUTURE_OBSERVATION');

  const partial = reportFixture();
  partial.evidence.coverage.discovery.sourceTruncated = true;
  partial.evidence.coverage.discovery.unaccountedObservedRecords = 3;
  const result = await bridge(envelopeBytes(partial)).read();
  assert.equal(presentPaperCockpitReport(result.report).evidence.coverage, 'PARTIAL');
});

test('existing cockpit renderer treats untrusted report strings as text', async () => {
  const report = reportFixture();
  report.trading.noTradeReasons = [{
    mint: null,
    gate: 'fixture',
    status: 'UNKNOWN',
    reason: '<img src=x onerror=alert(1)>',
    source: 'generated',
    observedAt: null
  }];
  const result = await bridge(envelopeBytes(report)).read();
  const {root, document} = documentHarness();
  renderPaperCockpit(root, result.report, document, {now: NOW, staleAfterMs: 60_000});
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(visit(root).some(node => node.tagName === 'img'), false);
});

test('browser connector is one-shot, opt-in, bounded and reports unavailable sources', async () => {
  let calls = 0;
  const bytes = envelopeBytes(reportFixture());
  const connector = createPaperReportConnector({
    enabled: true,
    transport: async options => {
      calls += 1;
      assert.deepEqual(Object.keys(options), ['signal']);
      return response(bytes);
    },
    now: () => NOW
  });
  assert.equal(calls, 0);
  const result = await connector.read();
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(calls, 1);
  connector.dispose();

  const unavailable = createPaperReportConnector({
    enabled: true,
    transport: async () => response(new Uint8Array(), {status: 503, contentLength: '0'})
  });
  const missing = await unavailable.read();
  assert.equal(missing.status, 'UNAVAILABLE');
  assert.equal(missing.reason, 'SOURCE_HTTP_UNAVAILABLE');
  unavailable.dispose();
});

test('browser connector rejects a response that exceeds the byte bound', async () => {
  const connector = createPaperReportConnector({
    enabled: true,
    transport: async () => response(new Uint8Array(), {
      contentLength: String(MAX_PAPER_REPORT_BYTES + 1)
    })
  });
  const result = await connector.read();
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'OVERSIZED');
  connector.dispose();
});

test('all early response rejections cancel unread bodies, release locks, and abort source signals', async () => {
  const bytes = envelopeBytes(reportFixture());
  const cases = [
    {status: 503, statusResult: 'UNAVAILABLE', reason: 'SOURCE_HTTP_UNAVAILABLE'},
    {status: 401, statusResult: 'REJECTED', reason: 'AUTH_REQUIRED'},
    {contentType: 'text/plain', statusResult: 'REJECTED', reason: 'INVALID_CONTENT_TYPE'},
    {
      contentLength: String(MAX_PAPER_REPORT_BYTES + 1),
      statusResult: 'REJECTED',
      reason: 'OVERSIZED'
    }
  ];

  for (const options of cases) {
    let cancellations = 0;
    let signal;
    const body = response(bytes, {...options, onCancel: () => { cancellations += 1; }});
    const connector = createPaperReportConnector({
      enabled: true,
      transport: request => {
        signal = request.signal;
        return body;
      },
      now: () => NOW
    });
    const result = await connector.read();
    assert.equal(result.status, options.statusResult);
    assert.equal(result.reason, options.reason);
    assert.equal(cancellations, 1);
    assert.equal(body.body.locked, false);
    assert.equal(signal.aborted, true);
    connector.dispose();
  }
});

test('timeout aborts transport and an unresolved source cannot start concurrent work', async () => {
  let aborted = false;
  const connector = createPaperReportConnector({
    enabled: true,
    timeoutMs: 10,
    transport: ({signal}) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, {once: true});
    })
  });
  const timedOut = await connector.read();
  assert.equal(timedOut.status, 'TIMEOUT');
  assert.equal(aborted, true);
  connector.dispose();

  let release;
  let calls = 0;
  const bounded = createPaperReportBridge({
    enabled: true,
    timeoutMs: 10,
    now: () => NOW,
    readSource: () => {
      calls += 1;
      return new Promise(resolve => { release = resolve; });
    }
  });
  assert.equal((await bounded.read()).status, 'TIMEOUT');
  assert.equal((await bounded.read()).status, 'BUSY');
  assert.equal(calls, 1);
  bounded.dispose();
  release(envelopeBytes(reportFixture()));
});

test('timeout and disposal cancel pending streaming reads and release reader locks', async () => {
  for (const dispose of [false, true]) {
    let cancellations = 0;
    let body;
    const connector = createPaperReportConnector({
      enabled: true,
      timeoutMs: 15,
      transport: () => {
        body = response(new Uint8Array(), {
          stalled: true,
          onCancel: () => { cancellations += 1; }
        });
        return body;
      }
    });
    const pending = connector.read();
    for (let attempt = 0; attempt < 20 && !body?.body.locked; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(body.body.locked, true);
    if (dispose) connector.dispose();
    const result = await pending;
    assert.equal(result.status, dispose ? 'DISPOSED' : 'TIMEOUT');
    assert.equal(cancellations, 1);
    assert.equal(body.body.locked, false);
    if (!dispose) connector.dispose();
  }
});

test('a late transport response is cancelled and holds the single-flight lock until settled', async () => {
  let resolveLateResponse;
  let firstSignal;
  let calls = 0;
  let cancellations = 0;
  const bytes = envelopeBytes(reportFixture());
  const connector = createPaperReportConnector({
    enabled: true,
    timeoutMs: 10,
    transport: ({signal}) => {
      calls += 1;
      if (calls === 1) {
        firstSignal = signal;
        return new Promise(resolve => { resolveLateResponse = resolve; });
      }
      return Promise.resolve(response(bytes));
    },
    now: () => NOW
  });

  assert.equal((await connector.read()).status, 'TIMEOUT');
  assert.equal(firstSignal.aborted, true);
  assert.equal((await connector.read()).status, 'BUSY');
  const late = response(bytes, {
    status: 503,
    onCancel: () => { cancellations += 1; }
  });
  resolveLateResponse(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(late.body.locked, false);
  assert.equal((await connector.read()).status, 'AVAILABLE');
  assert.equal(calls, 2);
  connector.dispose();
});

test('a pending body cancellation keeps single-flight locked after timeout', async () => {
  let finishCancellation;
  let body;
  let calls = 0;
  const bytes = envelopeBytes(reportFixture());
  const connector = createPaperReportConnector({
    enabled: true,
    timeoutMs: 10,
    transport: () => {
      calls += 1;
      if (calls === 1) {
        body = response(bytes, {
          status: 503,
          onCancel: () => new Promise(resolve => { finishCancellation = resolve; })
        });
        return body;
      }
      return response(bytes);
    },
    now: () => NOW
  });
  assert.equal((await connector.read()).status, 'TIMEOUT');
  assert.equal(body.body.locked, false);
  assert.equal((await connector.read()).status, 'BUSY');
  assert.equal(calls, 1);
  finishCancellation();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await connector.read()).status, 'AVAILABLE');
  assert.equal(calls, 2);
  connector.dispose();
});

test('dispose aborts a pending browser request and returns a distinct state', async () => {
  let signal;
  const connector = createPaperReportConnector({
    enabled: true,
    transport: options => {
      signal = options.signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
      });
    }
  });
  const pending = connector.read();
  await new Promise(resolve => setImmediate(resolve));
  connector.dispose();
  assert.equal((await pending).status, 'DISPOSED');
  assert.equal(signal.aborted, true);
});

test('bridge remains bounded and the browser controller owns its fixed authenticated read', () => {
  const bridgeSource = readFileSync(new URL(
    '../scripts/memecoin-paper-report-bridge/index.mjs', import.meta.url
  ), 'utf8');
  const connectorSource = readFileSync(new URL('../v11/paper-report-connector.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../v11/strategy-workspace-bootstrap.js', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../v11/paper-cockpit-controller.js', import.meta.url), 'utf8');
  const gateway = readFileSync(new URL('../server-gateway.js', import.meta.url), 'utf8');

  assert.doesNotMatch(bridgeSource, /node:fs|createServer|\.listen\s*\(|\bfetch\s*\(|setInterval/);
  assert.doesNotMatch(connectorSource, /createServer|\.listen\s*\(|\bfetch\s*\(|setInterval/);
  assert.match(bootstrap, /paper-cockpit-controller/);
  assert.doesNotMatch(bootstrap, /createPaperReportConnector/);
  assert.match(controller, /\/api\/private\/paper-report/);
  assert.doesNotMatch(controller, /setInterval|localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(gateway, /paper-report/);
});
