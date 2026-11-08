import {appAccess} from './app-access.js?v=B16-M11-FIX13';
import {renderSpotPaperHost8h} from './spot-paper-host8h-view.js?v=B16-M11-FIX13';
import {
  SPOT_PAPER_HOST8H_MAX_INPUT_BYTES
} from './spot-paper-host8h-model.js?v=B16-M11-FIX13';

export const SPOT_PAPER_HOST8H_REPORT_ENDPOINT =
  'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/spot-paper-host8h-report';
const TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

const messages = {
  'auth-required': 'Vor dem Abruf des privaten Host8h-Berichts Meridian entsperren.',
  ready: 'Host8h-Status wurde noch nicht abgerufen.',
  loading: 'Der authentifizierte Host8h-Statusabruf läuft.',
  unavailable: 'Host8h-Transport nicht verfügbar; keine aktuellen Laufdaten werden angezeigt.',
  'transport-not-provisioned':
    'Host8h-Transport nicht provisioniert: Lead muss den separaten Host8h-Upload, die isolierte Reporttabelle und die drei Host8h-Gateway-Freigaben einrichten.',
  'summary-not-found':
    'Host8h-Transport erreichbar, aber noch kein Summary hochgeladen; Host-Volume-Exporter und Upload-Credential müssen separat provisioniert werden.',
  rejected: 'Host8h-Antwort abgelehnt; keine nicht geprüften Kennzahlen werden angezeigt.',
  stale: 'Letzter Host8h-Snapshot ist veraltet; keine aktuelle Hostbeobachtung.'
};

async function boundedJson(response, signal) {
  if (response.status === 404) throw new Error('TRANSPORT_NOT_PROVISIONED');
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new Error('INVALID_CONTENT_TYPE');
  }
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined &&
      (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > SPOT_PAPER_HOST8H_MAX_INPUT_BYTES)) {
    throw new Error('RESPONSE_TOO_LARGE');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        if (signal.aborted) throw new Error('REQUEST_CANCELLED');
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > SPOT_PAPER_HOST8H_MAX_INPUT_BYTES) {
          await reader.cancel();
          throw new Error('RESPONSE_TOO_LARGE');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!response.ok) {
      const code = parsed?.error;
      throw new Error(code === 'host8h_report_not_found' ? 'SUMMARY_NOT_FOUND' :
        code === 'host8h_transport_not_provisioned' || response.status === 404 ?
          'TRANSPORT_NOT_PROVISIONED' : 'UNAVAILABLE');
    }
    return parsed;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > SPOT_PAPER_HOST8H_MAX_INPUT_BYTES) throw new Error('RESPONSE_TOO_LARGE');
  const parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!response.ok) {
    const code = parsed?.error;
    throw new Error(code === 'host8h_report_not_found' ? 'SUMMARY_NOT_FOUND' :
      code === 'host8h_transport_not_provisioned' || response.status === 404 ?
        'TRANSPORT_NOT_PROVISIONED' : 'UNAVAILABLE');
  }
  return parsed;
}

function classifyEnvelope(envelope) {
  if (!envelope || envelope.schema !== 'BTC_EUR_SPOT_PAPER_HOST8H_REPORT_ENVELOPE_V1' ||
      envelope.runId !== 'btc-eur-paper-host-8h-001' ||
      envelope.report?.schemaVersion !== 'SPOT_PAPER_HOST8H_PANEL_INPUT_V1' ||
      envelope.report?.identity?.runId !== envelope.runId) {
    throw new Error('INVALID_HOST8H_ENVELOPE');
  }
  return envelope.report;
}

