import {appAccess} from './app-access.js?v=B16-M11-FIX12';
import {createPaperReportConnector} from './paper-report-connector.js?v=B16-M11-FIX12';
import {presentPaperCockpitReport} from './paper-cockpit-model.js?v=B16-M11-FIX12';
import {renderPaperCockpit} from './paper-cockpit-view.js?v=B16-M11-FIX12';

export const PAPER_REPORT_ENDPOINT =
  'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/paper-report';

const STATE_MESSAGES = {
  'auth-required': 'Unlock Meridian before requesting the private report.',
  ready: 'No report has been requested. Use the button for a one-shot read.',
  loading: 'The one-shot report read is in progress.',
  rejected: 'The report response was rejected and is not displayed.',
  stale: 'The report is stale under the shared display-only freshness policy.',
  partial: 'The terminal report has partial evidence coverage.',
  terminal: 'Terminal report only; this does not establish current worker liveness.',
  unknown: 'Report freshness, evidence coverage, or status is unknown.',
  unavailable: 'No approved report is currently available.'
};

function initialState(access, enabled) {
  if (!enabled) return 'unavailable';
  return access.isUnlocked() ? 'ready' : 'auth-required';
}

export function mountPaperCockpit(root, document, window, {
  access = appAccess,
  fetchImpl = globalThis.fetch,
  enabled = true,
  freshnessPolicy = {now: Date.now, staleAfterMs: 5 * 60 * 1000},
  createConnector = createPaperReportConnector
} = {}) {
  if (!root || !document || !window || !access ||
      typeof access.getToken !== 'function' || typeof access.isUnlocked !== 'function' ||
      typeof access.registerReader !== 'function' || typeof access.subscribe !== 'function' ||
      typeof freshnessPolicy?.now !== 'function' ||
      !(freshnessPolicy.staleAfterMs === null ||
        (Number.isSafeInteger(freshnessPolicy.staleAfterMs) && freshnessPolicy.staleAfterMs >= 0))) {
    throw new TypeError('Paper cockpit dependencies are invalid');
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
  let generation = 0;

  function render() {
    if (disposed) return;
    renderPaperCockpit(root, report, document, {
      state,
      message: STATE_MESSAGES[state] || STATE_MESSAGES.unknown,
      onRefresh: enabled && active ? read : null,
      loading: reading,
      freshnessPolicy: policy
    });
  }

  function disposeRead() {
    if (connector && !connector.isDisposed?.()) connector.dispose();
  }

  function clearPrivate() {
    generation++;
    reading = false;
    report = null;
    disposeRead();
    state = active ? initialState(access, enabled) : 'unavailable';
    render();
  }

  function revalidate() {
    if (disposed || !active) return;
    if (!access.isUnlocked()) {
      clearPrivate();
      return;
    }
    if (report) render();
  }

  function transport({signal}) {
    const token = access.getToken();
    if (!token) return Promise.resolve(new Response(null, {status: 401}));
    return fetchImpl(PAPER_REPORT_ENDPOINT, {
      method: 'GET',
      headers: {accept: 'application/json', authorization: 'Bearer ' + token},
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal
    }).then(response => {
      if (response.status === 401 || response.status === 403) access.lock();
      return response;
    });
  }

  function projectResult(result, id) {
    if (disposed || !active || id !== generation || !access.isUnlocked()) return;
    reading = false;
    if (result.status === 'AUTH_REQUIRED' || result.reason === 'AUTH_REQUIRED') {
      access.lock();
      return;
    }
    if (result.status === 'REJECTED') {
      report = null;
      state = 'rejected';
    } else if (result.status === 'STALE') {
      report = result.report;
      state = 'stale';
    } else if (result.status === 'AVAILABLE' && result.report) {
      report = result.report;
      const model = presentPaperCockpitReport(report, {
        now: policy.now(),
        staleAfterMs: policy.staleAfterMs
      });
      if (model.evidence.freshness.status === 'STALE') state = 'stale';
      else if (model.evidence.coverage === 'PARTIAL') state = 'partial';
      else if (model.evidence.coverage === 'UNKNOWN' ||
          model.evidence.freshness.status === 'UNKNOWN') state = 'unknown';
      else if (['FINISHED', 'INCOMPLETE'].includes(model.experiment.status)) state = 'terminal';
      else state = 'unknown';
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
    if (connector?.isDisposed?.()) {
      if (connector.isBusy?.()) {
        state = 'loading';
        render();
        return;
      }
      connector = null;
    }
    if (connector?.isBusy?.()) {
      state = 'loading';
      render();
      return;
    }
    if (!connector) {
      connector = createConnector({
        enabled,
        transport,
        freshnessPolicy: policy
      });
    }
    const id = ++generation;
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
    }
  }

  function onAccess(stateChange) {
    if (disposed) return;
    if (stateChange?.status === 'locked' || stateChange?.status === 'checking') {
      clearPrivate();
    } else if (stateChange?.status === 'unlocked' && !report) {
      state = enabled ? 'ready' : 'unavailable';
      render();
    }
  }

  function pagehide() {
    active = false;
    clearPrivate();
    access.lock();
  }

  const unregister = access.registerReader(clearPrivate, revalidate);
  const unsubscribe = access.subscribe(onAccess);
  window.addEventListener('pagehide', pagehide);
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
      unregister();
      unsubscribe();
      window.removeEventListener('pagehide', pagehide);
      root.replaceChildren();
    }
  });
}
