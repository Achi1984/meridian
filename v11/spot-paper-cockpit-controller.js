import {appAccess} from './app-access.js?v=B16-M11-FIX16';
import {createSpotPaperReportConnector} from './spot-paper-report-connector.js?v=B16-M11-FIX16';
import {presentSpotPaperCockpit} from './spot-paper-cockpit-model.js?v=B16-M11-FIX16';
import {renderSpotPaperCockpit} from './spot-paper-cockpit-view.js?v=B16-M11-FIX16';

export const SPOT_PAPER_REPORT_ENDPOINT =
  'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/spot-paper-report';

const messages = {
  'auth-required': 'Vor dem Abruf des privaten BTC/EUR-Berichts Meridian entsperren.',
  ready: 'Kein BTC/EUR-Bericht abgerufen. Für einen einmaligen Abruf die Schaltfläche verwenden.',
  loading: 'Der einmalige Abruf des BTC/EUR-Berichts läuft.',
  terminal: 'Abgeschlossener BTC/EUR-Paper-Snapshot. Daraus wird kein laufender Worker abgeleitet.',
  rejected: 'Die BTC/EUR-Antwort wurde abgelehnt und wird nicht angezeigt.',
  stale: 'Der abgeschlossene BTC/EUR-Snapshot ist nach der reinen Anzeigegrenze veraltet.',
  unknown: 'Aktualität oder Snapshot-Daten sind unbekannt; ein Laufstatus wird nicht abgeleitet.',
  unavailable: 'Kein freigegebener BTC/EUR-Bericht verfügbar.'
};

function initialState(access, enabled) {
  if (!enabled) return 'unavailable';
  return access.isUnlocked() ? 'ready' : 'auth-required';
}

