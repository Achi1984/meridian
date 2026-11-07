import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderSpotPaperCockpit} from '../v11/spot-paper-cockpit-view.js';
import {
  mountSpotPaperCockpit,
  SPOT_PAPER_REPORT_ENDPOINT
} from '../v11/spot-paper-cockpit-controller.js';
import {getAcceptedSpotPaperIdentity, SPOT_PAPER_REPORT_ENVELOPE_SCHEMA} from
  '../scripts/spot-paper-report-bridge/contract.mjs';

const TOKEN = 'spot-paper-session-token';
const NOW = Date.parse('2026-11-07T19:00:00.000Z');
const identity = getAcceptedSpotPaperIdentity();

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
  set innerHTML(_) { throw Error('Spot-paper cockpit must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  click() { this.onclick?.({target: this}); }
}

function dto() {
  return {
    schemaVersion: 'BTC_EUR_SPOT_PAPER_DASHBOARD_V1',
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
      elapsedMs: 3_542_902,
      requestedMs: 3_600_000,
      coverage: 3_542_902 / 3_600_000,
      status: 'PARTIAL_BOUNDED_DURATION'
    },
    coverage: {observations: 60, acceptedObservations: 60, dataGaps: 0, requests: 120},
    verification: {
      terminalReadback: 'PASS',
      assessment: 'COMPLETED',
      assessmentSignalReplay: 'NOT_PERFORMED',
      signalReplay: 'PASS',
      profitability: 'NOT_ASSESSED'
    }
  };
}

function harness({fetchImpl = async () => new Response(null, {status: 503}), unlocked = true} = {}) {
  const document = {createElement: tag => new Element(document, tag)};
  const root = new Element(document, 'section');
  const subscribers = new Set();
  const readers = new Map();
  const windowListeners = new Map();
  let token = unlocked ? TOKEN : null;
  const access = {
    getToken: () => token,
    isUnlocked: () => token !== null,
    lock() {
      token = null;
      for (const clear of readers.keys()) clear();
      for (const listener of subscribers) listener({status: 'locked'});
    },
    registerReader(clear, revalidate) {
      readers.set(clear, revalidate);
      return () => readers.delete(clear);
    },
    subscribe(listener) {
      subscribers.add(listener);
      listener({status: token ? 'unlocked' : 'locked'});
      return () => subscribers.delete(listener);
    }
  };
  const window = {
    addEventListener(name, listener) {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set());
      windowListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { windowListeners.get(name)?.delete(listener); }
  };
  const controller = mountSpotPaperCockpit(root, document, window, {
    access,
    fetchImpl,
    freshnessPolicy: {now: () => NOW, staleAfterMs: 60_000}
  });
  const visit = element => [element, ...element.children.flatMap(visit)];
  return {
    root, document, access, controller,
    find(tag) { return visit(root).find(item => item.tagName.toLowerCase() === tag); },
    setToken(value) {
      token = value;
      for (const listener of subscribers) listener({status: value ? 'unlocked' : 'locked'});
    }
  };
}

const envelope = report => ({
  schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
  runId: identity.runId,
  report
});

test('spot-paper cockpit renders an exact EUR completed snapshot with technical details collapsed', () => {
  const report = dto();
  report.unrealizedPnlCents = '99525';
  const {root, document} = harness();
  renderSpotPaperCockpit(root, envelope(report).report, document, {
    now: NOW, staleAfterMs: 60_000
  });
  assert.match(root.textContent, /BTC\/EUR Paper – echte Marktdaten, simulierte Trades/);
  assert.match(root.textContent, /07\.11\.2026, 18:16:08 UTC/);
  assert.match(root.textContent, /Startguthaben1\.000,00 €/);
  assert.match(root.textContent, /Eigenkapital995,25 €/);
  assert.match(root.textContent, /Realisierter Gewinn\/Verlust−3,57 €/);
  assert.match(root.textContent, /Unrealisierter Gewinn\/Verlust\+995,25 €/);
  assert.match(root.textContent, /Käufe4/);
  assert.match(root.textContent, /Verkäufe3/);
  assert.match(root.textContent, /Offen, am Ende ungelöst/);
  assert.match(root.textContent, /146122 sat/);
  assert.match(root.textContent, /59 Min\. 2 Sek\. 902 ms von 1 Std\. \(98,41 %; teilweise\)/);
  assert.match(root.textContent, /0 Datenlücken/);
  assert.doesNotMatch(root.textContent, /\bRUNNING\b/);
  const visit = element => [element, ...element.children.flatMap(visit)];
  const pnl = visit(root).find(item => item.textContent === '−3,57 €');
  assert.equal(pnl.className, 'tone-danger');
  const positivePnl = visit(root).find(item => item.textContent === '+995,25 €');
  assert.equal(positivePnl.className, 'tone-safe');
  const reportRoot = visit(root).find(item => item.tagName === 'DIV' &&
    item.children.some(child => child.className?.includes('spot-paper-technical-details')));
  const technical = visit(root).find(item => item.className?.includes('spot-paper-technical-details'));
  assert.ok(technical);
  assert.equal(technical.open, undefined);
  assert.doesNotMatch(reportRoot.children.slice(0, -1).map(item => item.textContent).join(' '),
    /81edf0|ddae14|NOT_PERFORMED|NOT_ASSESSED|COMPLETED_BOUNDED|42395522899/);
  assert.match(technical.textContent, /Assessment-Signal-Replay NOT_PERFORMED · separater Replay PASS/);
  assert.match(technical.textContent, /81edf0b5dc3d455c2c1e1906791d56c731bea0c9/);
});

