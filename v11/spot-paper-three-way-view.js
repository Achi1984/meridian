// Read-only rendering for the offline three-way research model.
let sequence = 0;
const LABELS = Object.freeze({baseline: 'Baseline', challenger: 'Challenger', rangePullback: 'Range-Pullback', cash: 'Cash'});
function node(document, parent, tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}
function metric(value) {
  if (value?.value === null || value?.value === undefined) return 'Unbekannt';
  return `${value.value} ct`;
}
function field(document, parent, label, value) {
  const cell = document.createElement('div');
  node(document, cell, 'strong', label);
  node(document, cell, 'span', value);
  parent.append(cell);
}
function renderArm(document, parent, name, arm) {
  const card = document.createElement('section');
  card.setAttribute('aria-label', `${LABELS[name]} Research-Arm`);
  card.setAttribute('style', 'border:1px solid currentColor;border-radius:12px;padding:12px;min-width:0;overflow-wrap:anywhere');
  node(document, card, 'h3', LABELS[name]);
  field(document, card, 'Strategie-ID', arm.strategyId || 'Unbekannt');
  field(document, card, 'Netto-Eigenkapital', metric(arm.finalNetEquityCents));
  field(document, card, 'Netto-PnL realisiert', metric(arm.realizedPnlCents));
  field(document, card, 'Netto-PnL unrealisiert', metric(arm.unrealizedPnlCents));
  field(document, card, 'Fills / Round Trips', `${metric(arm.fillCount)} / ${metric(arm.completedRoundTripCount)}`);
  field(document, card, 'Stichproben-Drawdown', metric(arm.maxSampledEquityDrawdownCents));
  field(document, card, 'Bestand', arm.positionStatus || 'Unbekannt');
  parent.append(card);
}
export function renderSpotPaperThreeWay(root, model, document = root?.ownerDocument) {
  if (!root || !document) return {status: 'UNKNOWN'};
  root.replaceChildren();
  root.setAttribute('role', 'region');
  const heading = node(document, root, 'h2', 'Drei-Wege-Research');
  heading.id = `spot-paper-three-way-heading-${++sequence}`;
  root.setAttribute('aria-labelledby', heading.id);
  if (!model?.available) {
    node(document, root, 'p', 'Drei-Wege-Report unbekannt oder nicht verfügbar.');
    return {status: 'UNKNOWN'};
  }
  node(document, root, 'p', 'Research-only · Profitabilität nicht bewertet', 'research-only');
  node(document, root, 'p', `Status: ${model.status} · Aktualität: ${model.freshness.status}`);
  const cards = document.createElement('div');
  cards.setAttribute('style', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;min-width:0');
  for (const name of Object.keys(LABELS)) renderArm(document, cards, name, model.arms?.[name] || {});
  root.append(cards);
  return {status: model.status};
}