export function mountSpotPaperCockpit(root, document, window, {
  access = appAccess,
  fetchImpl = globalThis.fetch,
  enabled = true,
  freshnessPolicy = {now: Date.now, staleAfterMs: 5 * 60 * 1000},
  createConnector = createSpotPaperReportConnector,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (!root || !document || !window || !access ||
      typeof access.getToken !== 'function' || typeof access.isUnlocked !== 'function' ||
      typeof access.registerReader !== 'function' || typeof access.subscribe !== 'function' ||
      typeof schedule !== 'function' || typeof cancelSchedule !== 'function' ||
      typeof freshnessPolicy?.now !== 'function' ||
      !(freshnessPolicy.staleAfterMs === null ||
        (Number.isSafeInteger(freshnessPolicy.staleAfterMs) && freshnessPolicy.staleAfterMs >= 0))) {
    throw new TypeError('BTC/EUR cockpit dependencies are invalid');
  }
  const policy = Object.freeze({
    now: freshnessPolicy.now,
    staleAfterMs: freshnessPolicy.staleAfterMs
  });
  let connector = null;
  let report = null;
  let state = initialState(access, enabled);
  let active = false;
  let disposed = false;
  let reading = false;
  let staleTimer = null;
  let requestOwner = null;
  let generation = 0;
  let restoreActiveOnPageShow = false;

  function clearStaleTimer() {
    if (staleTimer === null) return;
    cancelSchedule(staleTimer);
    staleTimer = null;
  }

  function disposeRead() {
    if (connector && !connector.isDisposed()) connector.dispose();
  }

  function clearPrivate() {
    generation++;
    reading = false;
    report = null;
    disposeRead();
    state = active ? initialState(access, enabled) : 'unavailable';
    render();
  }

  function classify() {
    if (!report) return state;
    const model = presentSpotPaperCockpit(report, {
      now: policy.now(),
      staleAfterMs: policy.staleAfterMs
    });
    if (!model.available || model.freshness.status === 'UNKNOWN') return 'unknown';
    if (model.freshness.status === 'STALE') return 'stale';
    return 'terminal';
  }

  function scheduleStaleUpdate(now) {
    clearStaleTimer();
    if (disposed || !active || !report || policy.staleAfterMs === null) return;
    const model = presentSpotPaperCockpit(report, {now, staleAfterMs: policy.staleAfterMs});
    if (model.freshness.status !== 'WITHIN_DISPLAY_POLICY') return;
    const remaining = policy.staleAfterMs - model.freshness.ageMs + 1;
    if (remaining <= 0) return;
    staleTimer = schedule(() => {
      staleTimer = null;
      render();
    }, Math.min(remaining, 2_147_483_647));
  }

  function render() {
    if (disposed) return;
    const now = policy.now();
    if (report && !reading) state = classify();
    renderSpotPaperCockpit(root, report, document, {
      state,
      message: messages[state] || messages.unknown,
      onRefresh: enabled && active && access.isUnlocked() ? read : null,
      loading: reading,
      now,
      staleAfterMs: policy.staleAfterMs
    });
    scheduleStaleUpdate(now);
  }

  function ownsRequest(owner, signal) {
    return owner !== null && owner.generation === generation && !signal?.aborted &&
      !disposed && active && access.isUnlocked() && access.getToken() === owner.token;
  }

  function transport({signal}) {
    const owner = requestOwner;
    if (!owner || !ownsRequest(owner, signal)) {
      return Promise.resolve(new Response(null, {status: 503}));
    }
    return fetchImpl(SPOT_PAPER_REPORT_ENDPOINT, {
      method: 'GET',
      headers: {accept: 'application/json', authorization: 'Bearer ' + owner.token},
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal
    }).then(response => {
      if ((response.status === 401 || response.status === 403) &&
          ownsRequest(owner, signal)) access.lock();
      return response;
    });
  }

  function projectResult(result, id) {
    if (disposed || !active || id !== generation || !access.isUnlocked()) return;
    reading = false;
    if (result.status === 'AUTH_REQUIRED') {
      access.lock();
      return;
    }
    if (result.status === 'REJECTED') {
      report = null;
      state = 'rejected';
    } else if (result.status === 'AVAILABLE' && result.report) {
      report = result.report;
      state = 'unknown';
    } else if (result.status === 'BUSY') {
      state = 'loading';
    } else {
      report = null;
      state = 'unavailable';
    }
    render();
  }

  async function read() {
    if (disposed || !active) return;
    if (!enabled || !access.isUnlocked()) {
      report = null;
      state = enabled ? 'auth-required' : 'unavailable';
      render();
      return;
    }
    const token = access.getToken();
    if (!token || !access.isUnlocked()) {
      if (access.isUnlocked()) access.lock();
      report = null;
      state = 'auth-required';
      render();
      return;
    }
    if (reading) return;
    if (connector?.isDisposed()) {
      if (connector.isBusy()) return;
      connector = null;
    }
    if (connector?.isBusy()) return;
    if (!connector) connector = createConnector({enabled, transport});
    const id = ++generation;
    const owner = {generation: id, token};
    requestOwner = owner;
    reading = true;
    state = 'loading';
    render();
    try {
      projectResult(await connector.read(), id);
    } catch {
      if (id !== generation || disposed || !active) return;
      reading = false;
      report = null;
      state = 'unavailable';
      render();
    } finally {
      if (requestOwner === owner) requestOwner = null;
    }
  }

  function onAccess(change) {
    if (disposed) return;
    if (change?.status === 'locked' || change?.status === 'checking') {
      clearPrivate();
    } else if (change?.status === 'unlocked' && !report) {
      state = enabled ? 'ready' : 'unavailable';
      render();
    }
  }

  function pagehide() {
    restoreActiveOnPageShow = active;
    active = false;
    clearPrivate();
    access.lock();
  }

  function pageshow() {
    if (disposed || !restoreActiveOnPageShow) return;
    restoreActiveOnPageShow = false;
    active = true;
    state = initialState(access, enabled);
    render();
  }

  const unregister = access.registerReader(clearPrivate, render);
  const unsubscribe = access.subscribe(onAccess);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('pageshow', pageshow);
  render();

  return Object.freeze({
    setActive(value) {
      if (disposed) return;
      const next = value === true;
      if (active === next) return;
      active = next;
      if (!active) clearPrivate();
      else {
        state = initialState(access, enabled);
        render();
      }
    },
    refresh: read,
    dispose() {
      if (disposed) return;
      active = false;
      clearPrivate();
      disposed = true;
      clearStaleTimer();
      unregister();
      unsubscribe();
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      root.replaceChildren();
    }
  });
}
