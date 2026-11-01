import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  createPaperCockpitAdapter,
  getDemoPaperCockpitReport,
  presentPaperCockpitReport
} from '../v11/paper-cockpit-model.js';
import {renderPaperCockpit} from '../v11/paper-cockpit-view.js';

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Paper cockpit must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
}

function harness() {
  const document = {createElement: tag => new Element(document, tag)};
  return {root: new Element(document, 'section'), document};
}

function report() {
  return {
    schema: 'MEMECOIN_PAPER_OPERATOR_REPORT_V1',
    experiment: {
      id: 'report-shaped-run-01',
      source: 'READ_ONLY_PAPER_CHECKPOINT',
      evidenceKind: 'READ_ONLY_PAPER_CHECKPOINT_RECEIPTS',
      sourceProvenance: 'CALLER_LABEL_ONLY_NOT_AUTHENTICATED',
      reportStatus: 'INCOMPLETE',
      sourceReadiness: 'NOT_READY',
      operationalStatus: 'NOT_EVIDENCED',
      startAt: '2026-11-01T10:00:00.000Z',
      endAt: null
    },
    evidence: {
      status: 'UNKNOWN',
      observedFrom: '2026-11-01T10:01:00.000Z',
      observedThrough: '2026-11-01T10:02:00.000Z',
      basis: 'source-reported sample/check timestamps; no wall-clock freshness recomputation',
      sources: [],
      coverage: {
        discovery: {
          observedRecords: null, scoutAuditRows: null, unaccountedObservedRecords: null,
          sourceTruncated: null, scoutAuditTruncated: null, exhaustive: null
        },
        audit: {
          present: true, observedRows: 1, truncated: false, totalRows: 1,
          replayLoggerTruncated: null, ledgerAuditTruncated: false,
          ledgerEventsReported: 1, ledgerEventsAudited: 1
        }
      }
    },
    candidates: {
      considered: null, accepted: null, rejected: null, unknown: null,
      audited: null, authorizationReceiptCount: 0, unaccountedObserved: null,
      discoveryTruncated: null, scoutAuditTruncated: null, basis: 'checkpoint receipts',
      details: [], detailsCoverage: {
        observedTotal: 0, total: null, displayed: 0, displayTruncated: false,
        sourceTruncated: null, unaccounted: null
      }
    },
    trading: {
      status: 'UNKNOWN', paperEntryFills: null, basis: 'fill evidence unavailable',
      noTradeReasons: [], noTradeReasonsCoverage: {
        observedTotal: 0, total: null, displayed: 0, displayTruncated: false,
        sourceTruncated: null, unaccounted: null
      }
    },
    controls: {
      stops: [], stopsCoverage: {
        observedTotal: 0, total: 0, displayed: 0, displayTruncated: false,
        sourceTruncated: false, unaccounted: 0
      },
      reservations: null, openPositionCount: null, openPositions: [],
      openPositionsCoverage: {
        observedTotal: 0, total: null, displayed: 0, displayTruncated: false,
        sourceTruncated: false, unaccounted: null
      }
    },
    valuation: {
      status: 'UNKNOWN', cashCents: null, realizedGrossPnlCents: null,
      realizedNetPnlCents: null, grossOpenValueCents: null,
      estimatedExitCostsCents: null, unrealizedGrossPnlCents: null,
      unrealizedNetPnlCents: null, unresolvedPositions: null,
      basis: 'run-end marks/accounting unavailable'
    },
    costs: {status: 'UNKNOWN', totalCents: null},
    unresolvedFills: [], unresolvedFillsCoverage: {
      observedTotal: 0, total: null, displayed: 0, displayTruncated: false,
      sourceTruncated: null, unaccounted: null
    },
    provenance: [], provenanceCoverage: {
      observedTotal: 0, total: null, displayed: 0, displayTruncated: false,
      sourceTruncated: null, unaccounted: null
    }
  };
}

const visit = element => [element, ...element.children.flatMap(visit)];

