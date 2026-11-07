import {presentSpotPaperCockpit} from './spot-paper-cockpit-model.js?v=B16-M11-FIX13';

const views = new WeakMap();

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
  const text = node(document, cell, 'span', value);
  if (tone) text.className = tone;
  parent.append(cell);
}

function amountValue(value) {
  return value.label;
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ?
    `${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC'
    }).format(date)} UTC` : 'Unbekannt';
}

function duration(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return 'Unbekannt';
  let seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  const parts = [];
  if (days) parts.push(`${days} Tg.`);
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  const millisecondsPart = milliseconds % 1000;
  if (millisecondsPart) parts.push(`${millisecondsPart} ms`);
  return parts.join(' ');
}

function durationStatus(status) {
  return status === 'FULL_REQUESTED_DURATION' ? 'vollständig' :
    status === 'PARTIAL_BOUNDED_DURATION' ? 'teilweise' : 'unbekannt';
}

function inventoryStatus(status) {
  return status === 'OPEN_UNRESOLVED_AT_TERMINAL' ? 'Offen, am Ende ungelöst' :
    status === 'FLAT' ? 'Keine offene Position' : 'Unbekannt';
}

function freshnessStatus(status) {
  return status === 'STALE' ? 'Veraltet' :
    status === 'WITHIN_DISPLAY_POLICY' ? 'Innerhalb der Anzeigegrenze' : 'Unbekannt';
}

