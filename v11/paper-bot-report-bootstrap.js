import {appAccess} from './app-access.js?v=B16-M11-FIX14';
import {mountSpotPaperBotOverview} from './spot-paper-bot-overview-controller.js?v=B16-M11-FIX14';
import {mountSpotPaperPairedPanel} from './spot-paper-paired-controller.js?v=B16-M11-FIX14';
import {SPOT_PAPER_REPORT_ENDPOINT} from './spot-paper-cockpit-controller.js?v=B16-M11-FIX14';
import {createSpotPaperReportConnector} from './spot-paper-report-connector.js?v=B16-M11-FIX14';

const TREND_MODEL = 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1';
const messages = Object.freeze({
  locked: 'Gesperrt. Vor dem Abruf den App-Zugang öffnen.',
  ready: 'Kein Bot-Bericht abgerufen. Der Abruf erfolgt nur nach manueller Auswahl.',
  loading: 'Der bestehende BTC/EUR-Bericht wird einmalig gelesen.',
  available: 'Der bestehende Bericht ist authentifiziert, belegt aber nicht die 5-Minuten-Trend-Identität.',
  missing: 'Kein authentifizierter Bericht verfügbar. Laufstatus und Kennzahlen bleiben unbekannt.',
  rejected: 'Der Bericht konnte nicht validiert werden. Laufstatus und Kennzahlen bleiben unbekannt.'
});

function node(document, parent, tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function sourceAdapter(dto) {
  const identity = dto?.identity;
  const identityMatches = identity?.model === TREND_MODEL &&
    identity?.pair === 'BTC/EUR';
  return {
    id: 'btc-eur-trend',
    report: dto,
    project: () => ({
      state: 'UNKNOWN',
      stateReason: identityMatches ? 'RUNTIME_STATUS_NOT_REPORTED' :
        'SOURCE_IDENTITY_NOT_SUPPORTED',
      strategy: identity?.model || 'Unbekannt',
      version: identity?.profileId || 'Unbekannt',
      market: identity?.pair || 'BTC/EUR',
      currency: 'EUR',
      freshness: {
        status: 'UNKNOWN',
        reason: identityMatches ? 'RUNTIME_FRESHNESS_NOT_REPORTED' :
          'SOURCE_IDENTITY_NOT_SUPPORTED'
      },
      noTradeReason: identityMatches ?
        'RUNTIME_STATUS_NOT_REPORTED' : 'SOURCE_IDENTITY_NOT_SUPPORTED'
    })
  };
}

export function mountPaperBotReportWorkspace(overviewRoot, pairedRoot, document, {
  access = appAccess,
  fetchImpl = globalThis.fetch,
  enabled = true,
  createConnector = createSpotPaperReportConnector
} = {}) {
  if (!overviewRoot || !pairedRoot || !document || !access ||
      typeof access.getToken !== 'function' ||
      typeof access.isUnlocked !== 'function' ||
      typeof access.registerReader !== 'function' ||
      typeof access.subscribe !== 'function' ||
      typeof fetchImpl !== 'function' ||
      typeof createConnector !== 'function') {
    throw new TypeError('Paper report workspace dependencies are invalid');
  }

  const overview = mountSpotPaperBotOverview(overviewRoot, {document});
  const paired = mountSpotPaperPairedPanel(pairedRoot, {dto: null, document});
  const controls = document.createElement('div');
  controls.setAttribute('style', 'display:grid;gap:8px;min-width:0;margin:0 0 12px');
  const refresh = node(document, controls, 'button', 'BTC/EUR-Quelle manuell prüfen');
  refresh.type = 'button';
  refresh.setAttribute('style', 'min-height:44px;max-width:100%;white-space:normal');
  const status = node(document, controls, 'p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  overviewRoot.parentNode?.insertBefore(controls, overviewRoot);

  let connector = null;
  let report = null;
  let state = enabled ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
  let active = false;
  let disposed = false;
  let reading = false;
  let generation = 0;
  let requestOwner = null;

  function render() {
    if (disposed) return;
    status.textContent = messages[state] || messages.missing;
    refresh.disabled = !enabled || !active || !access.isUnlocked() || reading;
    refresh.setAttribute('aria-busy', String(reading));
    overview.update(report ? [sourceAdapter(report)] : []);
    paired.render(null);
  }

  function clearPrivate() {
    generation++;
    reading = false;
    report = null;
    requestOwner = null;
    if (connector && !connector.isDisposed()) connector.dispose();
    state = enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
    render();
  }

  function ownsRequest(owner, signal) {
    return owner !== null && owner.generation === generation &&
      !signal?.aborted && !disposed && active && access.isUnlocked() &&
      access.getToken() === owner.token;
  }

  function transport({signal}) {
    const owner = requestOwner;
    if (!ownsRequest(owner, signal)) return Promise.resolve(new Response(null, {status: 503}));
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

  async function read() {
    if (disposed || !active) return;
    if (!enabled) {
      report = null;
      state = 'missing';
      render();
      return;
    }
    if (!access.isUnlocked() || !access.getToken()) {
      report = null;
      state = 'locked';
      render();
      return;
    }
    if (reading || connector?.isBusy()) return;
    if (connector?.isDisposed()) connector = null;
    if (!connector) connector = createConnector({enabled, transport});

    const owner = {generation: ++generation, token: access.getToken()};
    requestOwner = owner;
    reading = true;
    state = 'loading';
    render();
    try {
      const result = await connector.read();
      if (!ownsRequest(owner) || !access.isUnlocked()) return;
      reading = false;
      if (result.status === 'AUTH_REQUIRED') {
        access.lock();
        return;
      }
      if (result.status === 'AVAILABLE' && result.report) {
        report = result.report;
        state = 'available';
      } else {
        report = null;
        state = result.status === 'REJECTED' ? 'rejected' : 'missing';
      }
      render();
    } catch {
      if (owner.generation !== generation || disposed || !active) return;
      reading = false;
      report = null;
      state = 'missing';
      render();
    } finally {
      if (requestOwner === owner) requestOwner = null;
    }
  }

  const onClick = () => { void read(); };
  refresh.addEventListener('click', onClick);
  const unregister = access.registerReader(clearPrivate);
  const unsubscribe = access.subscribe(change => {
    if (disposed) return;
    if (change?.status === 'locked' || change?.status === 'checking') {
      clearPrivate();
    } else if (change?.status === 'unlocked' && !report) {
      state = enabled ? 'ready' : 'missing';
      render();
    }
  });
  render();

  return Object.freeze({
    setActive(value) {
      if (disposed) return;
      const next = value === true;
      if (active === next) return;
      active = next;
      if (!active) clearPrivate();
      else {
        state = enabled ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
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
      refresh.removeEventListener('click', onClick);
      connector?.dispose();
      overview.dispose();
      paired.dispose();
      controls.remove();
      overviewRoot.replaceChildren();
      pairedRoot.replaceChildren();
    }
  });
}
