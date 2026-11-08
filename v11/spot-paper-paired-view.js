import {
  ARM_DEFINITIONS,
  presentSpotPaperPairedReport
} from './spot-paper-paired-model.js?v=B16-M11-FIX14';

let panelSequence = 0;

function duration(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Unbekannt';
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const parts = [];
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  return parts.join(' ');
}

function node(document, parent, tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function dateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ?
    `${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC'
    }).format(date)} UTC` : 'Unbekannt';
}

function statusLabel(status) {
  switch (status) {
    case 'RUNNING': return 'RUNNING · Lauf läuft';
    case 'INTERRUPTED': return 'INTERRUPTED · Lauf unterbrochen';
    case 'VERIFIED_COMPLETE': return 'VERIFIED_COMPLETE · Abschluss geprüft';
    default: return 'UNKNOWN · Status unbekannt';
  }
}

function freshnessLabel(freshness) {
  switch (freshness.status) {
    case 'FRESH':
    case 'WITHIN_DISPLAY_POLICY': return 'Aktuell gemäß Anzeigegrenze';
    case 'STALE': return 'Veraltet';
    default: return 'Unbekannt';
  }
}

function field(document, parent, label, metric) {
  const cell = document.createElement('div');
  cell.setAttribute('style',
    'display:grid;grid-template-columns:minmax(0,1fr);gap:3px;min-width:0;overflow-wrap:anywhere');
  node(document, cell, 'strong', label);
  const value = node(document, cell, 'span', metric.label, metric.tone);
  if (metric.value === null) {
    value.setAttribute('aria-label', `${label}: ${metric.label}`);
  }
  parent.append(cell);
}

function renderArm(document, parent, arm, definition) {
  const card = document.createElement('section');
  card.setAttribute('aria-label', `${definition.label} Arm`);
  card.setAttribute('style',
    'border:1px solid currentColor;border-radius:12px;padding:12px;min-width:0;overflow-wrap:anywhere');
  node(document, card, 'h3', definition.label);
  node(document, card, 'p', 'Virtuelles Startkapital: 1.000,00 €');
  node(document, card, 'p', `Run-ID: ${arm.runId || 'Unbekannt — Arm-Run-ID fehlt'}`);
  const metrics = document.createElement('div');
  metrics.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;margin:0');
  for (const [key, label] of [
    ['netEquityCents', 'Eigenkapital netto'],
    ['netPnlCents', 'Netto-PnL'],
    ['feesCents', 'Gebühren'],
    ['turnoverCents', 'Umsatz'],
    ['trades', 'Trades'],
    ['exposureCents', 'Exposure'],
    ['sampledDrawdownCents', 'Stichproben-Drawdown']
  ]) field(document, metrics, label, arm.metrics[key]);
  card.append(metrics);
  node(document, card, 'p', `Position: ${arm.positionStatus}`);
  parent.append(card);
}

