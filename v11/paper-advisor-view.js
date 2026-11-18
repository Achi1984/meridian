import {appAccess} from './app-access.js?v=B16-M11-FIX17';

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

export function renderAdvisorReport(root, report, audit) {
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
  const actions = {BUY: 'Kaufen', SELL: 'Verkaufen', HOLD: 'Halten'};
  add(content, 'h3', actions[report.last.action] || report.last.action);
  const meta = add(content, 'dl', '');
  fact(meta, 'Entscheidung', DATE.format(new Date(report.last.at)));
  fact(meta, 'Grund', report.last.reason === 'DECISION_WINDOW_EXPIRED'
    ? 'Entscheidungsfenster verpasst' : report.last.reason);
  fact(meta, 'Paper-Ausführung', report.last.execution);
  fact(meta, 'Modell', report.model);
  if (audit) {
    fact(meta, 'Geschlossene Trades', audit.closedModelTrades);
    fact(meta, 'Größter Rückgang', NUMBER.format(audit.maxObservedDrawdownPct) + ' %');
    fact(meta, 'API-Verbrauch (geschätzt)', NUMBER.format(audit.modeledApiUsd) + ' / ' + audit.apiBudgetUsd + ' USD');
    fact(meta, 'Offene Kostenreserve', NUMBER.format(audit.unresolvedReserveUsd) + ' USD');
  }
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
    fact(list, 'Ergebnis seit Start', arm.equityEur === null ? 'Ausstehend' : EURO.format(arm.equityEur - 1000));
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
  const doc = root.ownerDocument;
  let timer, controller, manual = false;
  let active = false;
  function stop() {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  }
  async function refresh() {
    stop();
    if (!active || doc.hidden || manual || !access.isUnlocked()) return;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch('https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/paper-advisor', {
        headers: {authorization: 'Bearer ' + access.getToken()}, credentials: 'omit',
        cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: request.signal
      });
      if (!response.ok) throw new Error('Report unavailable');
      const {report, pilotAudit} = await response.json();
      if (controller !== request || !access.isUnlocked()) return;
      if (!validAdvisorReport(report) || !pilotAudit ||
          !['closedModelTrades','maxObservedDrawdownPct','modeledApiUsd','apiBudgetUsd','unresolvedReserveUsd'].every(key => nonnegative(pilotAudit[key]))) {
        throw new Error('Invalid report');
      }
      renderAdvisorReport(result, report, pilotAudit);
      const stale = Date.now() - Date.parse(report.asOf) > 15 * 60 * 1000;
      status.textContent = (stale ? 'Veralteter Datenstand · ' : 'Datenstand · ') + DATE.format(new Date(report.asOf));
    } catch {
      if (controller === request && access.isUnlocked()) status.textContent = 'Live-Daten derzeit nicht abrufbar.';
    } finally {
      clearTimeout(timeout);
      if (controller === request) {
        controller = null;
        timer = setTimeout(refresh, 60000);
      }
    }
  }
  access.subscribe(state => {
    if (state.status === 'unlocked') refresh();
    else { stop(); manual = false; clear(); }
  });
  doc.addEventListener('visibilitychange', refresh);
  root.querySelector('[data-advisor-live]').addEventListener('click', () => {
    manual = false;
    clear();
    refresh();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    clear();
    if (!file || !access.isUnlocked()) return;
    if (file.size > 256 * 1024) {
      status.textContent = 'Die Berichtsdatei überschreitet 256 KiB.';
      return;
    }
    stop();
    manual = true;
    const current = generation;
    try {
      const report = JSON.parse(await file.text());
      if (current !== generation || !access.isUnlocked()) return;
      if (!validAdvisorReport(report)) throw new Error('invalid report');
      renderAdvisorReport(result, report);
      status.textContent = 'Lokaler Bericht · ' + DATE.format(new Date(report.asOf));
    } catch {
      if (current === generation) status.textContent = 'Datei unlesbar oder kein gültiger Meridian-Modellbericht.';
    }
  });
  return {setActive(value) {
    if (active === value) return;
    active = value;
    refresh();
  }};
}

export function createAdvisorSection(section) {
  const document = section.ownerDocument;
  const label = document.createElement('label');
  label.textContent = 'Lokalen Paperbericht öffnen ';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.setAttribute('data-advisor-file', '');
  label.append(input);
  const status = document.createElement('p');
  status.setAttribute('data-advisor-status', '');
  status.setAttribute('role', 'status');
  status.textContent = 'Kein Bericht geladen.';
  const result = document.createElement('div');
  result.setAttribute('data-advisor-result', '');
  result.style.overflowWrap = 'anywhere';
  const live = document.createElement('button');
  live.type = 'button';
  live.textContent = 'Live-Daten aktualisieren';
  live.setAttribute('data-advisor-live', '');
  section.append(status, result, live, label);
  return mountAdvisor(section);
}
