import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {mountPaperBotReportWorkspace} from '../v11/paper-bot-report-bootstrap.js';
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
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

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

function harness({fetchImpl = async () => new Response(null, {status: 404})} = {}) {
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
    fetchImpl
  });
  return {access, document, overviewRoot, pairedRoot, workspace};
}

test('workspace requires unlock and explicit refresh; lock clears read DTO and unmount cleans controls', async () => {
  let calls = 0;
  let options;
  const report = syntheticDto();
  const h = harness({
    fetchImpl: async (url, init) => {
      calls++;
      options = {url, ...init};
      return new Response(JSON.stringify({
        schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
        runId: report.identity.runId,
        report
      }), {status: 200, headers: {'content-type': 'application/json'}});
    }
  });
  h.workspace.setActive(true);
  assert.equal((await h.workspace.refresh()), undefined);
  assert.equal(calls, 0, 'locked access does not dispatch a report read');
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.match(h.overviewRoot.textContent, /In Vorbereitung/);
  assert.match(h.pairedRoot.textContent, /Noch kein Bericht geladen/);

  h.access.unlock();
  assert.equal(calls, 0, 'unlock alone does not dispatch a report read');
  await h.workspace.refresh();
  assert.equal(calls, 1);
  assert.equal(options.url, SPOT_PAPER_REPORT_ENDPOINT);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.match(h.overviewRoot.textContent, /BTC_EUR_SMA5_SMA20_V1/);
  assert.match(h.overviewRoot.parentNode.textContent,
    /belegt aber nicht die 5-Minuten-Trend-Identität/);
  assert.doesNotMatch(h.overviewRoot.textContent, /−3,57 €|995,25 €/);
  assert.match(h.overviewRoot.textContent, new RegExp(TARGET_MODEL),
    'the overview retains the intended trend-model identity');
  assert.match(h.overviewRoot.parentNode.textContent, /empfangen: Modell BTC_EUR_SMA5_SMA20_V1/,
    'the legacy DTO identity is shown only as mismatch detail');

  h.access.lock();
  assert.doesNotMatch(h.overviewRoot.textContent, /BTC_EUR_SMA5_SMA20_V1/);
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.equal(calls, 1);
  h.workspace.dispose();
  assert.equal(h.overviewRoot.children.length, 0);
  assert.equal(h.pairedRoot.children.length, 0);
});

test('paired DTO is read through the real workspace mount and remains visibly synthetic in tests', async () => {
  const expected = syntheticExpectedPairedIdentity();
  const report = syntheticPairedDashboard(expected);
  let calls = 0;
  let options;
  const h = harness({
    fetchImpl: async (url, init) => {
      calls++;
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
  assert.equal(calls, 0, 'unlock and mount do not read paired data');
  await h.workspace.refreshPaired();
  assert.equal(calls, 1);
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.match(h.pairedRoot.textContent, /SYNTHETIC FIXTURE/);
  assert.match(h.pairedRoot.textContent, /BTC_EUR_RESEARCH_TEST_V1/);
  assert.match(h.pairedRoot.textContent, /RUNNING_SNAPSHOT/);
  assert.match(h.pairedRoot.parentNode.textContent, /Gepaarter Bericht geladen/);
  assert.match(h.pairedRoot.textContent, /Eigenkapital nettoUnbekannt/);
  assert.match(h.pairedRoot.textContent, /Netto-PnLUnbekannt/);

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
  await unauthorized.workspace.refreshPaired();
  assert.equal(unauthorized.access.isUnlocked(), false);
  assert.match(unauthorized.pairedRoot.parentNode.textContent, /Gesperrt/);
  assert.doesNotMatch(unauthorized.pairedRoot.textContent, /SYNTHETIC FIXTURE/);
  unauthorized.workspace.dispose();
});

test('missing paired source and unavailable bot report remain explicit, with no background reads', async () => {
  let calls = 0;
  const h = harness({fetchImpl: async () => {
    calls++;
    return new Response(null, {status: 404});
  }});
  h.workspace.setActive(true);
  h.access.unlock();
  assert.equal(calls, 0);
  await h.workspace.refresh();
  assert.equal(calls, 1);
  assert.match(h.overviewRoot.parentNode.textContent, /Kein authentifizierter Bericht verfügbar/);
  assert.match(h.overviewRoot.textContent, /Unbekannt/);
  assert.match(h.overviewRoot.textContent, /In Vorbereitung/);
  assert.match(h.pairedRoot.textContent, /Noch kein Bericht geladen/);
  assert.match(h.pairedRoot.parentNode.textContent, /Kein gepaarter Bericht abgerufen/);
  h.workspace.setActive(false);
  h.workspace.setActive(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1, 'navigation does not create a duplicate reader or implicit request');
  h.workspace.dispose();
});

test('M11 strategy bootstrap mounts both reviewed panels under existing navigation and owns the only click path', () => {
  const source = readFileSync(new URL('../v11/strategy-workspace-bootstrap.js', import.meta.url), 'utf8');
  assert.match(source, /mountPaperBotReportWorkspace/);
  assert.match(source, /paper-bot-overview-section/);
  assert.match(source, /paired-paper-report-section/);
  assert.match(source, /Run-, Quellen-, Profil-, Fingerabdruck- und Host-Identität bleiben unbekannt/);
  assert.match(source, /paperBotReportWorkspace\?\.setActive\(button\.dataset\.v==='strategies'\)/);
  assert.equal((source.match(/addEventListener\(['"]click['"]/g) || []).length, 2,
    'one nav and one strategy shortcut listener remain; no report polling listener is added');
  assert.doesNotMatch(source, /\bsetInterval\s*\(|\bsetTimeout\s*\(/);
});
