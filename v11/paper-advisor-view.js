import {appAccess} from './app-access.js?v=B16-M11-FIX16';

const NUMBER = new Intl.NumberFormat('de-AT', {maximumFractionDigits: 8});
const EURO = new Intl.NumberFormat('de-AT', {style: 'currency', currency: 'EUR'});
const DATE = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'medium', timeStyle: 'long', timeZone: 'Europe/Vienna'
});
const labels = {model: 'Modellbot', reference: 'Referenzstrategie', cash: 'Euro halten'};
const text = value => typeof value === 'string' && value.trim().length > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const timestamp = value => text(value) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function validAdvisorReport(report) {
  if (report?.schema !== 'MERIDIAN_ADVISOR_V1' || !timestamp(report.asOf) ||
      !text(report.model) || !timestamp(report.last?.at) ||
      ![report.last.action, report.last.reason, report.last.execution].every(text) ||
      !(report.apiCostEur === null || nonnegative(report.apiCostEur))) return false;
  return Object.keys(labels).every(key => {
    const arm = report.arms?.[key];
    return arm && nonnegative(arm.cashEur) && nonnegative(arm.btc) &&
      [arm.equityEur, arm.lives].every(value => value === null || nonnegative(value));
  });
}

export function renderAdvisorReport(root, report) {
  const doc = root.ownerDocument;
  const content = doc.createDocumentFragment();
  function add(parent, tag, value) {
    const node = doc.createElement(tag);
    node.textContent = value;
    parent.append(node);
    return node;
  }
  function fact(list, label, value) {
    add(list, 'dt', label);
    add(list, 'dd', value);
  }
  add(content, 'h3', report.last.action);
  const meta = add(content, 'dl', '');
  fact(meta, 'Entscheidung', DATE.format(new Date(report.last.at)));
  fact(meta, 'Grund', report.last.reason);
  fact(meta, 'Paper-Ausführung', report.last.execution);
  fact(meta, 'Modell', report.model);
  fact(meta, 'API-Kosten', report.apiCostEur === null ? 'Unbekannt' : EURO.format(report.apiCostEur));
  const cards = add(content, 'div', '');
  cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:1rem';
  for (const [key, label] of Object.entries(labels)) {
    const arm = report.arms[key];
    const card = add(cards, 'section', '');
    add(card, 'h4', label);
    const list = add(card, 'dl', '');
    fact(list, 'Leben', arm.lives === null ? 'Unbekannt' : NUMBER.format(arm.lives));
    fact(list, 'Eigenkapital', arm.equityEur === null ? 'Bewertung ausstehend' : EURO.format(arm.equityEur));
    fact(list, 'Cash', EURO.format(arm.cashEur));
    fact(list, 'BTC', NUMBER.format(arm.btc));
  }
  root.replaceChildren(content);
}

export function mountAdvisor(root, access = appAccess) {
  if (!root) return;
  const fileInput = root.querySelector('[data-advisor-file]');
  const status = root.querySelector('[data-advisor-status]');
  const result = root.querySelector('[data-advisor-result]');
  let generation = 0;
  function clear() {
    generation++;
    fileInput.value = '';
    result.replaceChildren();
    status.textContent = 'Kein Bericht geladen.';
  }
  access.subscribe(state => { if (state.status !== 'unlocked') clear(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    clear();
    if (!file || !access.isUnlocked()) return;
    if (file.size > 256 * 1024) {
      status.textContent = 'Die Berichtsdatei überschreitet 256 KiB.';
      return;
    }
    const current = generation;
    try {
      const report = JSON.parse(await file.text());
      if (current !== generation || !access.isUnlocked()) return;
      if (!validAdvisorReport(report)) throw new Error('invalid report');
      renderAdvisorReport(result, report);
      status.textContent = 'Datenstand ' + DATE.format(new Date(report.asOf));
    } catch {
      if (current === generation) status.textContent = 'Datei unlesbar oder kein gültiger Meridian-Modellbericht.';
    }
  });
}

if (typeof document !== 'undefined') mountAdvisor(document.getElementById('paper-advisor'));