test('report-shaped read-only snapshot renders lifecycle, observation mode and unknown liveness', async () => {
  const snapshot = report();
  const original = JSON.stringify(snapshot);
  let reads = 0;
  const adapter = createPaperCockpitAdapter({
    readReport: async () => { reads += 1; return snapshot; }
  });
  const result = await adapter.read();
  assert.equal(result.available, true);
  assert.equal(reads, 1);
  const {root, document} = harness();
  assert.deepEqual(renderPaperCockpit(root, result.report, document), {status: 'REPORT_PRESENTED'});
  assert.equal(JSON.stringify(snapshot), original);
  assert.match(root.textContent, /Observation-only/);
  assert.match(root.textContent, /INCOMPLETE/);
  assert.match(root.textContent, /Liveness: NOT EVIDENCED/);
  assert.match(root.textContent, /Dauerhaftigkeit nicht belegt/);
  assert.match(root.textContent, /Observed through: 2026-11-01T10:02:00.000Z/);
  assert.doesNotMatch(root.textContent, /\bRUNNING\b|grün|active worker/i);
  assert.equal(visit(root).some(item => ['button', 'input', 'select', 'form'].includes(item.tagName)), false);
  assert.match(visit(root).find(item => item.className === 'limited').attrs.style,/white-space:normal/);
});

test('stale, partial and unknown evidence remain explicit and never become a running state', () => {
  const snapshot = report();
  snapshot.evidence.observedThrough = '2026-11-01T09:00:00.000Z';
  snapshot.evidence.coverage.discovery = {
    observedRecords: 100,
    scoutAuditRows: 5,
    unaccountedObservedRecords: 95,
    sourceTruncated: true,
    scoutAuditTruncated: false,
    exhaustive: false
  };
  snapshot.candidates.considered = 100;
  snapshot.candidates.accepted = 0;
  snapshot.candidates.rejected = 5;
  snapshot.candidates.unknown = 95;
  snapshot.candidates.audited = 5;
  snapshot.candidates.detailsCoverage = {
    observedTotal: 5, total: 100, displayed: 5, displayTruncated: false,
    sourceTruncated: true, unaccounted: 95
  };
  const {root, document} = harness();
  renderPaperCockpit(root, snapshot, document, {
    now: Date.parse('2026-11-01T10:00:00.000Z'),
    staleAfterMs: 60_000
  });
  assert.match(root.textContent, /AktualitätSTALE/);
  assert.match(root.textContent, /coverage: PARTIAL/);
  assert.match(root.textContent, /100 observed · 5 Scout rows · 95 unaccounted · source truncation yes/);
  assert.match(root.textContent, /Paper entry fill count: UNKNOWN/);
  assert.match(root.textContent, /Reported position count: UNKNOWN/);
  assert.match(root.textContent, /Realized net PnLUnavailable/);
  assert.doesNotMatch(root.textContent, /\bRUNNING\b/);

  const unknown = presentPaperCockpitReport(report());
  assert.equal(unknown.evidence.freshness.status, 'UNKNOWN');
  assert.equal(unknown.evidence.coverage, 'UNKNOWN');
  assert.equal(presentPaperCockpitReport(null).available, false);
});

test('generated sample is visibly synthetic and uses the same report DTO contract', () => {
  const demo = getDemoPaperCockpitReport();
  assert.equal(demo.schema, 'MEMECOIN_PAPER_OPERATOR_REPORT_V1');
  assert.equal(demo.experiment.evidenceKind, 'SYNTHETIC_FIXTURE');
  const {root, document} = harness();
  renderPaperCockpit(root, null, document);
  assert.match(root.textContent, /Keine Reportdaten verbunden/);
  assert.match(root.textContent, /Generated demo fixture · synthetic only/);
  assert.match(root.textContent, /Generated demonstration only; this is not a production run/);
  assert.match(root.textContent, /95 unaccounted/);
  assert.match(root.textContent, /Liveness: NOT EVIDENCED/);
});