export function mountSpotPaperHost8hDashboard(root, document, window, {
  access = appAccess,
  fetchImpl = globalThis.fetch,
  enabled = true,
  now = Date.now,
  staleAfterMs = 5 * 60 * 1000,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (!root || !document || !window || !access ||
      typeof access.getToken !== 'function' || typeof access.isUnlocked !== 'function' ||
      typeof access.lock !== 'function' || typeof access.registerReader !== 'function' ||
      typeof access.subscribe !== 'function' || typeof fetchImpl !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0 ||
      typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
    throw new TypeError('Host8h dashboard dependencies are invalid');
  }
  let active = false;
  let disposed = false;
  let loading = false;
  let snapshot = null;
  let errorState = enabled ? (access.isUnlocked() ? 'ready' : 'auth-required') : 'unavailable';
  let errorCount = 0;
  let retryAt = 0;
  let retryTimer = null;
  let request = null;
  let generation = 0;

  function clearRetry() {
    if (retryTimer === null) return;
    cancelSchedule(retryTimer);
    retryTimer = null;
  }

  function clearPrivate() {
    generation++;
    loading = false;
    snapshot = null;
    request?.abort();
    request = null;
    clearRetry();
    errorCount = 0;
    retryAt = 0;
    errorState = enabled ? (access.isUnlocked() ? 'ready' : 'auth-required') : 'unavailable';
    render();
  }

  function retryBlocked() {
    return now() < retryAt;
  }

  function setFailure(state) {
    loading = false;
    errorState = state;
    if (state === 'unavailable' || state === 'rejected' || state === 'summary-not-found') {
      errorCount = Math.min(errorCount + 1, 10);
      retryAt = now() + Math.min(1_000 * (2 ** (errorCount - 1)), MAX_BACKOFF_MS);
      clearRetry();
      const delay = Math.max(0, retryAt - now());
      retryTimer = schedule(() => {
        retryTimer = null;
        render();
      }, Math.min(delay, 2_147_483_647));
    }
    render();
  }

  function render() {
    if (disposed) return;
    const canRead = enabled && active && access.isUnlocked();
    const result = renderSpotPaperHost8h(root, snapshot, document, {
      now: now(),
      staleAfterMs,
      loading,
      retryBlocked: retryBlocked(),
      onRefresh: canRead ? refresh : null,
      state: errorState === 'ready' && snapshot ? undefined : errorState,
      message: errorState === 'ready' && snapshot ? undefined :
        messages[errorState] || messages.unavailable
    });
    if (result?.status === 'STALE') {
      root.setAttribute('data-state', 'stale');
    }
    if (retryBlocked() && errorState !== 'ready' && errorState !== 'loading') {
      const notice = document.createElement('p');
      notice.textContent = `Erneuter Abruf ist nach der Backoff-Grenze in ${Math.ceil(
        (retryAt - now()) / 1000)} s verfügbar.`;
      notice.className = 'caption';
      root.append(notice);
    }
    return result;
  }

  async function refresh() {
    if (disposed || !active) return;
    if (!enabled) {
      errorState = 'unavailable';
      render();
      return;
    }
    if (!access.isUnlocked()) {
      errorState = 'auth-required';
      snapshot = null;
      render();
      return;
    }
    if (loading || retryBlocked()) {
      render();
      return;
    }
    const token = access.getToken();
    if (!token || !access.isUnlocked()) {
      access.lock();
      errorState = 'auth-required';
      snapshot = null;
      render();
      return;
    }
    const controller = new AbortController();
    const id = ++generation;
    request = controller;
    loading = true;
    errorState = 'loading';
    render();
    let timeout;
    let timedOut = false;
    try {
      timeout = schedule(() => {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);
      if (timeout === undefined || timeout === null) throw new Error('TIMER_UNAVAILABLE');
      const response = await fetchImpl(SPOT_PAPER_HOST8H_REPORT_ENDPOINT, {
        method: 'GET',
        headers: {accept: 'application/json', authorization: 'Bearer ' + token},
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        access.lock();
        throw new Error('AUTH_REQUIRED');
      }
      const envelope = await boundedJson(response, controller.signal);
      const report = classifyEnvelope(envelope);
      if (timedOut) throw new Error('REQUEST_TIMEOUT');
      if (controller.signal.aborted || id !== generation || !active ||
          !access.isUnlocked() || access.getToken() !== token) return;
      snapshot = report;
      loading = false;
      errorCount = 0;
      retryAt = 0;
      errorState = 'ready';
    } catch (error) {
      if (id !== generation || disposed || !active) return;
      if (controller.signal.aborted && !timedOut) return;
      if (error?.message === 'AUTH_REQUIRED') {
        errorState = 'auth-required';
        snapshot = null;
        loading = false;
        render();
        return;
      }
      const state = error?.message === 'TRANSPORT_NOT_PROVISIONED' ?
        'transport-not-provisioned' :
        error?.message === 'SUMMARY_NOT_FOUND' ? 'summary-not-found' :
          ['INVALID_HOST8H_ENVELOPE', 'INVALID_CONTENT_TYPE', 'RESPONSE_TOO_LARGE']
            .includes(error?.message) ? 'rejected' : 'unavailable';
      setFailure(state);
      return;
    } finally {
      if (timeout !== undefined && timeout !== null) {
        try { cancelSchedule(timeout); } catch {}
      }
      if (request === controller) request = null;
    }
    render();
  }

  function onAccess(change) {
    if (disposed) return;
    if (change?.status === 'locked' || change?.status === 'checking') {
      clearPrivate();
    } else if (change?.status === 'unlocked' && active && !snapshot) {
      errorState = enabled ? 'ready' : 'unavailable';
      render();
      void refresh();
    }
  }

  function pagehide() {
    active = false;
    clearPrivate();
    access.lock();
  }

  const unregister = access.registerReader(clearPrivate, render);
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
        errorState = enabled ? (access.isUnlocked() ? 'ready' : 'auth-required') : 'unavailable';
        render();
        if (access.isUnlocked()) void refresh();
      }
    },
    refresh,
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
