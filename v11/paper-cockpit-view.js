import {
  getDemoPaperCockpitReport,
  presentPaperCockpitReport
} from './paper-cockpit-model.js?v=B16-M11-FIX11';

const unavailable = 'Nicht verfügbar';
const shown = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : 'UNKNOWN';

function node(document, parent, tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = String(value);
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function field(document, parent, label, value, className = '') {
  const cell = document.createElement('div');
  cell.className = 'trust-cell';
  node(document, cell, 'strong', label);
  node(document, cell, 'span', value, className);
  parent.append(cell);
}

function coverageText(coverage) {
  if (!coverage) return 'Coverage unknown';
  const parts = [
    `observed ${shown(coverage.observedTotal)}`,
    `total ${shown(coverage.total)}`,
    `unaccounted ${shown(coverage.unaccounted)}`
  ];
  if (coverage.sourceTruncated === true) parts.push('source truncated');
  else if (coverage.sourceTruncated === false) parts.push('source not truncated');
  else parts.push('source truncation unknown');
  if (coverage.displayTruncated === true) parts.push('display capped');
  return parts.join(' · ');
}

function evidenceCoverageText(coverage, kind) {
  if (!coverage) return `${kind} coverage: UNKNOWN.`;
  const truncated = coverage.truncated === true ? 'yes'
    : coverage.truncated === false ? 'no' : 'unknown';
  return `${kind} coverage: observed ${shown(coverage.observedRows)}, total ${shown(coverage.totalRows)}, truncated ${truncated}.`;
}

function appendList(document, parent, heading, rows, renderRow) {
  node(document, parent, 'h3', heading);
  if (rows === null) {
    node(document, parent, 'p', unavailable);
    return;
  }
  const list = document.createElement('ul');
  if (rows.length === 0) {
    node(document, list, 'li', 'No rows reported.');
  } else {
    for (const row of rows) node(document, list, 'li', renderRow(row));
  }
  parent.append(list);
}

function renderReport(root, report, document, options = {}) {
  const model = presentPaperCockpitReport(report, options);
  if (!model.available) {
    node(document, root, 'p', 'Keine Reportdaten verbunden. Run status, Evidenz, Trades, Positionen und PnL sind nicht verfügbar.');
    node(document, root, 'p', 'Ein laufender Prozess wird nicht aus einem nicht-terminalen Lock abgeleitet.');
    return false;
  }
  const summary = document.createElement('div');
  summary.className = 'trust-grid';
  field(document, summary, 'Modus', model.experiment.mode.label);
  field(document, summary, 'Lifecycle', model.experiment.status);
  field(document, summary, 'Report-Verfügbarkeit', 'DTO verfügbar · Dauerhaftigkeit nicht belegt');
  field(document, summary, 'Run ID', model.experiment.id ?? 'UNKNOWN');
  field(document, summary, 'Run window', `${model.experiment.startAt ?? 'UNKNOWN'} → ${model.experiment.endAt ?? 'UNKNOWN'}`);
  field(document, summary, 'Aktualität', model.evidence.freshness.status);
  root.append(summary);
  node(document, root, 'p', model.experiment.mode.detail, 'caption');
  node(document, root, 'p', `Liveness: NOT EVIDENCED · ${model.liveness}.`, 'caption');
  node(document, root, 'p', `Source readiness: ${model.experiment.readiness} · evidence: ${model.evidence.status} · coverage: ${model.evidence.coverage}.`, 'caption');
  node(document, root, 'p', `Observed through: ${model.evidence.observedThrough ?? 'UNKNOWN'} · freshness policy: ${options.staleAfterMs === null || options.staleAfterMs === undefined ? 'not configured' : `${options.staleAfterMs} ms (display only)`}.`, 'caption');
  const discovery = model.evidence.discovery;
  node(document, root, 'p', discovery
    ? `Discovery coverage: ${shown(discovery.observedRecords)} observed · ${shown(discovery.scoutAuditRows)} Scout rows · ${shown(discovery.unaccountedObservedRecords)} unaccounted · source truncation ${discovery.sourceTruncated === true ? 'yes' : discovery.sourceTruncated === false ? 'no' : 'unknown'}.`
    : 'Discovery coverage: UNKNOWN.', 'caption');
  node(document, root, 'p', evidenceCoverageText(model.evidence.audit, 'Audit'), 'caption');

  const counts = document.createElement('div');
  counts.className = 'trust-grid';
  field(document, counts, 'Candidates', shown(model.candidates.considered));
  field(document, counts, 'Accepted', shown(model.candidates.accepted));
  field(document, counts, 'Rejected', shown(model.candidates.rejected));
  field(document, counts, 'Unknown', shown(model.candidates.unknown));
  field(document, counts, 'Scout-audited', shown(model.candidates.audited));
  root.append(counts);
  node(document, root, 'p', `Candidate coverage: ${coverageText(model.candidates.coverage)}.`, 'caption');

  const trading = document.createElement('section');
  trading.className = 'card card-muted';
  node(document, trading, 'h3', 'Trades & fills');
  node(document, trading, 'p', model.trading.fillCount === null
    ? 'Paper entry fill count: UNKNOWN · missing evidence is not zero.'
    : `Paper entry fills evidenced: ${model.trading.fillCount}.`);
  node(document, trading, 'p', 'Trade-level detail is not included in the operator report contract.');
  node(document, trading, 'p', `Trading evidence status: ${model.trading.status}.`);
  root.append(trading);

  const pnl = document.createElement('div');
  pnl.className = 'trust-grid';
  field(document, pnl, 'Cash', model.valuation.cash.label, model.valuation.cash.tone);
  field(document, pnl, 'Realized gross PnL', model.valuation.realizedGross.label, model.valuation.realizedGross.tone);
  field(document, pnl, 'Realized net PnL', model.valuation.realizedNet.label, model.valuation.realizedNet.tone);
  field(document, pnl, 'Unrealized gross PnL', model.valuation.unrealizedGross.label, model.valuation.unrealizedGross.tone);
  field(document, pnl, 'Unrealized net PnL', model.valuation.unrealizedNet.label, model.valuation.unrealizedNet.tone);
  root.append(pnl);
  node(document, root, 'p', `Valuation: ${model.valuation.status}. Amounts are exact reported integer cents; no PnL is derived.`, 'caption');

  const positions = document.createElement('section');
  positions.className = 'card card-muted';
  node(document, positions, 'h3', 'Open positions');
  node(document, positions, 'p', `Reported position count: ${shown(model.controls.openPositionCount)}.`);
  node(document, positions, 'p', `Reported reservation count: ${shown(model.controls.reservations)}.`);
  appendList(document, positions, 'Position evidence', model.controls.openPositions, row =>
    `${row.mint ?? 'Instrument UNKNOWN'} · ${row.markStatus ?? 'mark status UNKNOWN'}`);
  if (model.controls.positionsCoverage) node(document, positions, 'p',
    `Position coverage: ${coverageText(model.controls.positionsCoverage)}.`, 'caption');
  root.append(positions);

  appendList(document, root, 'Rejection reasons', model.trading.reasons, row =>
    `${row.gate ?? 'Gate UNKNOWN'} [${row.status ?? 'UNKNOWN'}]: ${row.reason ?? unavailable}`);
  if (model.trading.reasonsCoverage) node(document, root, 'p',
    `Reason coverage: ${coverageText(model.trading.reasonsCoverage)}.`, 'caption');
  appendList(document, root, 'Stops', model.controls.stops, row =>
    `${row.code ?? row.kind ?? 'Stop UNKNOWN'} [${row.status ?? 'UNKNOWN'}]: ${row.reason ?? unavailable}`);
  appendList(document, root, 'Unresolved fills', model.unresolvedFills, row =>
    `${row.kind ?? 'Fill UNKNOWN'} [${row.status ?? 'UNKNOWN'}]: ${row.reason ?? unavailable}`);
  if (model.unresolvedFillsCoverage) node(document, root, 'p',
    `Unresolved fill coverage: ${coverageText(model.unresolvedFillsCoverage)}.`, 'caption');
  return true;
}

export function renderPaperCockpit(root, report = null, document = root?.ownerDocument, options = {}) {
  if (!root || !document) return null;
  root.replaceChildren();
  root.className = 'card paper-cockpit';
  root.setAttribute('style', 'min-width:0;max-width:100%;overflow-wrap:anywhere');
  root.setAttribute('aria-labelledby', 'paper-cockpit-heading');
  node(document, root, 'h2', 'Paper cockpit').id = 'paper-cockpit-heading';
  const readonlyLabel = node(document, root, 'p',
    'Nur lesend · keine Start-, Stopp- oder Handelsaktionen.', 'limited');
  readonlyLabel.setAttribute('style', 'max-width:100%;white-space:normal;overflow-wrap:anywhere');
  const available = renderReport(root, report, document, options);

  const demo = document.createElement('details');
  demo.className = 'card card-muted';
  const summary = node(document, demo, 'summary', 'Generated demo fixture · synthetic only');
  summary.setAttribute('aria-label', 'Generated demo fixture · synthetic only anzeigen; keine Live-Daten');
  node(document, demo, 'p', 'Das folgende Beispiel ist künstlich erzeugt und keine Beobachtung oder Produktions-Telemetrie.', 'caption');
  renderReport(demo, options.demoReport ?? getDemoPaperCockpitReport(), document);
  root.append(demo);
  return {status: available ? 'REPORT_PRESENTED' : 'UNAVAILABLE'};
}
