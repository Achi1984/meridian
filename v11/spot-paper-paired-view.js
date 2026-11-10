import {
  ARM_DEFINITIONS,
  MONEY_FIELDS,
  presentSpotPaperPairedReport
} from './spot-paper-paired-model.js?v=B16-M11-FIX15';

let panelSequence = 0;
const MONEY_LABELS = new Map(MONEY_FIELDS.map(([key, label]) => [key, label]));
const COUNT_LABELS = new Map([
  ['fillCount', 'Fills'],
  ['unresolvedObservations', 'Ungeklärte Beobachtungen']
]);
const STOP_REASON_LABELS = Object.freeze({
  SAMPLED_2PCT_BID_STOP: 'Stichproben-Stopp (2 % Bid)',
  SESSION_LOSS_LIMIT: 'Sitzungsverlust-Limit',
  CYCLE_LIMIT: 'Zyklus-Limit',
  DURATION_LIMIT: 'Zeitlimit',
  OPERATOR_STOP: 'Manueller Stopp',
  REQUEST_LIMIT: 'Anfragelimit',
  SHARED_FEED_FAILURE: 'Gemeinsamer Feed fehlgeschlagen',
  UNKNOWN: 'Unbekannt'
});

function stopReason(code) {
  return code ? `${STOP_REASON_LABELS[code] || 'Unbekannt'} (${code})` :
    'Unbekannt — kein Stopp-Grund';
}

function qualificationLabel(value) {
  return value === 'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED' ?
    'Strukturell abgeglichen; nicht unabhängig authentifiziert' : value;
}

function authenticationLabel(value) {
  return value === 'NOT_ESTABLISHED' ?
    'Nicht festgestellt (NOT_ESTABLISHED)' : value;
}

function freshnessLabel(freshness) {
  return freshness.status === 'UNKNOWN' ? 'Unbekannt' : freshness.status;
}

