import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createSpotPaperHost8hAdapter,
  presentSpotPaperHost8h,
  SPOT_PAPER_HOST8H_INPUT_SCHEMA,
  SPOT_PAPER_HOST8H_MAX_INPUT_BYTES
} from '../v11/spot-paper-host8h-model.js';
import {
  createSpotPaperHost8hPreview,
  renderSpotPaperHost8h
} from '../v11/spot-paper-host8h-view.js';

const NOW = Date.parse('2026-11-08T14:00:00.000Z');
const identity = {
  runId: 'btc-eur-paper-host-8h-001',
  profileId: 'BTC_EUR_PAPER_HOST_8H_V1',
  sourceSha: '1e0204c8ac2c611940bdebbf61ae396a0282eb7d31cc52be7e51ef4036a961fd',
  model: 'BTC_EUR_SMA5_SMA20_V1',
  pair: 'BTC/EUR',
  currency: 'EUR',
  leverage: 1,
  positionMode: 'LONG_ONLY'
};

function input(status = 'RUNNING_OBSERVED') {
  return {
    schemaVersion: SPOT_PAPER_HOST8H_INPUT_SCHEMA,
    source: 'Injected offline fixture',
    observedAt: '2026-11-08T13:59:00.000Z',
    identity: {...identity},
    snapshot: {status, verifiedTerminal: status === 'VERIFIED_TERMINAL', runId: identity.runId}
  };
}

function assessment(overrides = {}) {
  return {
    schemaVersion: 'SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1',
    outcome: 'COMPLETED',
    assessment: {
      runId: identity.runId,
      profileId: identity.profileId,
      sourceSha: identity.sourceSha,
      terminalVerified: true,
      boundedTermination: true,
      outcome: 'COMPLETED',
      elapsedMs: 12_300_000,
      durationCoverage: 12_300_000 / 28_800_000,
      durationStatus: 'PARTIAL_BOUNDED_DURATION',
      cycleCount: 205,
      cycleCoverage: 205 / 480,
      acceptedObservationCoverage: 198 / 205,
      acceptedObservations: 198,
      observations: 198,
      dataGaps: 7,
      requests: 410,
      feesCents: 125,
      cashCents: 98250,
      equityCents: 99775,
      realizedPnlCents: -75,
      unrealizedPnlCents: 50,
      position: {quantitySat: '123456789'},
      positionStatus: 'OPEN_UNRESOLVED_AT_TERMINAL',
      ...overrides
    }
  };
}

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Host8h panel must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}

function harness() {
  const document = {createElement: tag => new Element(document, tag)};
  const root = new Element(document, 'section');
  return {root, document};
}

test('contradictory terminal evidence cannot display completed or verified metrics', () => {
  const mutations = [
    value => { value.assessment.assessment.outcome = 'FAILED'; },
    value => { value.assessment.outcome = 'FAILED'; },
    value => { value.sourceEvidence = {assessmentOutcome: 'FAILED'}; },
    ...[null, 'true', 1, undefined].map(boundedTermination => value => {
      value.assessment.assessment.boundedTermination = boundedTermination;
    })
  ];
  for (const mutate of mutations) {
    const value = input('VERIFIED_TERMINAL');
    value.assessment = assessment();
    mutate(value);
    const model = presentSpotPaperHost8h(value, {now: NOW, staleAfterMs: 60_000});
    assert.equal(model.completed, false);
    assert.notEqual(model.statusTone, 'tone-safe');
    assert.equal(model.metrics, null);
    const {root, document} = harness();
    renderSpotPaperHost8h(root, value, document, {now: NOW, staleAfterMs: 60_000});
    assert.doesNotMatch(root.textContent, /Abgeschlossen · Assessment verifiziert/);
  }
  for (const outcome of ['FAILED', 'UNKNOWN']) {
    const value = input('VERIFIED_TERMINAL');
    value.assessment = assessment({outcome});
    value.assessment.outcome = outcome;
    value.sourceEvidence = {assessmentOutcome: outcome};
    const model = presentSpotPaperHost8h(value, {now: NOW, staleAfterMs: 60_000});
    assert.equal(model.completed, false);
    assert.equal(model.assessmentOutcome, outcome);
    assert.equal(model.status, outcome === 'FAILED' ? 'FAILED' : 'VERIFIED_TERMINAL');
    assert.ok(model.metrics);
  }
});

