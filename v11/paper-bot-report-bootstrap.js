import {appAccess} from './app-access.js?v=B16-M11-FIX14';
import {mountSpotPaperBotOverview} from './spot-paper-bot-overview-controller.js?v=B16-M11-FIX14';
import {mountSpotPaperPairedPanel} from './spot-paper-paired-controller.js?v=B16-M11-FIX14';
import {SPOT_PAPER_REPORT_ENDPOINT} from './spot-paper-cockpit-controller.js?v=B16-M11-FIX14';
import {createSpotPaperReportConnector} from './spot-paper-report-connector.js?v=B16-M11-FIX14';
import {
  createSpotPaperPairedReportConnector,
  SPOT_PAPER_PAIRED_REPORT_ENDPOINT
} from './spot-paper-paired-report-connector.js?v=B16-M11-FIX14';

const TREND_MODEL = 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1';
const messages = Object.freeze({
  locked: 'Gesperrt. Vor dem Abruf den App-Zugang öffnen.',
  authentication_failed: 'Authentifizierung fehlgeschlagen. Bitte App-Zugang erneut öffnen.',
  ready: 'Kein Bot-Bericht abgerufen. Der Abruf erfolgt nur nach manueller Auswahl.',
  loading: 'Der bestehende BTC/EUR-Bericht wird einmalig gelesen.',
  available: 'Der bestehende Bericht ist authentifiziert, belegt aber nicht die 5-Minuten-Trend-Identität.',
  missing: 'Kein authentifizierter Bericht verfügbar. Laufstatus und Kennzahlen bleiben unbekannt.',
  rejected: 'Der Bericht konnte nicht validiert werden. Laufstatus und Kennzahlen bleiben unbekannt.'
});
const pairedMessages = Object.freeze({
  locked: 'Gesperrt. Vor dem Abruf den App-Zugang öffnen.',
  authentication_failed: 'Authentifizierung fehlgeschlagen. Bitte App-Zugang erneut öffnen.',
  ready: 'Kein gepaarter Bericht abgerufen; Run-, Quellen-, Profil-, Fingerabdruck- und Host-Identität bleiben unbekannt.',
  loading: 'Der gepaarte BTC/EUR-Bericht wird einmalig gelesen.',
  available: 'Gepaarter Bericht geladen; Identitäten und Kennzahlen stammen aus dem validierten DTO.',
  transport_unavailable: 'Der authentifizierte gepaarte Transport ist nicht provisioniert.',
  not_found: 'Kein gepaarter Bericht veröffentlicht. Es wird kein Laufstatus abgeleitet.',
  identity_mismatch: 'Die veröffentlichte Report-Identität stimmt nicht mit der freigegebenen Identität überein.',
  unsupported_schema: 'Das gepaarte Report-Schema wird nicht unterstützt.',
  unsupported_identity: 'Die neue Trend-Identität ist bis zum kanonischen #1319-Vertrag nicht unterstützt.',
  rejected: 'Der gepaarte Bericht konnte nicht validiert werden.',
  unavailable: 'Der gepaarte Bericht ist derzeit nicht verfügbar.'
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
  const receivedIdentity = [
    identity?.model && `Modell ${identity.model}`,
    identity?.profileId && `Profil ${identity.profileId}`,
    identity?.pair && `Markt ${identity.pair}`,
    identity?.runId && `Lauf ${identity.runId}`
  ].filter(Boolean).join(' · ');
  return {
    id: 'btc-eur-trend',
    report: dto,
    project: () => ({
      state: 'UNKNOWN',
      stateReason: identityMatches ? 'RUNTIME_STATUS_NOT_REPORTED' :
        'SOURCE_IDENTITY_NOT_SUPPORTED',
      strategy: TREND_MODEL,
      version: identityMatches ? identity?.profileId || 'Unbekannt' : 'Unbekannt',
      market: 'BTC/EUR',
      currency: 'EUR',
      freshness: {
        status: 'UNKNOWN',
        reason: identityMatches ? 'RUNTIME_FRESHNESS_NOT_REPORTED' :
          'SOURCE_IDENTITY_NOT_SUPPORTED'
      },
      noTradeReason: identityMatches ? 'RUNTIME_STATUS_NOT_REPORTED' :
        `SOURCE_IDENTITY_NOT_SUPPORTED${receivedIdentity ? ` · empfangen: ${receivedIdentity}` : ''}`
    })
  };
}

export function mountPaperBotReportWorkspace(overviewRoot, pairedRoot, document, {
  access = appAccess,
  fetchImpl = globalThis.fetch,
  enabled = true,
  createConnector = createSpotPaperReportConnector,
  createPairedConnector = createSpotPaperPairedReportConnector,
  pairedStatus = null
} = {}) {
  if (!overviewRoot || !pairedRoot || !document || !access ||
      typeof access.getToken !== 'function' ||
      typeof access.isUnlocked !== 'function' ||
      typeof access.registerReader !== 'function' ||
      typeof access.subscribe !== 'function' ||
      typeof fetchImpl !== 'function' ||
      typeof createConnector !== 'function' ||
      typeof createPairedConnector !== 'function') {
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
  const pairedControls = document.createElement('div');
  pairedControls.setAttribute('style', 'display:grid;gap:8px;min-width:0;margin:0 0 12px');
  const pairedRefresh = node(document, pairedControls, 'button',
    'Gepaarte BTC/EUR-Quelle manuell prüfen');
  pairedRefresh.type = 'button';
  pairedRefresh.setAttribute('style', 'min-height:44px;max-width:100%;white-space:normal');
  const pairedStateNode = pairedStatus || node(document, pairedControls, 'p');
  if (pairedStatus) pairedControls.append(pairedStateNode);
  pairedStateNode.setAttribute('role', 'status');
  pairedStateNode.setAttribute('aria-live', 'polite');
  pairedStateNode.setAttribute('aria-atomic', 'true');
  pairedRoot.parentNode?.insertBefore(pairedControls, pairedRoot);

  let connector = null;
  let pairedConnector = null;
  let report = null;
  let pairedReport = null;
  let state = enabled ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
  let pairedState = enabled ? (access.isUnlocked() ? 'ready' : 'locked') :
    'transport_unavailable';
  let active = false;
  let disposed = false;
  let reading = false;
  let pairedReading = false;
  let generation = 0;
  let pairedGeneration = 0;
  let requestOwner = null;
  let pairedRequestOwner = null;
  let authenticationFailed = false;

  function render() {
    if (disposed) return;
    status.textContent = messages[state] || messages.missing;
    refresh.disabled = !enabled || !active || !access.isUnlocked() || reading;
    refresh.setAttribute('aria-busy', String(reading));
    pairedRefresh.disabled = !enabled || !active || !access.isUnlocked() || pairedReading;
    pairedRefresh.setAttribute('aria-busy', String(pairedReading));
    pairedStateNode.textContent = pairedMessages[pairedState] || pairedMessages.unavailable;
    overview.update(report ? [sourceAdapter(report)] : [], pairedReport);
    paired.setLoading(pairedReading);
    paired.render(pairedReport, pairedState);
  }

  function clearPrivate() {
    generation++;
    pairedGeneration++;
    reading = false;
    pairedReading = false;
    report = null;
    pairedReport = null;
    requestOwner = null;
    pairedRequestOwner = null;
    if (connector && !connector.isDisposed()) connector.dispose();
    if (pairedConnector && !pairedConnector.isDisposed()) pairedConnector.dispose();
    state = authenticationFailed ? 'authentication_failed' :
      enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
    pairedState = authenticationFailed ? 'authentication_failed' :
      enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') :
      'transport_unavailable';
    render();
  }

  function ownsRequest(owner, signal) {
    return owner !== null && owner.generation === generation &&
      !signal?.aborted && !disposed && active && access.isUnlocked() &&
      access.getToken() === owner.token;
  }

  function ownsPairedRequest(owner, signal) {
    return owner !== null && owner.generation === pairedGeneration &&
      !signal?.aborted && !disposed && active && access.isUnlocked() &&
      access.getToken() === owner.token;
  }

  function transportFor(endpoint, getOwner, owns) {
    return ({signal}) => {
      const owner = getOwner();
      if (!owns(owner, signal)) return Promise.resolve(new Response(null, {status: 503}));
      return fetchImpl(endpoint, {
        method: 'GET',
        headers: {accept: 'application/json', authorization: 'Bearer ' + owner.token},
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal
      }).then(response => {
        if ((response.status === 401 || response.status === 403) &&
            owns(owner, signal)) {
          authenticationFailed = true;
          access.lock();
        }
        return response;
      });
    };
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
    if (!connector) connector = createConnector({
      enabled,
      transport: transportFor(SPOT_PAPER_REPORT_ENDPOINT,
        () => requestOwner, ownsRequest)
    });

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
        authenticationFailed = true;
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

  async function readPaired() {
    if (disposed || !active) return;
    if (!enabled) {
      pairedReport = null;
      pairedState = 'transport_unavailable';
      render();
      return;
    }
    if (!access.isUnlocked() || !access.getToken()) {
      pairedReport = null;
      pairedState = 'locked';
      render();
      return;
    }
    if (pairedReading || pairedConnector?.isBusy()) return;
    if (pairedConnector?.isDisposed()) pairedConnector = null;
    if (!pairedConnector) pairedConnector = createPairedConnector({
      enabled,
      transport: transportFor(SPOT_PAPER_PAIRED_REPORT_ENDPOINT,
        () => pairedRequestOwner, ownsPairedRequest)
    });

    const owner = {generation: ++pairedGeneration, token: access.getToken()};
    pairedRequestOwner = owner;
    pairedReading = true;
    pairedState = 'loading';
    render();
    try {
      const result = await pairedConnector.read();
      if (!ownsPairedRequest(owner) || !access.isUnlocked()) return;
      pairedReading = false;
      if (result.status === 'AUTH_REQUIRED') {
        authenticationFailed = true;
        access.lock();
        return;
      }
      if (result.status === 'AVAILABLE' && result.report) {
        pairedReport = result.report;
        pairedState = 'available';
      } else {
        pairedReport = null;
        pairedState = ({
          TRANSPORT_UNAVAILABLE: 'transport_unavailable',
          NOT_FOUND: 'not_found',
          IDENTITY_MISMATCH: 'identity_mismatch',
          UNSUPPORTED_SCHEMA: 'unsupported_schema',
          UNSUPPORTED_IDENTITY: 'unsupported_identity'
        })[result.status] || 'unavailable';
        if (result.status === 'REJECTED') pairedState = 'rejected';
      }
      render();
    } catch {
      if (owner.generation !== pairedGeneration || disposed || !active) return;
      pairedReading = false;
      pairedReport = null;
      pairedState = 'unavailable';
      render();
    } finally {
      if (pairedRequestOwner === owner) pairedRequestOwner = null;
    }
  }

  const onClick = () => { void read(); };
  const onPairedClick = () => { void readPaired(); };
  refresh.addEventListener('click', onClick);
  pairedRefresh.addEventListener('click', onPairedClick);
  const unregister = access.registerReader(clearPrivate);
  const unsubscribe = access.subscribe(change => {
    if (disposed) return;
    if (change?.status === 'locked' || change?.status === 'checking') {
      clearPrivate();
    } else if (change?.status === 'unlocked') {
      authenticationFailed = false;
      state = enabled ? 'ready' : 'missing';
      pairedState = enabled ? 'ready' : 'transport_unavailable';
      render();
      if (active && enabled && !pairedReport && !pairedReading) {
        void readPaired();
      }
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
        pairedState = enabled ? (access.isUnlocked() ? 'ready' : 'locked') :
          'transport_unavailable';
        render();
        if (enabled && access.isUnlocked() && !pairedReport) void readPaired();
      }
    },
    refresh: read,
    refreshPaired: readPaired,
    dispose() {
      if (disposed) return;
      active = false;
      clearPrivate();
      disposed = true;
      unregister();
      unsubscribe();
      refresh.removeEventListener('click', onClick);
      pairedRefresh.removeEventListener('click', onPairedClick);
      connector?.dispose();
      pairedConnector?.dispose();
      overview.dispose();
      paired.dispose();
      controls.remove();
      pairedControls.remove();
      overviewRoot.replaceChildren();
      pairedRoot.replaceChildren();
    }
  });
}