function node(document, parent, tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function field(document, parent, label, value, tone = 'tone-muted') {
  const cell = document.createElement('div');
  cell.setAttribute('style',
    'display:grid;grid-template-columns:minmax(0,1fr);gap:3px;min-width:0;overflow-wrap:anywhere');
  node(document, cell, 'strong', label);
  node(document, cell, 'span', value, tone);
  parent.append(cell);
}

function inventoryLabel(status) {
  return ({FLAT: 'Keine offene Position', OPEN: 'Position offen', UNKNOWN: 'Unbekannt'})[status] ||
    'Unbekannt';
}

function renderArm(document, parent, arm, definition, label = definition.label) {
  const card = document.createElement('section');
  card.setAttribute('aria-label', `${label} Arm`);
  card.setAttribute('style',
    'border:1px solid currentColor;border-radius:12px;padding:12px;min-width:0;overflow-wrap:anywhere');
  node(document, card, 'h3', label);
  field(document, card, 'Modell-ID', arm.modelId || 'Unbekannt');
  field(document, card, 'Virtuelles Startkapital', '1.000,00 €');
  const metrics = document.createElement('div');
  metrics.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;min-width:0');
  for (const [key, label] of MONEY_LABELS) {
    const item = arm.metrics[key];
    field(document, metrics, label, item.label, item.tone);
  }
  for (const [key, label] of COUNT_LABELS) {
    const item = arm.metrics[key];
    field(document, metrics, label, item.label, item.tone);
  }
  card.append(metrics);
  field(document, card, 'Bestand', inventoryLabel(arm.inventoryStatus));
  field(document, card, 'Handel gestoppt', arm.tradingStoppedAtLabel ||
    'Unbekannt — Stoppzeit nicht angegeben');
  field(document, card, 'Stopp-Grund', stopReason(arm.stopReason));
  parent.append(card);
}

function renderModel(root, model, document, {loading = false} = {}) {
  const isError = model.state === 'error';
  const isLoading = loading && !isError;
  root.replaceChildren();
  root.setAttribute('style',
    'box-sizing:border-box;display:grid;gap:12px;min-width:0;max-width:100%;padding:12px;overflow-wrap:anywhere');
  root.setAttribute('role', 'region');
  const heading = node(document, root, 'h2', 'Gepaarter Paper-Vergleich · BTC/EUR');
  heading.id = `spot-paper-paired-heading-${++panelSequence}`;
  root.setAttribute('aria-labelledby', heading.id);
  if (model.syntheticFixture) {
    node(document, root, 'p',
      'SYNTHETIC FIXTURE · nur Vorschau, keine Produktionsdaten.', 'caption');
  }
  node(document, root, 'p',
    'Drei virtuelle Arme mit je 1.000,00 € · virtuelles Gesamtkapital 3.000,00 €.',
    'caption');
  node(document, root, 'p',
    `Paar: ${model.identity?.pair || 'Unbekannt'} · Hebel: Unbekannt — nicht im Dashboard-DTO enthalten.`,
    'caption');
  node(document, root, 'p',
    'Virtuelle Werte sind strikt von tatsächlichen Beständen getrennt; dieses Panel liest keine Kontobestände.',
    'caption');
  const status = node(document, root, 'p',
    isLoading ? 'Bericht wird geladen …' :
      model.statusLabel,
    'paired-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  root.setAttribute('data-state', isLoading ? 'loading' : model.state);

  if (!model.available) {
    node(document, root, 'p', model.state === 'error' ?
      'Fehler: gemeinsamer Bericht konnte nicht geprüft werden. Fehlende Werte bleiben unbekannt.' :
      'Kennzahlen und Identität bleiben bis zu einem gültigen Bericht unbekannt.');
    return {status: model.status};
  }

  const qualification = document.createElement('div');
  qualification.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px;min-width:0');
  field(document, qualification, 'Evidenz-Qualifikation',
    qualificationLabel(model.qualification));
  field(document, qualification, 'Unabhängige Authentifizierung',
    authenticationLabel(model.authentication));
  field(document, qualification, 'Evidenz-Grund', model.reasonCode);
  field(document, qualification, 'Aktualität',
    `${freshnessLabel(model.freshness)} — ${model.freshness.reason}`);
  field(document, qualification, 'Run-ID', model.identity.runId);
  if (model.identity.modelPairId) {
    field(document, qualification, 'Modellpaar-ID', model.identity.modelPairId);
  }
  if (model.trendActivityDiagnostic) {
    const diagnostic = model.trendActivityDiagnostic;
    field(document, qualification, '5-Minuten-Trend-Aktivität',
      `${diagnostic.completedRoundTripCount}/${diagnostic.requiredCompletedRoundTrips} abgeschlossene Rundreisen · ` +
      `${elapsed(diagnostic.observedCoverageMs)} von 24 Std. · ${diagnostic.status} · ` +
      `Fenster vollständig: ${diagnostic.completeWindow ? 'ja' : 'nein'} · ` +
      `erzwungene Trades: ${diagnostic.forcedTrades ? 'ja' : 'nein'} · ` +
      `Verlängerung: ${diagnostic.deadlineExtensionAllowed ? 'ja' : 'nein'} · ` +
      `Profitabilität: ${diagnostic.profitability}`);
  }
  field(document, qualification, 'Datenzeitpunkt · Bewertung in Europe/Wien',
    model.timing.valuationAtLabel || 'Unbekannt — Bewertungszeitpunkt fehlt');
  root.append(qualification);

  const timing = document.createElement('div');
  timing.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px;min-width:0');
  field(document, timing, 'Angeforderte Abdeckung', elapsed(model.timing.requestedDurationMs));
  field(document, timing, 'Beobachtete gemeinsame Abdeckung',
    model.timing.observedCoverageLabel || 'Unbekannt — OBSERVED_COVERAGE_UNAVAILABLE');
  field(document, timing, 'Tatsächlich verstrichene Laufzeit',
    model.timing.actualElapsedLabel || 'Unbekannt — ACTUAL_ELAPSED_UNAVAILABLE');
  field(document, timing, 'Run-Stoppzeit · Europe/Wien',
    model.timing.runStoppedAtLabel || 'Unbekannt — RUN_STOP_TIME_UNAVAILABLE');
  field(document, timing, 'Abgeschlossene Zyklen',
    model.timing.completedCycles === null ? 'Unbekannt — COMPLETED_CYCLES_UNAVAILABLE' :
      String(model.timing.completedCycles));
  field(document, timing, 'Versuchte Zyklen',
    model.timing.attemptedCycles === null ? 'Unbekannt — ATTEMPTED_CYCLES_UNAVAILABLE' :
      String(model.timing.attemptedCycles));
  field(document, timing, 'Run-Stopp-Grund', stopReason(model.timing.stopReason));
  root.append(timing);

  const cards = document.createElement('div');
  cards.setAttribute('style',
    'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;min-width:0');
  for (const definition of ARM_DEFINITIONS) {
    renderArm(document, cards, model.arms[definition.id], definition,
      definition.id === 'challenger' ? model.challengerLabel : definition.label);
  }
  root.append(cards);

  const deltas = document.createElement('section');
  deltas.setAttribute('aria-label', 'Vergleichsdifferenzen');
  node(document, deltas, 'h3', 'Differenzen · gemeinsame Bewertung');
  if (model.deltaStatus !== 'AVAILABLE') {
    node(document, deltas, 'p',
      `Differenzen nicht verfügbar — ${model.deltaReason || 'DELTA_UNAVAILABLE'}`);
  }
  field(document, deltas, 'Challenger minus Baseline · Netto-PnL',
    model.deltas.challengerMinusBaseline.netPnl.label,
    model.deltas.challengerMinusBaseline.netPnl.tone);
  field(document, deltas, 'Baseline minus Cash · Netto-PnL',
    model.deltas.baselineMinusCash.netPnl.label,
    model.deltas.baselineMinusCash.netPnl.tone);
  field(document, deltas, 'Challenger minus Cash · Netto-PnL',
    model.deltas.challengerMinusCash.netPnl.label,
    model.deltas.challengerMinusCash.netPnl.tone);
  field(document, deltas, 'Auswertungsentscheidung', model.decision);
  root.append(deltas);

  field(document, root, 'Modellgebühren',
    `${model.assumptions.feeBpsPerSide} bp Gebühr und ${model.assumptions.slippageBpsPerSide} bp Slippage je Seite; Sätze nicht verifiziert.`);
  node(document, root,
    'p', 'Gebuchte Gebühren und modellierter Slippage werden separat ausgewiesen und nicht erneut vom Netto-PnL abgezogen. 8-Stunden-Sample und Stichproben-Drawdown sind begrenzte Evidenz, keine Aussage über künftige Performance. Kein Gewinner- oder Profitabilitäts-Badge.',
    'caption');
  return {status: model.status};
}

function elapsed(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) return 'Unbekannt';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms % 3_600_000 / 60_000);
  const seconds = Math.floor(ms % 60_000 / 1000);
  const parts = [];
  if (hours) parts.push(`${hours} Std.`);
  if (minutes) parts.push(`${minutes} Min.`);
  if (seconds || parts.length === 0) parts.push(`${seconds} Sek.`);
  return parts.join(' ');
}

export function renderSpotPaperPaired(root, input, document = root?.ownerDocument,
  {state = 'idle', ...options} = {}) {
  if (!root || !document) return null;
  return renderModel(root, presentSpotPaperPairedReport(input, {state}), document, options);
}