test('running host observation is not a terminal report or completed result', () => {
  const model = presentSpotPaperHost8h(input(), {now: NOW, staleAfterMs: 60_000});
  assert.equal(model.status, 'RUNNING_OBSERVED');
  assert.equal(model.authenticated, false);
  assert.equal(model.metrics, null);
  assert.equal(model.completed, false);
  const {root, document} = harness();
  renderSpotPaperHost8h(root, input(), document, {now: NOW, staleAfterMs: 60_000});
  assert.match(root.textContent, /Laufender Prozess beobachtet/);
  assert.match(root.textContent, /nicht unabhängig authentifiziert/);
  assert.doesNotMatch(root.textContent, /Abgeschlossen ·|0,00 €|100 %/);
});

test('verified terminal assessment presents only actual partial metrics with clear units', () => {
  const snapshot = input('VERIFIED_TERMINAL');
  snapshot.source = 'host status + offline assessment input';
  snapshot.snapshot.report = {runId: identity.runId, stopReason: 'CYCLE_LIMIT'};
  snapshot.assessment = assessment();
  const {root, document} = harness();
  renderSpotPaperHost8h(root, snapshot, document, {now: NOW, staleAfterMs: 120_000});
  assert.match(root.textContent, /Abgeschlossen · Assessment verifiziert/);
  assert.match(root.textContent, /3 Std\. 25 Min\. von 8 Std\./);
  assert.match(root.textContent, /42,71 %/);
  assert.match(root.textContent, /Zyklusabdeckung42,71 %/);
  assert.match(root.textContent, /Akzeptierte Beobachtungsabdeckung96,59 %/);
  assert.match(root.textContent, /Zyklen205/);
  assert.match(root.textContent, /Datenlücken7/);
  assert.match(root.textContent, /Gebuchte Modellgebühren1,25 €/);
  assert.match(root.textContent, /Realisierter Gewinn\/Verlust−0,75 €/);
  assert.match(root.textContent, /Unrealisierter Gewinn\/Verlust\+0,50 €/);
  assert.match(root.textContent, /Offene PositionAm Laufende noch offen/);
  assert.match(root.textContent, /123456789 sat/);
  assert.match(root.textContent, /BTC_EUR_PAPER_HOST_8H_V1/);
  const visit = element => [element, ...element.children.flatMap(visit)];
  assert.equal(visit(root).find(item => item.textContent === '−0,75 €').className,
    'tone-danger');
  assert.equal(visit(root).find(item => item.textContent === '+0,50 €').className,
    'tone-safe');
});

test('unverified, failed, disabled, stale, and incomplete snapshots stay non-green', () => {
  const incomplete = presentSpotPaperHost8h(input('INCOMPLETE_UNKNOWN'));
  assert.equal(incomplete.status, 'INCOMPLETE_UNKNOWN');
  assert.equal(incomplete.metrics, null);
  const failedInput = input('INCOMPLETE_UNKNOWN');
  failedInput.assessment = {outcome: 'FAILED'};
  const failedModel = presentSpotPaperHost8h(failedInput);
  assert.equal(failedModel.status, 'FAILED');
  assert.equal(failedModel.statusTone, 'tone-danger');
  assert.equal(presentSpotPaperHost8h(input('DISABLED')).status, 'UNAVAILABLE');

  const stale = input();
  stale.observedAt = '2026-11-08T13:00:00.000Z';
  const staleModel = presentSpotPaperHost8h(stale, {now: NOW, staleAfterMs: 60_000});
  assert.equal(staleModel.status, 'STALE');
  assert.equal(staleModel.hostStatus, 'RUNNING_OBSERVED');
  assert.equal(staleModel.freshness.status, 'STALE');
  const staleTerminal = input('VERIFIED_TERMINAL');
  staleTerminal.observedAt = stale.observedAt;
  staleTerminal.assessment = assessment();
  const staleTerminalModel = presentSpotPaperHost8h(staleTerminal, {
    now: NOW, staleAfterMs: 60_000
  });
  assert.equal(staleTerminalModel.completed, true);
  assert.equal(staleTerminalModel.statusTone, 'tone-muted');

  const {root, document} = harness();
  renderSpotPaperHost8h(root, input('INCOMPLETE_UNKNOWN'), document);
  assert.match(root.textContent, /kein Abschlussnachweis/);
  assert.doesNotMatch(root.textContent, /Abgeschlossen ·|100 %|0,00 €/);
});