test('spot-paper EUR formatting preserves integer cents beyond Number precision', () => {
  const report = dto();
  report.cashCents = '90071992547409931234';
  const {root, document} = harness();
  renderSpotPaperCockpit(root, report, document);
  assert.match(root.textContent, /Bargeld900\.719\.925\.474\.099\.312,34 €/);
});

test('spot-paper cockpit keeps missing values unknown, stale separate, and preview explicitly offline', async () => {
  const report = dto();
  report.cashCents = null;
  const h = harness({
    fetchImpl: async () => new Response(JSON.stringify(envelope(report)), {
      status: 200, headers: {'content-type': 'application/json'}
    })
  });
  assert.match(h.root.textContent, /Offline-Vorschau · keine Reportdaten/);
  assert.match(h.root.textContent, /nicht mit einem Paper-Run verbunden/);
  h.controller.setActive(true);
  assert.equal(h.root.attrs['data-state'], 'ready');
  assert.equal(h.find('button').hidden, false);
  assert.equal(h.find('button').textContent, 'BTC/EUR Paper manuell laden / aktualisieren');
  assert.equal(h.root.textContent.includes('89643 cents'), false);
  h.find('button').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.root.attrs['data-state'], 'stale');
  assert.match(h.root.textContent, /BargeldUnbekannt/);
  assert.match(h.root.textContent, /AktualitätVeraltet/);
  const visit = element => [element, ...element.children.flatMap(visit)];
  const fixture = visit(h.root).find(item => item.className?.includes('spot-paper-fixture'));
  assert.equal(fixture.hidden, true, 'a connected report removes the disconnected preview notice');
  h.controller.dispose();
});

test('spot-paper cockpit performs no unauthorized read and lock/disposal abort active reads', async () => {
  let calls = 0;
  let observedSignal;
  let release;
  const h = harness({
    fetchImpl: (_url, options) => {
      calls++;
      observedSignal = options.signal;
      return new Promise(resolve => { release = resolve; });
    }
  });
  h.controller.setActive(true);
  h.setToken(null);
  await h.controller.refresh();
  assert.equal(calls, 0);
  assert.equal(h.root.attrs['data-state'], 'auth-required');
  h.setToken(TOKEN);
  const pending = h.controller.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(observedSignal.aborted, false);
  h.access.lock();
  await pending;
  assert.equal(observedSignal.aborted, true);
  assert.doesNotMatch(h.root.textContent, /spot-paper-42395522899-1|−357 cents/);
  release?.(new Response(null, {status: 503}));
  h.controller.dispose();

  let disposalSignal;
  const disposed = harness({
    fetchImpl: (_url, options) => {
      disposalSignal = options.signal;
      return new Promise(() => {});
    }
  });
  disposed.controller.setActive(true);
  const disposalRead = disposed.controller.refresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  disposed.controller.dispose();
  await disposalRead;
  assert.equal(disposalSignal.aborted, true);
  assert.equal(disposed.root.children.length, 0);
  assert.equal(SPOT_PAPER_REPORT_ENDPOINT.endsWith('/api/private/spot-paper-report'), true);
});

test('spot-paper cockpit rejects a mismatched report identity without presenting values', async () => {
  const report = dto();
  report.identity.workflowSha = 'a'.repeat(40);
  const h = harness({
    fetchImpl: async () => new Response(JSON.stringify(envelope(report)), {
      status: 200, headers: {'content-type': 'application/json'}
    })
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.equal(h.root.attrs['data-state'], 'rejected');
  assert.match(h.root.textContent, /Antwort wurde abgelehnt/);
  assert.doesNotMatch(h.root.textContent, /995,25 €|−3,57 €/);
  h.controller.dispose();
});

test('spot-paper cockpit distinguishes unavailable HTTP 503 from a rejected malformed 200', async () => {
  for (const [response, expectedState, expectedMessage] of [
    [new Response(null, {status: 503}), 'unavailable', /Kein freigegebener BTC\/EUR-Bericht verfügbar/],
    [new Response('{invalid', {status: 200, headers: {'content-type': 'application/json'}}),
      'rejected', /Antwort wurde abgelehnt/]
  ]) {
    const h = harness({fetchImpl: async () => response});
    h.controller.setActive(true);
    await h.controller.refresh();
    assert.equal(h.root.attrs['data-state'], expectedState);
    assert.match(h.root.textContent, expectedMessage);
    h.controller.dispose();
  }
});

test('spot-paper fresh terminal reports receive the completed-snapshot message', async () => {
  const fresh = dto();
  fresh.snapshot.completedAt = new Date(NOW - 1_000).toISOString();
  const h = harness({
    fetchImpl: async () => new Response(JSON.stringify(envelope(fresh)), {
      status: 200, headers: {'content-type': 'application/json'}
    })
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.equal(h.root.attrs['data-state'], 'terminal');
  assert.match(h.root.textContent, /Abgeschlossener BTC\/EUR-Paper-Snapshot/);
  assert.doesNotMatch(h.root.textContent, /UNKNOWN fallback|kein freigegebener.*Report verbunden/);
  h.controller.dispose();
});
