import {
  createSpotPaperHost8hAdapter,
  presentSpotPaperHost8h,
  SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS
} from './spot-paper-host8h-model.js?v=B16-M11-FIX14';

function node(document, parent, tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function field(document, parent, label, value, tone = '') {
  const cell = document.createElement('div');
  cell.className = 'trust-cell';
  node(document, cell, 'strong', label);
  node(document, cell, 'span', value ?? 'Unbekannt', tone);
  parent.append(cell);
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ?
    `${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium', timeStyle: 'medium'
    }).format(date)} (lokal)` : 'Unbekannt';
}

function duration(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Unbekannt';
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const milliseconds = value % 1000;
  const parts = [];
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  if (milliseconds) parts.push(`${milliseconds} ms`);
  return parts.join(' ');
}

function freshness(value) {
  if (value === 'STALE') return 'Veraltet';
  if (value === 'WITHIN_DISPLAY_POLICY') return 'Innerhalb der Anzeigegrenze';
  if (value === 'OUT_OF_ORDER') return 'Älter als die letzte Beobachtung';
  return 'Unbekannt';
}

function percent(value) {
  return value === null ? 'Unbekannt' :
    `${(value * 100).toLocaleString('de-DE', {maximumFractionDigits: 2})} %`;
}

function durationStatus(value) {
  if (value === 'FULL_REQUESTED_DURATION') return 'Vollständige Zieldauer';
  if (value === 'PARTIAL_BOUNDED_DURATION') return 'Teilweise begrenzte Dauer';
  return 'Unbekannt';
}

function inventoryStatus(value) {
  if (value === 'FLAT') return 'Keine offene Position';
  if (value === 'OPEN_PROVISIONAL') return 'Offen · Zwischenstand';
  if (value === 'OPEN_UNRESOLVED_AT_TERMINAL') return 'Am Laufende noch offen';
  return 'Unbekannt';
}

function statusText(model) {
  if (!model.available) {
    return model.status === 'IDENTITY_MISMATCH' ?
      'Identität stimmt nicht mit dem freigegebenen 8-Stunden-Profil überein.' :
      'Paper-Daten noch nicht verbunden.';
  }
  switch (model.status) {
    case 'RUNNING_OBSERVED':
      return model.metrics?.provisional ?
        'Zwischenstand des Paper-Laufs · Abschluss noch nicht geprüft.' :
        'Paper-Lauf beobachtet · noch keine geprüften Ergebnisse.';
    case 'VERIFIED_TERMINAL':
      return model.completed ? 'Lauf beendet · Abschluss geprüft.' :
        'Laufende bestätigt · Ergebnis noch nicht abschließend geprüft.';
    case 'INCOMPLETE_UNKNOWN':
      return 'Daten unvollständig · Abschluss noch nicht bestätigt.';
    case 'FAILED':
      return 'Prüfung fehlgeschlagen · kein bestätigtes Ergebnis.';
    case 'STALE':
      return 'Bericht veraltet · keine aktuelle Beobachtung.';
    case 'OUT_OF_ORDER':
      return 'Älterer Bericht verworfen · der neuere Stand bleibt maßgeblich.';
    default:
      return 'Paper-Status nicht verfügbar.';
  }
}

function renderModel(root, model, document, options = {}) {
  root.replaceChildren();
  root.className = 'card paper-cockpit spot-paper-host8h';
  root.setAttribute('style', 'min-width:0;max-width:100%;overflow-wrap:anywhere');
  const heading = node(document, root, 'h2', 'Paper-Bot · BTC/EUR');
  heading.id = 'spot-paper-host8h-heading';
  root.setAttribute('aria-labelledby', heading.id);
  node(document, root, 'p', 'Simulierter Handel · kein Echtgeld', 'caption');
  const status = node(document, root, 'p', options.message || statusText(model), model.statusTone);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  root.setAttribute('data-state', options.state || model.status?.toLowerCase() || 'unavailable');
  if (typeof options.onRefresh === 'function') {
    const refresh = node(document, root, 'button', 'Paper-Daten aktualisieren');
    refresh.type = 'button';
    refresh.disabled = options.loading === true || options.retryBlocked === true;
    refresh.setAttribute('aria-disabled', String(refresh.disabled));
    refresh.setAttribute('aria-busy', String(options.loading === true));
    refresh.setAttribute('style',
      'min-width:44px;min-height:44px;max-width:100%;padding:10px 12px;white-space:normal;overflow-wrap:anywhere');
    refresh.onclick = options.onRefresh;
  }

  const metrics = model.metrics;
  if (metrics) {
    const money = document.createElement('div');
    money.className = 'trust-grid';
    field(document, money, 'Eigenkapital', metrics.equity?.label);
    field(document, money, 'Netto-Gewinn/Verlust', metrics.totalPnl?.label, metrics.totalPnl?.tone);
    field(document, money, 'Gebuchte Modellgebühren', metrics.fees?.label);
    field(document, money, 'Offene Position', inventoryStatus(metrics.inventory.status));
    root.append(money);
    node(document, root, 'p', metrics.provisional ?
      'Zwischenstand · Ergebnisse können sich bis zum Laufende ändern.' :
      'Geprüfter Laufbericht · kein Nachweis zukünftiger Gewinne.', 'caption');
  }
  if (model.available) {
    const summary = document.createElement('div');
    summary.className = 'trust-grid';
    field(document, summary, 'Zuletzt beobachtet', timestamp(model.observedAt));
    field(document, summary, 'Aktualität', freshness(model.freshness?.status));
    if (metrics) field(document, summary, 'Tatsächliche Dauer',
      `${duration(metrics.elapsedMs)} von ${duration(SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS)}`);
    field(document, summary, 'Modus', 'BTC/EUR · 1× · nur Long');
    root.append(summary);
  } else if (!options.message) {
    node(document, root, 'p', 'Noch keine geprüften Laufdaten. Fehlende Werte bleiben unbekannt.', 'caption');
  }

  const details = document.createElement('details');
  details.className = 'card card-muted spot-paper-host8h-details';
  const disclosure = node(document, details, 'summary', 'Details zum Lauf und zur Datenquelle');
  disclosure.setAttribute('style', 'min-height:44px;padding:10px 0;box-sizing:border-box;cursor:pointer');
  if (metrics) {
    const money = document.createElement('div');
    money.className = 'trust-grid';
    field(document, money, 'Bargeld', metrics.cash?.label);
    field(document, money, 'Realisierter Gewinn/Verlust', metrics.realizedPnl?.label, metrics.realizedPnl?.tone);
    field(document, money, 'Unrealisierter Gewinn/Verlust', metrics.unrealizedPnl?.label, metrics.unrealizedPnl?.tone);
    field(document, money, 'Geschätzte Ausstiegsgebühr', metrics.estimatedExitFee?.label);
    field(document, money, 'Geschätzter Ausstiegs-Slippage', metrics.estimatedExitSlippage?.label);
    field(document, money, 'Bestand', metrics.inventory.quantitySat === null ?
      'Unbekannt' : `${metrics.inventory.quantitySat} sat`);
    details.append(money);
    node(document, details, 'p',
      'Modellannahmen je Seite: 50 bps Gebühr und 10 bps Slippage, keine verifizierten Börsenkosten. Geschätzte zukünftige Ausstiegskosten sind separat und werden nicht erneut vom PnL abgezogen.', 'caption');
    const run = document.createElement('div');
    run.className = 'trust-grid';
    field(document, run, 'Dauerstatus', durationStatus(metrics.durationStatus));
    field(document, run, 'Dauerabdeckung', percent(metrics.durationCoverage));
    field(document, run, 'Zyklen', metrics.cycleCount);
    field(document, run, 'Zyklusabdeckung', percent(metrics.cycleCoverage));
    field(document, run, 'Akzeptierte Beobachtungen', metrics.acceptedObservations);
    field(document, run, 'Akzeptierte Beobachtungsabdeckung', percent(metrics.acceptedObservationCoverage));
    field(document, run, 'Beobachtungen', metrics.observations);
    field(document, run, 'Datenlücken', metrics.dataGaps);
    field(document, run, 'Anfragen', metrics.requests);
    field(document, run, 'Fills', metrics.fills);
    field(document, run, 'Geschlossene Trades', metrics.closedTrades);
    details.append(run);
  }
  const identity = document.createElement('div');
  identity.className = 'trust-grid';
  field(document, identity, 'Quelle', model.source || 'Unbekannt');
  field(document, identity, 'Beobachtungszeit (UTC)', model.observedAt || 'Unbekannt');
  field(document, identity, 'Run-ID', model.identity?.runId);
  field(document, identity, 'Profil', model.identity?.profileId);
  field(document, identity, 'Quell-Fingerprint', model.identity?.sourceSha);
  field(document, identity, 'Modell', model.identity?.model);
  field(document, identity, 'Währung', model.identity?.currency);
  field(document, identity, 'Host-Status', model.hostStatus);
  field(document, identity, 'Assessment', model.assessmentOutcome || 'Unbekannt');
  field(document, identity, 'Stop-Grund', model.reportStopReason);
  field(document, identity, 'USD-Challenge', 'Noch nicht gestartet');
  details.append(identity);
  node(document, details, 'p',
    options.preview === true ?
      'Offline-Vorschau: Die bereitgestellten Daten sind nicht unabhängig authentifiziert.' :
      'Angezeigt wird der letzte geprüfte Bericht. Er belegt keine aktuelle Prozessgesundheit.', 'caption');
  root.append(details);
  return {status: model.status};
}

export function renderSpotPaperHost8h(root, input, document = root?.ownerDocument, options = {}) {
  if (!root || !document) return null;
  return renderModel(root, presentSpotPaperHost8h(input, options), document, options);
}

export function createSpotPaperHost8hPreview({readSnapshot} = {}) {
  const adapter = createSpotPaperHost8hAdapter({readSnapshot});
  return Object.freeze({
    async render(root, document = root?.ownerDocument, options = {}) {
      if (!root || !document) return null;
      return renderModel(root, await adapter.read(options), document, {...options, preview: true});
    }
  });
}
