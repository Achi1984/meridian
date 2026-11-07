import {presentSpotPaperCockpit} from './spot-paper-cockpit-model.js?v=B16-M11-FIX12';

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
  fixture.className = 'card card-muted';
  node(document, fixture, 'summary', 'Fixture preview · keine verbundenen Live-Daten');
  const fixtureContent = node(document, fixture, 'div');
  node(document, fixtureContent, 'p',
    'Diese Vorschau enthält keine Run-Werte. Im Repository liegen kein freigegebener, übertragener Terminalreport und keine Live-Verbindung; fehlende Werte bleiben UNKNOWN.');
  node(document, fixtureContent, 'p',
    'Die historische BTC/EUR-Reconciliation und der separate Signal-Replay sind keine laufende Beobachtung oder aktuelle Marktdaten.', 'caption');
  root.append(fixture);
  return {refresh, status, report, fixture};
}

function renderReport(reportRoot, dto, document, options) {
  const model = presentSpotPaperCockpit(dto, options);
  reportRoot.replaceChildren();
  if (!model.available) {
    node(document, reportRoot, 'p',
      'Kein freigegebener BTC/EUR Paper-Report verbunden. Run status und alle Kennzahlen sind UNKNOWN; fehlende Daten sind nicht null.');
    return;
  }
  const summary = document.createElement('div');
  summary.className = 'trust-grid';
  field(document, summary, 'Snapshot', model.snapshot.status);
  field(document, summary, 'Abgeschlossen', model.snapshot.completedAt);
  field(document, summary, 'Aktualität', model.freshness.status);
  field(document, summary, 'Run ID', model.identity.runId);
  reportRoot.append(summary);

  const amounts = document.createElement('div');
  amounts.className = 'trust-grid';
  field(document, amounts, 'Starting balance', amountValue(model.startingBalance));
  field(document, amounts, 'Cash', amountValue(model.cash));
  field(document, amounts, 'Equity', amountValue(model.equity));
  field(document, amounts, 'Realized PnL', amountValue(model.realizedPnl), model.realizedPnl.tone);
  field(document, amounts, 'Unrealized PnL', amountValue(model.unrealizedPnl), model.unrealizedPnl.tone);
  field(document, amounts, 'Fees', amountValue(model.fees));
  reportRoot.append(amounts);

  const trades = document.createElement('div');
  trades.className = 'trust-grid';
  field(document, trades, 'BUY count', String(model.buys));
  field(document, trades, 'SELL count', String(model.sells));
  field(document, trades, 'Fill count', String(model.fills));
  field(document, trades, 'Open inventory', model.inventory.status);
  field(document, trades, 'Inventory quantity', model.inventory.quantitySat === null ?
    'UNKNOWN' : `${model.inventory.quantitySat} sat`);
  reportRoot.append(trades);

  const durationPct = (model.duration.coverage * 100).toFixed(2);
  node(document, reportRoot, 'p',
    `Actual duration: ${model.duration.elapsedMs} ms of ${model.duration.requestedMs} ms (${durationPct}%) · ${model.duration.status}.`, 'caption');
  node(document, reportRoot, 'p',
    `Coverage: ${model.coverage.acceptedObservations} accepted observations · ${model.coverage.observations} observations · ${model.coverage.dataGaps} data gaps · ${model.coverage.requests} requests.`, 'caption');
  node(document, reportRoot, 'p',
    `Verification: terminal readback ${model.verification.terminalReadback} · assessment ${model.verification.assessment} · assessment signal replay ${model.verification.assessmentSignalReplay} · separate replay ${model.verification.signalReplay} · profitability ${model.verification.profitability}.`, 'caption');
  node(document, reportRoot, 'p',
    `Accepted source ${model.identity.sourceSha} · workflow ${model.identity.workflowSha} · dispatch run ${model.identity.workflowRunId} attempt ${model.identity.workflowRunAttempt} (${model.identity.workflowRunNumber}).`, 'caption');
  node(document, reportRoot, 'p',
    'Abgeschlossener Report-Snapshot; kein Nachweis eines laufenden Workers. Ein offener Bestand bleibt als offen ausgewiesen und wird nicht automatisch geschlossen.', 'caption');
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
  view.status.textContent = options.message || 'BTC/EUR report status UNKNOWN.';
  root.setAttribute('data-state', options.state || 'unavailable');
  view.fixture.open = options.preserveFixtureState === true && view.fixture.open;
  renderReport(view.report, dto, document, options);
  return {status: presentSpotPaperCockpit(dto, options).available ? 'REPORT_PRESENTED' : 'UNAVAILABLE'};
}
