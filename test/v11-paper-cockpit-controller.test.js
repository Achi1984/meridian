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
  focus() { this.ownerDocument.activeElement = this; }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
  }
  click() { for (const callback of this.events.get('click') || []) callback({target: this}); }
}

function harness({
  unlocked = true,
  token = TOKEN,
  fetchImpl,
  policy = {now: () => NOW, staleAfterMs: 60_000},
  schedule,
  cancelSchedule
} = {}) {
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
    freshnessPolicy: policy,
    schedule,
    cancelSchedule
  });
  const findButton = () => {
    const visit = element => [element, ...element.children.flatMap(visit)];
    return visit(root).find(element => element.tagName === 'BUTTON');
  };
  return {
    root, document, window, access, controller, findButton, policy,
    revalidate() { for (const revalidate of readers.values()) revalidate(); }
  };
}

function fakeScheduler(now) {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, {callback, due: now() + delay, delay});
      return id;
    },
    cancelSchedule(id) { timers.delete(id); },
    runDue() {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= now())
        .sort((left, right) => left[1].due - right[1].due);
      for (const [id, timer] of due) {
        if (!timers.delete(id)) continue;
        timer.callback();
      }
    }
  };
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

test('same-turn refresh calls retain the active request and its successful result', async () => {
  let calls = 0;
  let release;
  const h = harness({fetchImpl: async () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  }});
  h.controller.setActive(true);
  const first = h.controller.refresh();
  const second = h.controller.refresh();
  await until(() => typeof release === 'function');
  assert.equal(calls, 1, 'same-turn calls do not multiply transport work');
  assert.equal(h.root.attrs['data-state'], 'loading');
  await second;
  release(paperResponse(generatedReport()));
  await first;
  assert.match(h.root.textContent, /Observation-only/);
  assert.notEqual(h.root.attrs['data-state'], 'loading');
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

test('revalidation reclassifies retained freshness without reading and preserves loading', async () => {
  let now = NOW;
  let calls = 0;
  let release;
  const h = harness({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return paperResponse(generatedReport());
      return new Promise(resolve => { release = resolve; });
    },
    policy: {now: () => now, staleAfterMs: 60_000}
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.notEqual(h.root.attrs['data-state'], 'stale');

  now += 60_001;
  h.revalidate();
  assert.equal(calls, 1, 'revalidation does not issue another read');
  assert.equal(h.root.attrs['data-state'], 'stale');
  assert.match(h.root.textContent, /stale under the shared display-only freshness policy/i);

  const pending = h.controller.refresh();
  await until(() => typeof release === 'function');
  h.revalidate();
  assert.equal(h.root.attrs['data-state'], 'loading');
  assert.match(h.root.textContent, /one-shot report read is in progress/i);
  assert.equal(calls, 2, 'revalidation does not multiply an in-flight read');
  release(paperResponse(generatedReport()));
  await pending;
  h.controller.dispose();
});

test('freshness deadline is one-shot, strict at the boundary, and replaced with the report', async () => {
  let now = NOW;
  let calls = 0;
  let release;
  const clock = fakeScheduler(() => now);
  const h = harness({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return paperResponse(generatedReport());
      return new Promise(resolve => { release = resolve; });
    },
    policy: {now: () => now, staleAfterMs: 60_000},
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  assert.equal(clock.timers.size, 1, 'a successful read arms one deadline timer');
  const firstTimerId = clock.timers.keys().next().value;
  assert.equal(clock.timers.get(firstTimerId).delay, 60_001);

  now += 1_000;
  const pending = h.controller.refresh();
  await until(() => typeof release === 'function');
  const inFlightTimerId = clock.timers.keys().next().value;
  assert.notEqual(inFlightTimerId, firstTimerId, 'rendering does not retain an obsolete timer');
  release(paperResponse(generatedReport({observedAt: now})));
  await pending;
  assert.equal(calls, 2);
  assert.equal(clock.timers.size, 1, 'the replacement report owns one new deadline');
  assert.equal(clock.timers.has(inFlightTimerId), false);

  now += 60_000;
  clock.runDue();
  assert.notEqual(h.root.attrs['data-state'], 'stale', 'the threshold itself remains within policy');
  assert.equal(clock.timers.size, 1, 'the timer waits until the strict stale boundary');
  now++;
  clock.runDue();
  assert.equal(h.root.attrs['data-state'], 'stale');
  assert.match(h.root.textContent, /stale under the shared display-only freshness policy/i);
  assert.equal(calls, 2, 'deadline revalidation never issues another read');
  assert.equal(clock.timers.size, 0, 'stale reports have no further deadline timer');
  h.controller.dispose();
});

test('deadline during a refresh preserves loading and lifecycle clearing cancels timers', async () => {
  let now = NOW;
  let calls = 0;
  let release;
  const clock = fakeScheduler(() => now);
  const h = harness({
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return paperResponse(generatedReport());
      return new Promise(resolve => { release = resolve; });
    },
    policy: {now: () => now, staleAfterMs: 60_000},
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule
  });
  h.controller.setActive(true);
  await h.controller.refresh();
  const pending = h.controller.refresh();
  await until(() => typeof release === 'function');
  now += 60_001;
  clock.runDue();
  assert.equal(h.root.attrs['data-state'], 'loading');
  assert.match(h.root.textContent, /one-shot report read is in progress/i);
  assert.equal(calls, 2, 'deadline expiry during a read performs no additional request');
  release(paperResponse(generatedReport({observedAt: now})));
  await pending;
  assert.notEqual(h.root.attrs['data-state'], 'stale', 'the replacement response is reclassified');
  assert.equal(clock.timers.size, 1);
  h.controller.dispose();
  assert.equal(clock.timers.size, 0);

  for (const lifecycle of ['lock', 'navigation', 'pagehide', 'dispose']) {
    now = NOW;
    const localClock = fakeScheduler(() => now);
    let localCalls = 0;
    const local = harness({
      fetchImpl: async () => {
        localCalls++;
        return paperResponse(generatedReport());
      },
      policy: {now: () => now, staleAfterMs: 60_000},
      schedule: localClock.schedule,
      cancelSchedule: localClock.cancelSchedule
    });
    local.controller.setActive(true);
    await local.controller.refresh();
    assert.equal(localClock.timers.size, 1, `${lifecycle} setup arms one timer`);
    if (lifecycle === 'lock') local.access.lock();
    else if (lifecycle === 'navigation') local.controller.setActive(false);
    else if (lifecycle === 'pagehide') local.window.fire('pagehide');
    else local.controller.dispose();
    assert.equal(localClock.timers.size, 0, `${lifecycle} cancels the deadline timer`);
    now += 60_001;
    localClock.runDue();
    assert.equal(localCalls, 1, `${lifecycle} deadline cannot cause another read`);
    if (lifecycle !== 'dispose') local.controller.dispose();
  }
});

test('pageshow restores selected cockpit activity without restoring data or starting a read', () => {
  let calls = 0;
  const h = harness({fetchImpl: async () => {
    calls++;
    return paperResponse(generatedReport());
  }});
  h.controller.setActive(true);
  h.window.fire('pagehide');
  assert.equal(h.root.attrs['data-state'], 'unavailable');
  assert.equal(h.findButton(), undefined);
  assert.equal(h.access.isUnlocked(), false);

  h.window.fire('pageshow');
  assert.equal(h.root.attrs['data-state'], 'auth-required');
  assert.ok(h.findButton(), 'previously selected cockpit regains its manual read affordance');
  assert.doesNotMatch(h.root.textContent, /Observation-only|90071992547409931234/);
  assert.equal(calls, 0);

  h.access.unlock();
  assert.equal(h.root.attrs['data-state'], 'ready');
  assert.ok(h.findButton());
  assert.equal(calls, 0, 'unlock and restoration never start a read');
  h.controller.dispose();
});

test('refresh rerenders preserve keyboard focus without stealing later focus', async () => {
  const releases = [];
  const h = harness({fetchImpl: async () => new Promise(resolve => releases.push(resolve))});
  h.controller.setActive(true);

  h.findButton().focus();
  h.findButton().click();
  await until(() => releases.length === 1);
  assert.equal(h.document.activeElement, h.findButton());
  assert.equal(h.findButton().attrs['aria-disabled'], 'true');
  assert.equal(h.findButton().attrs['aria-busy'], 'true');
  releases[0](paperResponse(generatedReport()));
  await until(() => h.root.textContent.includes('Observation-only'));
  assert.equal(h.document.activeElement, h.findButton(), 'completion retains refresh-button focus');

  h.findButton().focus();
  h.findButton().click();
  await until(() => releases.length === 2);
  const elsewhere = new Element(h.document, 'button');
  elsewhere.focus();
  releases[1](paperResponse(generatedReport()));
  await until(() => h.root.attrs['data-state'] !== 'loading');
  assert.equal(h.document.activeElement, elsewhere, 'completion does not steal focus after the user moves');
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