function createView(root, document) {
  root.replaceChildren();
  root.className = 'card paper-cockpit spot-paper-cockpit';
  root.setAttribute('style', 'min-width:0;max-width:100%;overflow-wrap:anywhere');
  const heading = node(document, root, 'h2', 'BTC/EUR Paper – echte Marktdaten, simulierte Trades');
  heading.id = 'spot-paper-cockpit-heading';
  root.setAttribute('aria-labelledby', heading.id);
  node(document, root, 'p', 'Nur lesend · keine Start-, Stopp-, Order- oder Handelsaktionen.', 'caption');
  const controls = node(document, root, 'div');
  const refresh = node(document, controls, 'button', 'BTC/EUR Paper manuell laden / aktualisieren');
  refresh.type = 'button';
  const status = node(document, root, 'p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const report = node(document, root, 'div');
  const fixture = document.createElement('details');
  fixture.className = 'card card-muted spot-paper-fixture';
  node(document, fixture, 'summary', 'Offline-Vorschau · keine Reportdaten');
  const fixtureContent = node(document, fixture, 'div');
  node(document, fixtureContent, 'p',
    'Diese Vorschau enthält keine Laufdaten; sie ist nicht mit einem Paper-Run verbunden. Fehlende Werte bleiben unbekannt.');
  node(document, fixtureContent, 'p',
    'Die historische BTC/EUR-Abstimmung und der separate Signal-Replay sind keine laufende Beobachtung oder aktuelle Marktdaten.', 'caption');
  root.append(fixture);
  return {refresh, status, report, fixture};
}

function renderReport(reportRoot, dto, document, options) {
  const model = presentSpotPaperCockpit(dto, options);
  reportRoot.replaceChildren();
  if (!model.available) {
    node(document, reportRoot, 'p',
      'Kein freigegebener BTC/EUR-Paper-Report verbunden. Snapshot und Kennzahlen sind unbekannt; fehlende Daten sind nicht null.');
    return;
  }
  const summary = document.createElement('div');
  summary.className = 'trust-grid';
  field(document, summary, 'Snapshot', 'Abgeschlossen (begrenzt)');
  field(document, summary, 'Paper-Lauf',
    model.duration.requestedMs === 14_400_000 ? '4 Stunden' : '1 Stunde');
  field(document, summary, 'Abgeschlossen am', timestamp(model.snapshot.completedAt));
  field(document, summary, 'Aktualität', freshnessStatus(model.freshness.status));
  reportRoot.append(summary);

  const amounts = document.createElement('div');
  amounts.className = 'trust-grid';
  field(document, amounts, 'Startguthaben', amountValue(model.startingBalance));
  field(document, amounts, 'Bargeld', amountValue(model.cash));
  field(document, amounts, 'Eigenkapital', amountValue(model.equity));
  field(document, amounts, 'Realisierter Gewinn/Verlust', amountValue(model.realizedPnl), model.realizedPnl.tone);
  field(document, amounts, 'Unrealisierter Gewinn/Verlust', amountValue(model.unrealizedPnl), model.unrealizedPnl.tone);
  field(document, amounts, 'Gebühren', amountValue(model.fees));
  reportRoot.append(amounts);

  const trades = document.createElement('div');
  trades.className = 'trust-grid';
  field(document, trades, 'Käufe', String(model.buys));
  field(document, trades, 'Verkäufe', String(model.sells));
  field(document, trades, 'Ausführungen', String(model.fills));
  field(document, trades, 'Offene Position', inventoryStatus(model.inventory.status));
  field(document, trades, 'Bestand', model.inventory.quantitySat === null ?
    'Unbekannt' : `${model.inventory.quantitySat} sat`);
  reportRoot.append(trades);
  const durationPct = (model.duration.coverage * 100).toLocaleString('de-DE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  node(document, reportRoot, 'p',
    `Tatsächliche Dauer: ${duration(model.duration.elapsedMs)} von ${duration(model.duration.requestedMs)} (${durationPct} %; ${durationStatus(model.duration.status)}).`, 'caption');
  node(document, reportRoot, 'p',
    `Abdeckung: ${model.coverage.acceptedObservations} akzeptierte Beobachtungen von ${model.coverage.observations} · ${model.coverage.dataGaps} Datenlücken · ${model.coverage.requests} Anfragen.`, 'caption');
  node(document, reportRoot, 'p',
    'Abgeschlossener Snapshot; kein Nachweis eines laufenden Workers. Eine offene Position bleibt ausgewiesen und wird nicht automatisch geschlossen.', 'caption');
  const technical = document.createElement('details');
  technical.className = 'card card-muted spot-paper-technical-details';
  node(document, technical, 'summary', 'Technische Details und Verifikation');
  const identity = document.createElement('div');
  identity.className = 'trust-grid';
  field(document, identity, 'Run-ID', model.identity.runId);
  field(document, identity, 'Quell-SHA', model.identity.sourceSha);
  field(document, identity, 'Workflow-SHA', model.identity.workflowSha);
  field(document, identity, 'Workflow-Run-ID', model.identity.workflowRunId);
  field(document, identity, 'Workflow-Run-Nummer', String(model.identity.workflowRunNumber));
  field(document, identity, 'Workflow-Versuch', String(model.identity.workflowRunAttempt));
  field(document, identity, 'Profil', model.identity.profileId);
  field(document, identity, 'Modell / Markt', `${model.identity.model} · ${model.identity.pair}`);
  field(document, identity, 'Dispatch-Identität', 'PASS');
  technical.append(identity);
  node(document, technical, 'p',
    `Verifikation: Terminal-Readback ${model.verification.terminalReadback} · Assessment ${model.verification.assessment} · Assessment-Signal-Replay ${model.verification.assessmentSignalReplay} · separater Replay ${model.verification.signalReplay} · Profitabilität ${model.verification.profitability}.`, 'caption');
  node(document, technical, 'p',
    `Beendigungsgrund ${model.snapshot.stopReason} · Laufzeitstatus ${model.duration.status} · Snapshot-Status ${model.snapshot.status}.`, 'caption');
  reportRoot.append(technical);
}

export function renderSpotPaperCockpit(root, dto, document = root?.ownerDocument, options = {}) {
  if (!root || !document) return null;
  let view = views.get(root);
  if (!view || !Array.from(root.children || []).includes(view.status)) {
    view = createView(root, document);
    views.set(root, view);
  }
  view.refresh.hidden = typeof options.onRefresh !== 'function';
  view.refresh.disabled = options.loading === true;
  view.refresh.setAttribute('aria-disabled', String(options.loading === true));
  view.refresh.setAttribute('aria-busy', String(options.loading === true));
  view.refresh.setAttribute('style',
    'min-width:44px;min-height:44px;max-width:100%;padding:10px 12px;white-space:normal;overflow-wrap:anywhere');
  view.refresh.onclick = typeof options.onRefresh === 'function' ? options.onRefresh : null;
  view.status.textContent = options.message || 'Status des BTC/EUR-Berichts unbekannt.';
  root.setAttribute('data-state', options.state || 'unavailable');
  view.fixture.hidden = presentSpotPaperCockpit(dto, options).available;
  view.fixture.open = options.preserveFixtureState === true && view.fixture.open;
  renderReport(view.report, dto, document, options);
  return {status: presentSpotPaperCockpit(dto, options).available ? 'REPORT_PRESENTED' : 'UNAVAILABLE'};
}