test('known exact signed amounts preserve sign; absent or malformed amounts stay unavailable', () => {
  const snapshot = report();
  snapshot.valuation.cashCents = '1000000000000000000000001';
  snapshot.controls.reservations = 2;
  snapshot.valuation.realizedGrossPnlCents = '250';
  snapshot.valuation.realizedNetPnlCents = '-125';
  snapshot.valuation.unrealizedGrossPnlCents = '0';
  snapshot.valuation.unrealizedNetPnlCents = '12.5';
  const model = presentPaperCockpitReport(snapshot);
  assert.equal(model.valuation.cash.label, '1000000000000000000000001 cents');
  assert.equal(model.valuation.cash.tone, 'tone-muted');
  assert.equal(model.controls.reservations, 2);
  assert.equal(model.valuation.realizedGross.label, '+250 cents');
  assert.equal(model.valuation.realizedGross.tone, 'tone-safe');
  assert.equal(model.valuation.realizedNet.label, '−125 cents');
  assert.equal(model.valuation.realizedNet.tone, 'tone-danger');
  assert.equal(model.valuation.unrealizedGross.label, '0 cents');
  assert.equal(model.valuation.unrealizedNet.label, 'Unavailable');
  assert.equal(presentPaperCockpitReport(report()).valuation.cash.label, 'Unavailable');
});

test('zero fills and missing fill evidence are distinct; empty and absent position arrays differ', () => {
  const snapshot = report();
  snapshot.trading.paperEntryFills = 0;
  snapshot.controls.openPositionCount = 0;
  snapshot.controls.openPositions = [];
  const {root, document} = harness();
  renderPaperCockpit(root, snapshot, document);
  assert.match(root.textContent, /Paper entry fills evidenced: 0/);
  assert.match(root.textContent, /No rows reported/);
  assert.match(root.textContent, /Unresolved fillsNo rows reported/);

  const absent = report();
  absent.trading.paperEntryFills = null;
  delete absent.controls.openPositions;
  delete absent.unresolvedFills;
  const second = harness();
  renderPaperCockpit(second.root, absent, second.document);
  assert.match(second.root.textContent, /Paper entry fill count: UNKNOWN/);
  assert.match(second.root.textContent, /Position evidenceNicht verfügbar/);
  assert.match(second.root.textContent, /Unresolved fillsNicht verfügbar/);
  assert.doesNotMatch(second.root.textContent, /Paper entry fills evidenced: 0/);
});

test('strategy workspace mounts the read-only cockpit once above the existing readiness card', () => {
  const source = readFileSync(new URL('../v11/strategy-workspace-bootstrap.js', import.meta.url), 'utf8');
  assert.equal((source.match(/renderPaperCockpit\(paperRoot\)/g) || []).length, 1);
  assert.ok(source.indexOf("import {renderPaperCockpit}") < source.indexOf("import {renderPaperReadiness}"));
  assert.ok(source.indexOf('insertBefore(paperRoot,catalogRoot)') <
    source.indexOf('insertBefore(readinessRoot,catalogRoot)'));
  assert.equal((source.match(/\bfetch\s*\(/g) || []).length, 1, 'only the existing local strategy catalog fetch remains');
  assert.doesNotMatch(source, /\bsetInterval\s*\(|\bsetTimeout\s*\(/);
});

test('rendering remains text-only and has no implicit endpoint, polling, filesystem, or storage access', async () => {
  const {root, document} = harness();
  renderPaperCockpit(root, getDemoPaperCockpitReport(), document);
  assert.equal(visit(root).some(item => ['img', 'script', 'a', 'button'].includes(item.tagName)), false);
  const source = readFileSync(new URL('../v11/paper-cockpit-model.js', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../v11/paper-cockpit-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(`${source}\n${view}`, /\bfetch\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(|localStorage|sessionStorage|indexedDB|\.innerHTML\s*=/);
  assert.throws(() => createPaperCockpitAdapter({readReport: {}}), /read-only function/);
  const noSource = await createPaperCockpitAdapter().read();
  assert.deepEqual(noSource, {available: false, report: null});
  assert.deepEqual(renderPaperCockpit(root, {}, document), {status: 'UNAVAILABLE'});
});
