import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PAPER_REPORT_ENVELOPE_SCHEMA} from '../scripts/memecoin-paper-report-bridge/index.mjs';
import {projectOperatorReport} from '../scripts/memecoin-paper/operator-report.mjs';
import {reportFixtures} from './fixtures/memecoin-paper-operator-report/scenarios.mjs';
import {
  mountPaperCockpit,
  PAPER_REPORT_ENDPOINT
} from '../v11/paper-cockpit-controller.js';
import {createPaperReportConnector} from '../v11/paper-report-connector.js';

const NOW = Date.parse('2026-11-01T20:00:00.000Z');
const TOKEN = 'existing-session-token';

class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.events = new Map();
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw Error('Paper cockpit must render text nodes'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
  }
  click() { for (const callback of this.events.get('click') || []) callback({target: this}); }
}

function harness({unlocked = true, token = TOKEN, fetchImpl, policy = {now: () => NOW, staleAfterMs: 60_000}} = {}) {
  const document = {createElement: tag => new Element(document, tag)};
  const root = new Element(document, 'section');
  const listeners = new Set();
  const readers = new Map();
  const windowListeners = new Map();
  let credential = token;
  let open = unlocked;
  const access = {
    getToken: () => credential,
    isUnlocked: () => open,
    lock() {
      credential = null;
      open = false;
      for (const clear of readers.keys()) clear();
      for (const listener of listeners) listener({status: 'locked'});
    },
    unlock(value = TOKEN) {
      credential = value;
      open = true;
      for (const listener of listeners) listener({status: 'unlocked'});
    },
    registerReader(clear, revalidate) {
      readers.set(clear, revalidate);
      return () => readers.delete(clear);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({status: open ? 'unlocked' : 'locked'});
      return () => listeners.delete(listener);
    }
  };
  const window = {
    addEventListener(name, listener) {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set());
      windowListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { windowListeners.get(name)?.delete(listener); },
    fire(name) { for (const listener of windowListeners.get(name) || []) listener(); }
  };
  const controller = mountPaperCockpit(root, document, window, {
    access,
    fetchImpl,
    freshnessPolicy: policy
  });
  const findButton = () => {
    const visit = element => [element, ...element.children.flatMap(visit)];
    return visit(root).find(element => element.tagName === 'BUTTON');
  };
  return {root, document, window, access, controller, findButton, policy};
}

function generatedReport({observedAt = NOW, partial = false} = {}) {
  const report = projectOperatorReport(reportFixtures.readOnlyCheckpoint());
  report.evidence.observedThrough = new Date(observedAt).toISOString();
  report.valuation.cashCents = '90071992547409931234';
  report.valuation.realizedNetPnlCents = '-12345678901234567890';
  if (partial) {
    report.evidence.coverage.discovery.sourceTruncated = true;
    report.evidence.coverage.discovery.unaccountedObservedRecords = 2;
  }
  return report;
}

function paperResponse(report, status = 200) {
  const body = JSON.stringify({
    schema: PAPER_REPORT_ENVELOPE_SCHEMA,
    runId: report.experiment.id,
    report
  });
  return new Response(body, {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'}
  });
}

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('condition did not settle');
}

test('one manual read uses the shared authenticated session and preserves generated report values', async () => {
  const report = generatedReport();
  let request;
  const h = harness({fetchImpl: async (url, options) => {
    request = {url, options};
    return paperResponse(report);
  }});
  h.controller.setActive(true);
  assert.equal(h.root.textContent.includes('No report has been requested'), true);
  assert.equal(h.findButton().textContent, 'Paper report manuell laden / aktualisieren');
  assert.equal(request, undefined, 'mount/navigation does not read');

  h.findButton().click();
  await until(() => h.root.textContent.includes('Observation-only'));
  assert.equal(request.url, PAPER_REPORT_ENDPOINT);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.authorization, 'Bearer ' + TOKEN);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  assert.equal(request.options.signal instanceof AbortSignal, true);
  assert.match(h.root.textContent, /Terminal report: (FINISHED|INCOMPLETE)/);
  assert.match(h.root.textContent, /not evidence of current worker liveness/);
  assert.match(h.root.textContent, /90071992547409931234 cents/);
  assert.match(h.root.textContent, /−12345678901234567890 cents/);
  assert.match(h.root.textContent, /Liveness: NOT EVIDENCED/);
  h.controller.dispose();
});

