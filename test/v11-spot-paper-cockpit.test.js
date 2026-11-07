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

test('spot-paper cockpit renders a completed snapshot without implying a running worker', () => {
  const report = dto();
  const {root, document} = harness();
  renderSpotPaperCockpit(root, envelope(report).report, document, {
    now: NOW, staleAfterMs: 60_000
  });
  assert.match(root.textContent, /BTC\/EUR Paper – echte Marktdaten, simulierte Trades/);
  assert.match(root.textContent, /2026-11-07T18:16:08.581Z/);
  assert.match(root.textContent, /Starting balance100000 cents/);
  assert.match(root.textContent, /Cash89643 cents/);
  assert.match(root.textContent, /Realized PnL−357 cents/);
  assert.match(root.textContent, /BUY count4/);
  assert.match(root.textContent, /SELL count3/);
  assert.match(root.textContent, /OPEN_UNRESOLVED_AT_TERMINAL/);
  assert.match(root.textContent, /146122 sat/);
  assert.match(root.textContent, /3542902 ms of 3600000 ms/);
  assert.match(root.textContent, /0 data gaps/);
  assert.match(root.textContent, /assessment signal replay NOT_PERFORMED · separate replay PASS/);
  assert.doesNotMatch(root.textContent, /\bRUNNING\b/);
  const visit = element => [element, ...element.children.flatMap(visit)];
  const pnl = visit(root).find(item => item.textContent === '−357 cents');
  assert.equal(pnl.className, 'tone-danger');
});

test('spot-paper cockpit keeps missing values unknown, stale separate, and preview explicitly offline', async () => {
  const report = dto();
  report.cashCents = null;
  const h = harness({
    fetchImpl: async () => new Response(JSON.stringify(envelope(report)), {
      status: 200, headers: {'content-type': 'application/json'}
    })
  });
  assert.match(h.root.textContent, /Fixture preview · keine verbundenen Live-Daten/);
  assert.match(h.root.textContent, /kein freigegebener, übertragener Terminalreport/);
  h.controller.setActive(true);
  assert.equal(h.root.attrs['data-state'], 'ready');
  assert.equal(h.find('button').hidden, false);
  assert.equal(h.find('button').textContent, 'BTC/EUR Paper manuell laden / aktualisieren');
  assert.equal(h.root.textContent.includes('89643 cents'), false);
  h.find('button').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.root.attrs['data-state'], 'stale');
  assert.match(h.root.textContent, /CashUNKNOWN · missing is not zero/);
  assert.match(h.root.textContent, /AktualitätSTALE/);
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
  assert.match(h.root.textContent, /response was rejected/);
  assert.doesNotMatch(h.root.textContent, /99525 cents|−357 cents/);
  h.controller.dispose();
});