test('identity mismatch, wrong profile, malformed and oversized snapshots are unavailable', () => {
  const wrongRun = input();
  wrongRun.identity.runId = 'other-run';
  assert.equal(presentSpotPaperHost8h(wrongRun).status, 'IDENTITY_MISMATCH');
  const wrongProfile = input();
  wrongProfile.identity.profileId = 'BTC_EUR_PAPER_4H_V1';
  assert.equal(presentSpotPaperHost8h(wrongProfile).status, 'IDENTITY_MISMATCH');
  const wrongReport = input('VERIFIED_TERMINAL');
  wrongReport.snapshot.report = {runId: 'other-run'};
  assert.equal(presentSpotPaperHost8h(wrongReport).status, 'IDENTITY_MISMATCH');
  assert.equal(presentSpotPaperHost8h({schemaVersion: 'BTC_EUR_SPOT_PAPER_DASHBOARD_V1'})
    .status, 'UNAVAILABLE', 'legacy terminal DTOs are not host snapshots');
  assert.equal(presentSpotPaperHost8h(null).status, 'UNAVAILABLE');
  const oversized = input();
  oversized.padding = 'x'.repeat(SPOT_PAPER_HOST8H_MAX_INPUT_BYTES);
  assert.equal(presentSpotPaperHost8h(oversized).status, 'UNAVAILABLE');
  const cyclic = input();
  cyclic.loop = cyclic;
  assert.equal(presentSpotPaperHost8h(cyclic).status, 'UNAVAILABLE');
});

test('verified summary requires a matching terminal assessment; missing values stay unknown', () => {
  const snapshot = input('VERIFIED_TERMINAL');
  snapshot.assessment = assessment({
    terminalVerified: false,
    feesCents: null,
    cycleCount: null
  });
  const model = presentSpotPaperHost8h(snapshot);
  assert.equal(model.status, 'VERIFIED_TERMINAL');
  assert.equal(model.metrics, null);

  snapshot.assessment = assessment({feesCents: null, cycleCount: null});
  const missing = presentSpotPaperHost8h(snapshot);
  assert.equal(missing.metrics.fees, null);
  assert.equal(missing.metrics.cycleCount, null);
  assert.equal(missing.completed, true);

  snapshot.assessment = assessment({cycleCount: 481, elapsedMs: 28_806_000});
  const overLimit = presentSpotPaperHost8h(snapshot);
  assert.equal(overLimit.metrics.cycleCount, null);
  assert.equal(overLimit.metrics.elapsedMs, null);
});

test('injected preview has no default live data and rejects out-of-order observations', async () => {
  const empty = createSpotPaperHost8hPreview();
  const firstView = harness();
  const emptyResult = await empty.render(firstView.root, firstView.document);
  assert.equal(emptyResult.status, 'UNAVAILABLE');
  assert.match(firstView.root.textContent, /Offline-Vorschau · keine Laufdaten/);

  const snapshots = [input(), {
    ...input(), observedAt: '2026-11-08T13:58:00.000Z'
  }];
  const preview = createSpotPaperHost8hPreview({
    readSnapshot: async () => snapshots.shift()
  });
  const {root, document} = harness();
  await preview.render(root, document, {now: NOW, staleAfterMs: 60_000});
  const second = await preview.render(root, document, {now: NOW, staleAfterMs: 60_000});
  assert.equal(second.status, 'OUT_OF_ORDER');
  assert.match(root.textContent, /Älterer Snapshot verworfen/);
  assert.doesNotMatch(root.textContent, /Abgeschlossen ·|100 %/);
});

test('adapter read failure is unavailable and future timestamps have unknown freshness', async () => {
  const failed = await createSpotPaperHost8hAdapter({
    readSnapshot: async () => { throw new Error('offline'); }
  }).read({now: NOW, staleAfterMs: 60_000});
  assert.equal(failed.status, 'UNAVAILABLE');
  const future = input();
  future.observedAt = '2026-11-08T14:01:00.000Z';
  assert.equal(presentSpotPaperHost8h(future, {
    now: NOW, staleAfterMs: 60_000
  }).freshness.status, 'UNKNOWN');
  assert.equal(presentSpotPaperHost8h(input(), {
    previousObservedAt: '2026-11-08T14:00:00.000Z'
  }).freshness.status, 'OUT_OF_ORDER');
});
