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
  createConnector = createPaperReportConnector,
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
  let freshnessTimer = null;
  let restoreActiveOnPageShow = false;
  let generation = 0;
  let requestOwner = null;

  function clearFreshnessTimer() {
    if (freshnessTimer === null) return;
    cancelSchedule(freshnessTimer);
    freshnessTimer = null;
  }

  function scheduleFreshnessUpdate(now) {
    clearFreshnessTimer();
    if (disposed || !active || !report || policy.staleAfterMs === null) return;
    const model = presentPaperCockpitReport(report, {
      now,
      staleAfterMs: policy.staleAfterMs
    });
    const freshness = model.evidence?.freshness;
    if (freshness?.status !== 'WITHIN_DISPLAY_POLICY' ||
        !Number.isSafeInteger(freshness.ageMs)) return;
    const remaining = policy.staleAfterMs - freshness.ageMs + 1;
    if (remaining <= 0) return;
    freshnessTimer = schedule(() => {
      freshnessTimer = null;
      revalidate();
    }, Math.min(remaining, 2_147_483_647));
  }

  function render({preserveDemoState = false} = {}) {
    if (disposed) return;
    const now = policy.now();
    if (report && !reading) state = classifyReport(report, now);
    renderPaperCockpit(root, report, document, {
      state,
      message: STATE_MESSAGES[state] || STATE_MESSAGES.unknown,
      onRefresh: enabled && active ? read : null,
      loading: reading,
      freshnessPolicy: policy,
      now,
      preserveDemoState
    });
    scheduleFreshnessUpdate(now);
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
    if (report) {
      render({preserveDemoState: true});
    }
  }

  function classifyReport(report, now) {
    const model = presentPaperCockpitReport(report, {
      now,
      staleAfterMs: policy.staleAfterMs
    });
    if (model.evidence.freshness.status === 'STALE') return 'stale';
    if (model.evidence.coverage === 'PARTIAL') return 'partial';
    if (model.evidence.coverage === 'UNKNOWN' ||
        model.evidence.freshness.status === 'UNKNOWN') return 'unknown';
    if (['FINISHED', 'INCOMPLETE'].includes(model.experiment.status)) return 'terminal';
    return 'unknown';
  }

  function ownsRequest(owner, signal) {
    return owner !== null && owner.generation === generation && !signal?.aborted &&
      !disposed && active && access.isUnlocked() && access.getToken() === owner.token;
  }

  function transport({signal}) {
    const owner = requestOwner;
    const token = owner?.token;
    if (!owner || !ownsRequest(owner, signal)) {
      return Promise.resolve(new Response(null, {status: 503}));
    }
    if (!token) {
      return Promise.resolve(new Response(null, {status: 401}));
    }
    return fetchImpl(PAPER_REPORT_ENDPOINT, {
      method: 'GET',
      headers: {accept: 'application/json', authorization: 'Bearer ' + token},
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
    if (reading) {
      state = 'loading';
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

  const unregister = access.registerReader(clearPrivate, revalidate);
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
      unregister();
      unsubscribe();
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      root.replaceChildren();
    }
  });
}
