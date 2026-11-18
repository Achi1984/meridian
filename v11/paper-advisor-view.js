import {appAccess} from './app-access.js?v=B16-M11-FIX17';

const NUMBER = new Intl.NumberFormat('de-AT', {maximumFractionDigits: 8});
const PERCENT = new Intl.NumberFormat('de-AT', {maximumFractionDigits: 2});
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
  const executions = {
    PAPER_BUY: 'Paper-Kauf ausgeführt', PAPER_SELL: 'Paper-Verkauf ausgeführt',
    HOLD: 'Keine Order', POSITION_UNCHANGED: 'Position unverändert',
    NO_FRESH_BOOK: 'Orderbuch veraltet', DECISION_WINDOW_EXPIRED: 'Entscheidungsfenster verpasst',
    INSUFFICIENT_ASK_SIZE: 'Angebotsvolumen zu gering', INSUFFICIENT_BID_SIZE: 'Nachfragevolumen zu gering'
  };
  const reasons = {
    DECISION_WINDOW_EXPIRED: 'Entscheidungsfenster verpasst',
    MARKET_UNAVAILABLE: 'Marktdaten fehlen', DAY_CLOSE: 'Handelstag beendet'
  };
  const hero = add(content, 'div', '');
  hero.className = 'advisor-headline';
  const signal = add(hero, 'div', '');
  add(signal, 'small', 'Entscheidung');
  add(signal, 'h3', actions[report.last.action] || report.last.action);
  const execution = add(signal, 'p', executions[report.last.execution] || report.last.execution);
  if (reasons[report.last.reason] && report.last.execution === 'HOLD') {
    execution.textContent += ' · ' + reasons[report.last.reason];
  }
  const balance = add(hero, 'div', '');
  add(balance, 'small', 'Modellkonto');
  const equity = report.arms.model.equityEur;
  add(balance, 'strong', equity === null ? 'Ausstehend' : EURO.format(equity));

  const table = add(content, 'table', '');
  table.className = 'advisor-accounts';
  const head = add(add(table, 'thead', ''), 'tr', '');
  for (const title of ['Konto', 'Wert', 'Seit Start']) add(head, 'th', title).scope = 'col';
  const body = add(table, 'tbody', '');
  for (const [key, label] of Object.entries(labels)) {
    const value = report.arms[key].equityEur;
    const row = add(body, 'tr', '');
    add(row, 'th', label).scope = 'row';
    add(row, 'td', value === null ? 'Ausstehend' : EURO.format(value));
    const pnl = value === null ? null : Math.round((value - 1000) * 100) / 100;
    const cell = add(row, 'td', pnl === null ? '—' : (pnl > 0 ? '+' : '') + EURO.format(pnl || 0));
    if (pnl) cell.className = pnl > 0 ? 'advisor-gain' : 'advisor-loss';
  }
  const old = root.querySelector('.advisor-detail');
  const restoreFocus = old && old.querySelector('summary') === doc.activeElement;
  const detail = add(content, 'details', '');
  detail.className = 'advisor-detail';
  detail.open = Boolean(old?.open);
  const toggle = add(detail, 'summary', 'Begründung und Kennzahlen');
  const inside = add(detail, 'div', '');
  add(inside, 'p', reasons[report.last.reason] || report.last.reason);
  const meta = add(inside, 'dl', '');
  fact(meta, 'Entscheidung', DATE.format(new Date(report.last.at)));
  if (audit) {
    fact(meta, 'Geschlossene Trades', audit.closedModelTrades);
    fact(meta, 'Größter Rückgang', PERCENT.format(audit.maxObservedDrawdownPct) + ' %');
    fact(meta, 'API-Verbrauch (geschätzt)', NUMBER.format(audit.modeledApiUsd) + ' / ' + audit.apiBudgetUsd + ' USD');
    fact(meta, 'Offene Kostenreserve', NUMBER.format(audit.unresolvedReserveUsd) + ' USD');
  }
  fact(meta, 'API-Kosten in Euro', report.apiCostEur === null ? 'Unbekannt' : EURO.format(report.apiCostEur));
  fact(meta, 'Modell', report.model);
  for (const [key, label] of Object.entries(labels)) {
    const arm = report.arms[key];
    add(inside, 'h4', label);
    const list = add(inside, 'dl', '');
    fact(list, 'Cash', EURO.format(arm.cashEur));
    fact(list, 'BTC', NUMBER.format(arm.btc));
    fact(list, 'Leben', arm.lives === null ? 'Unbekannt' : NUMBER.format(arm.lives));
  }
  root.replaceChildren(content);
  if (restoreFocus) toggle.focus({preventScroll:true});
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
    delete result.dataset.asOf;
    delete status.dataset.state;
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
      result.dataset.asOf = report.asOf;
      const stale = Date.now() - Date.parse(report.asOf) > 15 * 60 * 1000;
      status.dataset.state = stale ? 'warning' : 'fresh';
      status.textContent = (stale ? 'Veralteter Datenstand · ' : 'Datenstand · ') + DATE.format(new Date(report.asOf));
    } catch {
      if (controller === request && access.isUnlocked()) {
        status.dataset.state = 'warning';
        const last = result.dataset.asOf;
        status.textContent = 'Abruf fehlgeschlagen.' + (last ? ' Letzter Stand · ' + DATE.format(new Date(last)) : '');
      }
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
