import {appAccess} from './app-access.js?v=B16-M11-FIX15';
import {mountSpotPaperBotOverview} from './spot-paper-bot-overview-controller.js?v=B16-M11-FIX15';
import {mountSpotPaperPairedPanel} from './spot-paper-paired-controller.js?v=B16-M11-FIX15';
import {SPOT_PAPER_REPORT_ENDPOINT} from './spot-paper-cockpit-controller.js?v=B16-M11-FIX15';
import {createSpotPaperReportConnector} from './spot-paper-report-connector.js?v=B16-M11-FIX15';
import {
  createSpotPaperPairedReportConnector,
  SPOT_PAPER_PAIRED_REPORT_ENDPOINT
} from './spot-paper-paired-report-connector.js?v=B16-M11-FIX15';
import {
  createSpotPaperPairedProgressConnector,
  SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT
} from './spot-paper-paired-progress-connector.js?v=B16-M11-FIX15';
import {
  SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY,
  SPOT_PAPER_PAIRED_PROGRESS_STALE_AFTER_MS
} from './spot-paper-paired-progress-config.js?v=B16-M11-FIX15';

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
const progressMessages = Object.freeze({
  locked: 'Gesperrt. Vor dem Abruf den App-Zugang öffnen.',
  authentication_failed: 'Authentifizierung fehlgeschlagen. Bitte App-Zugang erneut öffnen.',
  ready: 'Kein Checkpoint abgerufen; Kennzahlen bleiben unbekannt.',
  loading: 'Der freigegebene Paper-Checkpoint wird einmalig gelesen.',
  available: 'Beobachteter Checkpoint geladen; dies belegt keinen aktuellen Lauf.',
  stale: 'Checkpoint-Bewertung ist älter als die konfigurierte Frischegrenze.',
  not_found: 'Kein Checkpoint veröffentlicht; Kennzahlen bleiben unbekannt.',
  unavailable: 'Der Checkpoint ist derzeit nicht verfügbar.',
  rejected: 'Der Checkpoint konnte nicht validiert werden.',
  identity_mismatch: 'Die Checkpoint-Identität stimmt nicht mit der freigegebenen Identität überein.'
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
  createProgressConnector = createSpotPaperPairedProgressConnector,
  progressExpectedIdentity = SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY,
  progressStaleAfterMs = SPOT_PAPER_PAIRED_PROGRESS_STALE_AFTER_MS,
  progressEnabled = true,
  now = Date.now,
  pairedStatus = null
} = {}) {
  if (!overviewRoot || !pairedRoot || !document || !access ||
      typeof access.getToken !== 'function' ||
      typeof access.isUnlocked !== 'function' ||
      typeof access.registerReader !== 'function' ||
      typeof access.subscribe !== 'function' ||
      typeof fetchImpl !== 'function' ||
      typeof createConnector !== 'function' ||
      typeof createPairedConnector !== 'function' ||
      typeof createProgressConnector !== 'function' ||
      typeof progressEnabled !== 'boolean' ||
      typeof now !== 'function' ||
      !Number.isSafeInteger(progressStaleAfterMs) || progressStaleAfterMs < 0) {
    throw new TypeError('Paper report workspace dependencies are invalid');
  }

  const overview = mountSpotPaperBotOverview(overviewRoot, {document});
  const paired = mountSpotPaperPairedPanel(pairedRoot, {
    dto: null, expectedIdentity: progressExpectedIdentity, document
  });
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
  const progressRefresh = node(document, pairedControls, 'button',
    'Paper-Checkpoint manuell prüfen');
  progressRefresh.type = 'button';
  progressRefresh.setAttribute('style', 'min-height:44px;max-width:100%;white-space:normal');
  const progressStateNode = node(document, pairedControls, 'p');
  progressStateNode.setAttribute('role', 'status');
  progressStateNode.setAttribute('aria-live', 'polite');
  progressStateNode.setAttribute('aria-atomic', 'true');

  let connector = null;
  let pairedConnector = null;
  let progressConnector = null;
  let report = null;
  let pairedReport = null;
  let progressSnapshot = null;
  let state = enabled ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
  let pairedState = enabled ? (access.isUnlocked() ? 'ready' : 'locked') :
    'transport_unavailable';
  let progressState = enabled && progressEnabled ?
    (access.isUnlocked() ? 'ready' : 'locked') :
    'unavailable';
  let active = false;
  let disposed = false;
  let reading = false;
  let pairedReading = false;
  let progressReading = false;
  let generation = 0;
  let pairedGeneration = 0;
  let progressGeneration = 0;
  let requestOwner = null;
  let pairedRequestOwner = null;
  let progressRequestOwner = null;
  let authenticationFailed = false;

  function render() {
    if (disposed) return;
    status.textContent = messages[state] || messages.missing;
    refresh.disabled = !enabled || !active || !access.isUnlocked() || reading;
    refresh.setAttribute('aria-busy', String(reading));
    pairedRefresh.disabled = !enabled || !active || !access.isUnlocked() || pairedReading;
    pairedRefresh.setAttribute('aria-busy', String(pairedReading));
    progressRefresh.disabled = !enabled || !progressEnabled || !active || !access.isUnlocked() ||
      progressReading;
    progressRefresh.setAttribute('aria-busy', String(progressReading));
    pairedStateNode.textContent = pairedMessages[pairedState] || pairedMessages.unavailable;
    progressStateNode.textContent = progressMessages[progressState] ||
      progressMessages.unavailable;
    overview.update(report ? [sourceAdapter(report)] : [], pairedReport,
      progressSnapshot, progressExpectedIdentity);
    paired.setLoading(pairedReading);
    paired.render(pairedReport, pairedState, progressSnapshot ?
      {...progressSnapshot, status: progressState.toUpperCase()} :
      {status: progressState.toUpperCase(), progress: null, ageMs: null},
    progressExpectedIdentity);
  }

  function clearPrivate() {
    generation++;
    pairedGeneration++;
    progressGeneration++;
    reading = false;
    pairedReading = false;
    progressReading = false;
    report = null;
    pairedReport = null;
    progressSnapshot = null;
    requestOwner = null;
    pairedRequestOwner = null;
    progressRequestOwner = null;
    if (connector && !connector.isDisposed()) connector.dispose();
    if (pairedConnector && !pairedConnector.isDisposed()) pairedConnector.dispose();
    if (progressConnector && !progressConnector.isDisposed()) progressConnector.dispose();
    state = authenticationFailed ? 'authentication_failed' :
      enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') : 'missing';
    pairedState = authenticationFailed ? 'authentication_failed' :
      enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') :
      'transport_unavailable';
    progressState = authenticationFailed ? 'authentication_failed' :
      enabled && active ? (access.isUnlocked() ? 'ready' : 'locked') : 'unavailable';
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
  function ownsProgressRequest(owner, signal) {
    return owner !== null && owner.generation === progressGeneration &&
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

  async function readProgress() {
    if (disposed || !active) return;
    if (!enabled || !progressEnabled) {
      progressSnapshot = null;
      progressState = 'unavailable';
      render();
      return;
    }
    if (!access.isUnlocked() || !access.getToken()) {
      progressSnapshot = null;
      progressState = 'locked';
      render();
      return;
    }
    if (progressReading || progressConnector?.isBusy()) return;
    if (progressConnector?.isDisposed()) progressConnector = null;
    if (!progressConnector) progressConnector = createProgressConnector({
      enabled,
      expectedIdentity: progressExpectedIdentity,
      now,
      staleAfterMs: progressStaleAfterMs,
      transport: transportFor(SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT,
        () => progressRequestOwner, ownsProgressRequest)
    });

    const owner = {generation: ++progressGeneration, token: access.getToken()};
    progressRequestOwner = owner;
    progressReading = true;
    progressState = 'loading';
    render();
    try {
      const result = await progressConnector.read();
      if (!ownsProgressRequest(owner) || !access.isUnlocked()) return;
      progressReading = false;
      if (result.status === 'AUTH_REQUIRED') {
        authenticationFailed = true;
        access.lock();
        return;
      }
      if (['AVAILABLE', 'STALE'].includes(result.status) && result.progress) {
        progressSnapshot = result;
        progressState = result.status === 'STALE' ? 'stale' : 'available';
      } else {
        progressSnapshot = null;
        progressState = ({
          NOT_FOUND: 'not_found',
          REJECTED: 'rejected',
          IDENTITY_MISMATCH: 'identity_mismatch'
        })[result.status] || 'unavailable';
      }
      render();
    } catch {
      if (owner.generation !== progressGeneration || disposed || !active) return;
      progressReading = false;
      progressSnapshot = null;
      progressState = 'unavailable';
      render();
    } finally {
      if (progressRequestOwner === owner) progressRequestOwner = null;
    }
  }

  const onClick = () => { void read(); };
  const onPairedClick = () => { void readPaired(); };
  const onProgressClick = () => { void readProgress(); };
  refresh.addEventListener('click', onClick);
  pairedRefresh.addEventListener('click', onPairedClick);
  progressRefresh.addEventListener('click', onProgressClick);
  const unregister = access.registerReader(clearPrivate);
  const unsubscribe = access.subscribe(change => {
    if (disposed) return;
    if (change?.status === 'locked' || change?.status === 'checking') {
      clearPrivate();
    } else if (change?.status === 'unlocked') {
      authenticationFailed = false;
      state = enabled ? 'ready' : 'missing';
      pairedState = enabled ? 'ready' : 'transport_unavailable';
      progressState = enabled && progressEnabled ? 'ready' : 'unavailable';
      render();
      if (active && enabled && !pairedReport && !pairedReading) {
        void readPaired();
      }
      if (active && enabled && progressEnabled && !progressReading) void readProgress();
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
        progressState = enabled && progressEnabled ?
          (access.isUnlocked() ? 'ready' : 'locked') : 'unavailable';
        render();
        if (enabled && access.isUnlocked() && !pairedReport) void readPaired();
        if (enabled && progressEnabled && access.isUnlocked()) void readProgress();
      }
    },
    refresh: read,
    refreshPaired: readPaired,
    refreshProgress: readProgress,
    dispose() {
      if (disposed) return;
      active = false;
      clearPrivate();
      disposed = true;
      unregister();
      unsubscribe();
      refresh.removeEventListener('click', onClick);
      pairedRefresh.removeEventListener('click', onPairedClick);
      progressRefresh.removeEventListener('click', onProgressClick);
      connector?.dispose();
      pairedConnector?.dispose();
      progressConnector?.dispose();
      overview.dispose();
      paired.dispose();
      controls.remove();
      pairedControls.remove();
      overviewRoot.replaceChildren();
      pairedRoot.replaceChildren();
    }
  });
}