test('a shared display freshness policy classifies stale in both connector and cockpit', async () => {
  const h = harness({
    fetchImpl: async () => paperResponse(generatedReport({observedAt: NOW - 60_001})),
    policy: {now: () => NOW, staleAfterMs: 60_000}
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.match(h.root.textContent, /data|stale/i);
  assert.match(h.root.textContent, /stale under the shared display-only freshness policy/i);
  assert.match(h.root.textContent, /AktualitätSTALE/);
  h.controller.dispose();
});

test('partial, unknown, rejected, missing and future data remain distinct or unavailable', async () => {
  for (const [report, expectedState, expectedText] of [
    [generatedReport({partial: true}), 'partial', /partial evidence coverage/i],
    [generatedReport(), 'unknown', /status is unknown/i],
    [generatedReport({observedAt: NOW + 1}), 'rejected', /response was rejected/i]
  ]) {
    const h = harness({fetchImpl: async () => paperResponse(report)});
    h.controller.setActive(true);
    await h.controller.refresh();
    assert.equal(h.root.attrs['data-state'], expectedState);
    assert.match(h.root.textContent, expectedText);
    h.controller.dispose();
  }

  const rejected = harness({fetchImpl: async () => new Response('{', {status: 200,
    headers: {'content-type': 'application/json'}})});
  rejected.controller.setActive(true);
  await rejected.controller.refresh();
  assert.equal(rejected.root.attrs['data-state'], 'rejected');
  rejected.controller.dispose();

  const missing = harness({fetchImpl: async () => new Response('{}', {status: 404,
    headers: {'content-type': 'application/json'}})});
  missing.controller.setActive(true);
  await missing.controller.refresh();
  assert.equal(missing.root.attrs['data-state'], 'unavailable');
  assert.match(missing.root.textContent, /Keine Reportdaten verbunden/);
  missing.controller.dispose();
});

test('missing token synthesizes an auth-required response and the shared owner locks after 401/403', async () => {
  let calls = 0;
  const noToken = harness({token: null, unlocked: true, fetchImpl: async () => {
    calls++;
    return paperResponse(generatedReport());
  }});
  noToken.controller.setActive(true);
  await noToken.controller.refresh();
  assert.equal(calls, 0);
  assert.equal(noToken.access.isUnlocked(), false);
  assert.equal(noToken.root.attrs['data-state'], 'auth-required');
  noToken.controller.dispose();

  for (const status of [401, 403]) {
    const h = harness({fetchImpl: async () => new Response('{}', {status,
      headers: {'content-type': 'application/json'}})});
    h.controller.setActive(true);
    await h.controller.refresh();
    assert.equal(h.access.isUnlocked(), false);
    assert.equal(h.root.attrs['data-state'], 'auth-required');
    assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
    h.controller.dispose();
  }
});

test('late 401/403 responses cannot invalidate a disposed, relocked, or replacement session', async () => {
  for (const status of [401, 403]) {
    for (const lifecycle of ['dispose', 'lock-reunlock', 'new-session']) {
      let release;
      let bodyCancelled = false;
      const h = harness({fetchImpl: async () => new Promise(resolve => {
        release = () => resolve(new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('late unauthorized response'));
          },
          cancel() { bodyCancelled = true; }
        }), {status, headers: {'content-type': 'application/json'}}));
      })});
      h.controller.setActive(true);
      const pending = h.controller.refresh();
      await until(() => typeof release === 'function');

      const replacementToken = lifecycle === 'lock-reunlock' ? TOKEN : 'replacement-session-token';
      if (lifecycle === 'dispose') h.controller.dispose();
      else h.access.lock();
      h.access.unlock(replacementToken);
      await pending;
      release();
      await until(() => bodyCancelled);

      assert.equal(h.access.isUnlocked(), true, `${status} after ${lifecycle} leaves access unlocked`);
      assert.equal(h.access.getToken(), replacementToken, `${status} after ${lifecycle} preserves the current credential`);
      assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
      if (lifecycle !== 'dispose') h.controller.dispose();
    }
  }
});

test('lock, navigation, pagehide and disposal clear private DOM; late uncancellable reads cannot repaint or multiply', async () => {
  let release;
  let calls = 0;
  let signal;
  const report = generatedReport();
  const h = harness({fetchImpl: async (_url, options) => {
    calls++;
    signal = options.signal;
    if (calls === 1) return new Promise(resolve => { release = () => resolve(paperResponse(report)); });
    return paperResponse(report);
  }});
  h.controller.setActive(true);
  const first = h.controller.refresh();
  await until(() => typeof release === 'function');
  h.controller.setActive(false);
  assert.equal(signal.aborted, true);
  assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.equal(calls, 1, 'a pending uncancellable source is not replaced');
  release();
  await first;
  await tick();
  assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
  await h.controller.refresh();
  assert.equal(calls, 2, 'one fresh connector is allowed after the old source settles');
  assert.match(h.root.textContent, /Observation-only/);
  h.access.lock();
  assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
  h.access.unlock();
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.match(h.root.textContent, /Observation-only/);
  h.window.fire('pagehide');
  assert.equal(h.access.isUnlocked(), false);
  assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
  h.controller.dispose();
  assert.equal(h.root.children.length, 0);
});

test('connector keeps a disposed in-flight source visible as busy until its transport settles', async () => {
  let release;
  const connector = createPaperReportConnector({
    enabled: true,
    transport: () => new Promise(resolve => { release = resolve; })
  });
  const pending = connector.read();
  await tick();
  connector.dispose();
  assert.equal(connector.isDisposed(), true);
  assert.equal(connector.isBusy(), true);
  assert.equal((await pending).status, 'DISPOSED');
  assert.equal(connector.isBusy(), true);
  release(new Response(null, {status: 503}));
  await tick();
  assert.equal(connector.isBusy(), false);
});