function renderModel(root, model, document, options = {}) {
  root.replaceChildren();
  root.setAttribute('style',
    'box-sizing:border-box;display:grid;gap:12px;min-width:0;max-width:100%;padding:12px;overflow-wrap:anywhere');
  root.setAttribute('role', 'region');
  const heading = node(document, root, 'h2', 'Gepaarter Paper-Vergleich · BTC/EUR');
  heading.id = `spot-paper-paired-heading-${++panelSequence}`;
  root.setAttribute('aria-labelledby', heading.id);
  if (options.preview === true) {
    node(document, root,
      'p', 'SYNTHETIC FIXTURE · nur Vorschau, keine Produktionsdaten.', 'caption');
  }
  node(document, root, 'p',
    'Drei getrennte virtuelle Arme mit je 1.000,00 € · virtuelles Gesamtkapital 3.000,00 €.',
    'caption');
  node(document, root, 'p',
    `Feed: ${model.feed?.pair || 'BTC/EUR'} · ${model.feed?.shared ?
      'gemeinsamer Feed bestätigt' :
      `gemeinsamer Feed unbekannt${model.feed?.reason ? ` — ${model.feed.reason}` : ''}`} · ${
      model.feed?.noLeverage ? 'ohne Hebelwirkung bestätigt' : 'Hebelstatus unbekannt'}`,
    'caption');
  node(document, root,
    'p', 'Echte Bestände: nicht Teil dieses Panels; es werden keine Kontobestände gelesen.',
    'caption');
  const status = node(document, root, 'p',
    options.loading === true ? 'Bericht wird geladen …' :
      model.available ? `${statusLabel(model.status)}${
        model.reason ? ` — ${model.reason}` : ''}` :
        `UNKNOWN · ${model.reason}`, 'paired-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  root.setAttribute('data-state', options.loading === true ? 'loading' :
    model.available ? model.status.toLowerCase() : model.state);

  if (!model.available) {
    node(document, root, 'p', options.loading === true ?
      'Berichtsdaten werden für das Panel vorbereitet.' :
      model.state === 'error' ?
        'Fehler: Bericht konnte nicht validiert werden. Fehlende Werte bleiben unbekannt.' :
        'Keine Berichtsdaten verbunden. Fehlende Werte bleiben unbekannt.');
    return {status: model.status};
  }

  const identity = document.createElement('div');
  identity.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px;margin:0');
  field(document, identity, 'Run-ID', model.identity.runId ?
    {label: model.identity.runId, value: model.identity.runId, tone: 'tone-muted'} :
    {label: 'Unbekannt — Run-ID fehlt', value: null, tone: 'tone-muted'});
  field(document, identity, 'Datenzeitpunkt', model.observedAt ?
    {label: dateTime(model.observedAt), value: model.observedAt, tone: 'tone-muted'} :
    {label: 'Unbekannt — Datenzeitpunkt fehlt', value: null, tone: 'tone-muted'});
  field(document, identity, 'Evidenz-Aktualität', {
    label: `${freshnessLabel(model.freshness)}${model.freshness.reason ?
      ` — ${model.freshness.reason}` : ''}`,
    value: model.freshness.status,
    tone: model.freshness.status === 'STALE' ? 'tone-danger' : 'tone-muted'
  });
  const coverage = model.coverage.actualDurationMs === null ?
    `Unbekannt — ${model.coverage.reason || 'Abdeckungswert fehlt'}` :
    `${duration(model.coverage.actualDurationMs)} von 8 Std. angefordert`;
  field(document, identity, 'Tatsächliche Abdeckung · angefordert 8 Std.', {
    label: coverage,
    value: model.coverage.actualDurationMs,
    tone: 'tone-muted'
  });
  root.append(identity);

  const cards = document.createElement('div');
  cards.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;min-width:0');
  for (const definition of ARM_DEFINITIONS) {
    renderArm(document, cards, model.arms[definition.id], definition);
  }
  root.append(cards);

  const comparison = document.createElement('section');
  comparison.setAttribute('aria-label', 'Vergleichsdifferenzen');
  node(document, comparison, 'h3', 'Differenzen');
  if (!model.comparison.comparable) {
    node(document, comparison, 'p',
      `Nicht angezeigt · ${model.comparison.reason}`);
  } else {
    field(document, comparison, 'Challenger minus Baseline · Netto-PnL',
      model.comparison.deltas.challengerVsBaseline);
    field(document, comparison, 'Cash minus Baseline · Netto-PnL',
      model.comparison.deltas.cashVsBaseline);
  }
  root.append(comparison);
  node(document, root,
    'p', 'Gebühren und Slippage sind modellierte Kosten, keine Börsenabrechnung. Ein einzelner 8-Stunden-Sample belegt keine künftige Performance. Es gibt keine Gewinner- oder Profitabilitätswertung.',
    'caption');
  return {status: model.status};
}

export function renderSpotPaperPaired(root, dto, document = root?.ownerDocument, options = {}) {
  if (!root || !document) return null;
  const model = presentSpotPaperPairedReport(dto, options);
  return renderModel(root, model, document, options);
}
