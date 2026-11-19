import {appAccess} from './app-access.js?v=B19-M11';

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

const breakoutReasons = {
  WAIT_FIRST_CLOSE: 'Erste 10-Minuten-Kerze steht aus',
  CANDLES_UNAVAILABLE: 'Kerzendaten fehlen oder sind veraltet',
  NO_COMPRESSION: 'Stundenspanne zu breit',
  WAIT_BREAKOUT: 'Schlusskurs noch unter oder am Stundenhoch',
  BREAKOUT: 'Ausbruch über das Stundenhoch',
  POSITION_OPEN: 'Position innerhalb der Haltedauer',
  TIME_EXIT: 'Haltedauer von 60 Minuten erreicht',
  DAY_CLOSE: 'Tagesschluss', HOUR_USED: 'Einstieg dieser Stunde bereits genutzt'
};

const usdReasons = {
  ...breakoutReasons, ...reasons,
  COST_FILTER: 'Die Handelsspanne deckt die geschätzten Handelskosten nicht.',
  EXECUTION_COST_FILTER: 'Die Gewinnschwelle liegt beim aktuellen Orderbuch außerhalb der Handelsspanne.',
  PILOT_BUDGET_LIMIT: 'Modellbudget für weitere Anfragen ausgeschöpft.'
};

function renderUsdRound(root, round) {
  const doc = root.ownerDocument;
  const table = doc.createElement('table');
  table.className = 'advisor-accounts';
  const usd = new Intl.NumberFormat('de-AT', {style: 'currency', currency: 'USD'});
  function row(parent, values, header) {
    const tr = parent.insertRow();
    values.forEach((value, i) => {
      const cell = doc.createElement(header || !i ? 'th' : 'td');
      if (header || !i) cell.scope = header ? 'col' : 'row';
      cell.textContent = value;
      tr.append(cell);
    });
    return tr;
  }
  const title = doc.createElement('h3');
  title.textContent = 'BTC/USD · 1.000 USD je Paper-Konto';
  table.createCaption().textContent = 'Gemeinsamer Start · ' + DATE.format(new Date(round.start));
  row(table.createTHead(), ['Strategie', 'Kontowert', 'Netto', 'Abschlüsse', 'Aktive Tage', 'Max. Rückgang'], true);
  const body = table.createTBody();
  for (const [key, name] of Object.entries({v3:'V3', v4:'V4 · Ausbruch', cash:'USD halten', btcHold:'BTC halten'})) {
    const arm = round.arms[key];
    const tr = row(body, [name, Number.isFinite(arm.equityUsd) ? usd.format(arm.equityUsd) : '—',
      Number.isFinite(arm.netUsd) ? usd.format(arm.netUsd) : '—', arm.closed, arm.activeDays,
      nonnegative(arm.maxDrawdownPct) ? PERCENT.format(arm.maxDrawdownPct) + ' %' : '—']);
    if (Number.isFinite(arm.netUsd) && Math.round(100 * Math.abs(arm.netUsd)) > 0) {
      tr.cells[2].className = arm.netUsd > 0 ? 'advisor-gain' : 'advisor-loss';
    }
  }
  const scroll = doc.createElement('div');
  scroll.style.overflowX = 'auto';
  scroll.append(table);
  const costs = doc.createElement('small');
  costs.textContent = 'Handelskosten im Kontowert enthalten.';
  if (Number.isFinite(round.modelCostUsd) && Number.isFinite(round.modelReserveUsd)) {
    costs.textContent += ' V3-Modellkosten separat: ' + usd.format(round.modelCostUsd) +
      ' · Offene Reserve: ' + usd.format(round.modelReserveUsd);
  }
  const slot = doc.createElement('h4');
  const time = doc.createElement('time');
  time.dateTime = round.at;
  time.textContent = DATE.format(new Date(round.at));
  slot.append('Letzte Entscheidung · ', time);
  const decisions = doc.createElement('dl');
  for (const [key, name] of [['v3', 'V3'], ['v4', 'V4']]) {
    const {action, reason, execution} = round.arms[key];
    const decision = doc.createElement('dt');
    decision.textContent = name + ' · ' + (Object.hasOwn(actions, action) ? actions[action] : 'Keine Angabe');
    const detail = doc.createElement('dd');
    const details = [];
    if (action === 'BUY' || action === 'SELL') {
      details.push(Object.hasOwn(executions, execution) ? executions[execution] : 'Ausführung nicht gemeldet');
    }
    if (text(reason)) details.push(Object.hasOwn(usdReasons, reason) ? usdReasons[reason] : reason);
    detail.textContent = details.join(' · ') || 'Begründung fehlt';
    decisions.append(decision, detail);
  }
  root.replaceChildren(title, scroll, costs, slot, decisions);
}

export function renderAdvisorReport(root, report, audit, decisions, trades, krakenUsd, comparison) {
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
  function skippedReason(reason) {
    if (reason === 'MODEL_KEY_UNAVAILABLE') return 'Modellzugang fehlt';
    if (reason.startsWith('MODEL_UNAVAILABLE')) return 'Modellantwort fehlt';
    if (reason === 'MARKET_UNAVAILABLE' || reason === 'DECISION_WINDOW_EXPIRED') return reasons[reason];
    return null;
  }
  function costFilter(row) {
    if (row.action !== 'HOLD' || row.execution !== 'HOLD') return null;
    if (row.reason === 'Stundenbandbreite deckt die Handelskosten nicht.') return 'Kostenfilter vor Modellaufruf';
    if (row.reason === 'Aktuelles Orderbuch deckt die Gewinnschwelle im Stundenband nicht.') return 'Kostenfilter nach Kaufsignal';
    return null;
  }
  function actionLabel(row) {
    return skippedReason(row.reason) ? 'Ausgesetzt' : actions[row.action] || row.action;
  }
  const hero = add(content, 'div', '');
  hero.className = 'advisor-headline';
  const signal = add(hero, 'div', '');
  add(signal, 'small', 'Entscheidung');
  const decision = add(signal, 'h3', actionLabel(report.last));
  const skipped = skippedReason(report.last.reason);
  decision.dataset.action = skipped ? 'SKIPPED' : report.last.action;
  const execution = add(signal, 'p', executions[report.last.execution] || report.last.execution);
  if (skipped) execution.textContent = skipped;
  else if (costFilter(report.last)) execution.textContent = costFilter(report.last);
  else if (reasons[report.last.reason] && report.last.execution === 'HOLD') {
    execution.textContent += ' · ' + reasons[report.last.reason];
  }
  if (skipped ||
      ['NO_FRESH_BOOK', 'DECISION_WINDOW_EXPIRED'].includes(report.last.execution)) {
    execution.className = 'advisor-caution';
  }
  const balance = add(hero, 'div', '');
  add(balance, 'small', 'Modellkonto');
  const equity = report.arms.model.equityEur;
  add(balance, 'strong', equity === null ? 'Ausstehend' : EURO.format(equity));

  const reference = report.arms.reference.equityEur;
  if (equity !== null && reference !== null) {
    const cents = Math.round(equity * 100) - Math.round(reference * 100);
    const comparison = cents === 0 ? 'Gleichauf mit Referenz' :
      EURO.format(Math.abs(cents) / 100) + (cents > 0 ? ' vor Referenz' : ' hinter Referenz');
    add(balance, 'p', comparison);
  }

  if (audit) {
    const valid = Number.isFinite(krakenUsd?.close) && krakenUsd.close > 0 &&
      timestamp(krakenUsd.at) && Date.parse(krakenUsd.at) === Math.floor(Date.parse(report.last.at) / 600000) * 600000;
    const price = valid ? PERCENT.format(krakenUsd.close) + ' USD' : 'Kurs fehlt';
    add(content, 'p', 'Kraken BTC/USD · ' + price + ' · Minutenschluss vor Entscheidung');
  }

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
  if (audit && comparison) {
    const pair = add(content, 'table', '');
    pair.className = 'advisor-accounts';
    const models = [['V1',comparison?.v1], ['V2',comparison?.v2], ['V3',comparison?.v3]].filter(([,arm]) => arm);
    const caption = models.length === 3 ? 'V1, V2 und V3' : comparison?.v3 ? 'V1 und V3' : 'V1 und V2';
    add(pair, 'caption', caption + ' · gemeinsamer Vergleich');
    if (comparison?.v1 && models.length >= 2 && timestamp(comparison.at) && timestamp(comparison.start)) {
      const header = add(add(pair,'thead',''),'tr','');
      for (const label of ['Modell','Entscheidung','Kontowert','Seit Vergleichsstart']) add(header,'th',label).scope='col';
      const body = add(pair,'tbody','');
      const latestSlot = Math.floor(Date.parse(report.last.at) / 600000) * 600000;
      const sameSlot = Date.parse(comparison.at) === latestSlot;
      for (const [label, arm] of models) {
        const row = add(body,'tr','');
        add(row,'th',label).scope='row';
        const decision = add(row,'td',arm.action === 'SKIPPED' ? 'Ausgesetzt' : actions[arm.action] || 'Unbekannt');
        if (arm.action === 'SKIPPED') {
          const causes = {
            CANDLES: 'Kurskerzen fehlen oder sind ungültig', BOOK: 'Orderbuch fehlt oder ist unbrauchbar',
            BOOK_TIME: 'Zeitstempel im Orderbuch ungültig oder zu alt',
            RATE_LIMIT: 'Kraken-Anfragelimit erreicht', REQUEST: 'Kraken-Abruf fehlgeschlagen',
            MARKET: 'Marktdaten fehlen', MODEL_ACCESS: 'Modellzugang fehlt',
            MODEL: 'Modellantwort fehlt', WINDOW: 'Entscheidungsfenster abgelaufen'
          };
          const fallback = label === 'V1' && sameSlot ? skippedReason(report.last.reason) : null;
          decision.append(doc.createElement('br'));
          add(decision,'small', (Object.hasOwn(causes, arm.skipCause) && causes[arm.skipCause]) || fallback || 'Grund nicht gemeldet');
        } else if (arm.action === 'BUY' || arm.action === 'SELL') {
          const baselineExecution = label === 'V1' && sameSlot && arm.action === report.last.action
            ? report.last.execution : null;
          const outcome = arm.execution ?? baselineExecution;
          decision.append(doc.createElement('br'));
          add(decision, 'small', Object.hasOwn(executions, outcome) ? executions[outcome] : 'Ausführung nicht gemeldet');
        }
        add(row,'td',Number.isFinite(arm.equity) ? EURO.format(arm.equity) : 'Bewertung fehlt');
        const cell = add(row,'td',Number.isFinite(arm.change) ?
          (arm.change > 0 ? '+' : '') + EURO.format(arm.change) : 'Ausstehend');
        if (arm.change) cell.className = arm.change > 0 ? 'advisor-gain' : 'advisor-loss';
      }
      if (comparison.v3Pending) add(content, 'small', 'V3-Bericht für diesen Takt ausstehend.');
      if (Date.parse(comparison.at) < latestSlot) {
        add(content, 'p', 'Für den jüngsten Takt steht der gemeinsame Vergleich noch aus.');
      }
      add(content,'small','Start · '+DATE.format(new Date(comparison.start))+' · Gemeinsamer Stand · '+DATE.format(new Date(comparison.at)));
    } else {
      add(content,'small','Gemeinsamer Bericht ausstehend');
    }
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
  let historyFocus;
  function disclosure(parent, key, title) {
    const section = add(parent, 'details', '');
    section.className = 'advisor-history';
    section.dataset.key = key;
    const existing = [...root.querySelectorAll('.advisor-history')].find(node => node.dataset.key === key);
    section.open = Boolean(existing?.open);
    const summary = add(section, 'summary', title);
    if (existing && existing.firstElementChild === doc.activeElement) historyFocus = summary;
    return section;
  }
  if (audit) {
    const duel = audit.duel ?? comparison?.duel;
    const panel = disclosure(content, 'v4-duel', 'V3 gegen V4 · Paper-Vergleich');
    if (duel?.v3 && duel.v4 && duel.onlyV4 && timestamp(duel.start) && timestamp(duel.at)) {
      const money = n => Number.isFinite(n) ? EURO.format(n) : '—';
      const num = n => Number.isFinite(n) ? PERCENT.format(n) : '—';
      add(panel, 'p', DATE.format(new Date(duel.start)) + ' bis ' + DATE.format(new Date(duel.at)));
      const scroll = add(panel, 'div', '');
      scroll.style.overflowX = 'auto';
      const table = add(scroll, 'table', '');
      table.className = 'advisor-accounts';
      const head = add(add(table, 'thead', ''), 'tr', '');
      for (const title of ['Strategie', 'Netto', 'Abgeschlossene Trades', 'Netto/Trade', 'Max. Rückgang', 'Letzter Takt']) {
        add(head, 'th', title).scope = 'col';
      }
      const body = add(table, 'tbody', '');
      for (const [name, arm] of [['V3 · Paper-Bot', duel.v3], ['V4 · Ausbruch (Replay)', duel.v4]]) {
        const row = add(body, 'tr', '');
        add(row, 'th', name).scope = 'row';
        const net = add(row, 'td', money(arm.netEur));
        if (arm.netEur) net.className = arm.netEur > 0 ? 'advisor-gain' : 'advisor-loss';
        const count = Number.isSafeInteger(arm.closed) && arm.closed >= 0;
        const activity = add(row, 'td', count ? NUMBER.format(arm.closed) : '—');
        if (count && nonnegative(arm.tradesPerDay)) {
          activity.append(doc.createElement('br'));
          add(activity, 'small', num(arm.tradesPerDay) + '/Tag (hochgerechnet)');
        }
        add(row, 'td', money(arm.netPerTradeEur));
        add(row, 'td', num(arm.maxDrawdownPct) + ' %');
        const cell = add(row, 'td', executions[arm.last] || 'Keine Ausführung');
        if (arm === duel.v4 && Object.hasOwn(breakoutReasons, arm.reason)) {
          cell.append(doc.createElement('br'));
          add(cell, 'small', breakoutReasons[arm.reason]);
        }
      }
      const extra = duel.onlyV4;
      add(panel, 'p', 'V4-Trades, während derer V3 durchgehend ohne Position und Order blieb · ' + extra.closed + ' abgeschlossen · ' +
        money(extra.netEur) + ' netto · davon bereits abgezogen: ' + money(extra.costsEur) + ' Handelskosten');
      if (duel.missingSlots > 0) {
        add(panel, 'p', 'Fehlende 10-Minuten-Takte: ' + duel.missingSlots +
          '. In diesen Lücken können V3-Abschlüsse und V4-Signale fehlen.');
      }
      add(panel, 'small', 'Handelskosten enthalten. Modellkosten separat.');
    } else {
      add(panel, 'p', 'Für V3 und V4 liegt noch kein gemeinsamer Vergleichsbericht vor.');
    }
  }
  if (Array.isArray(decisions)) {
    const modelCount = decisions.filter(row => row.reason !== 'DAY_CLOSE' && !skippedReason(row.reason) && !costFilter(row)).length;
    const title = decisions.length ? 'Verlauf · Modell entschied bei ' + modelCount + ' von ' +
      decisions.length + (decisions.length === 1 ? ' Zeitpunkt' : ' Zeitpunkten') : 'Verlauf · Keine Zeitpunkte verfügbar';
    const history = disclosure(content, 'history', title);
    for (const row of decisions) {
      const skipped = skippedReason(row.reason);
      const action = actionLabel(row);
      const reason = skipped || reasons[row.reason] || row.reason;
      const summary = DATE.format(new Date(row.at)) + ' · ' + action + ' · ' +
        (skipped ? reason : costFilter(row) || executions[row.execution] || row.execution);
      const entry = disclosure(history, row.at, summary);
      if (skipped) entry.classList.add('advisor-skipped');
      add(entry, 'p', reason);
    }
  }
  if (Array.isArray(trades)) {
    const section = disclosure(content, 'trades', 'Abgeschlossene Paper-Trades · letzte 24 Stunden');
    if (!trades.length) add(section, 'p', 'Kein vollständiges Kauf-Verkauf-Paar im verfügbaren Verlauf.');
    for (const trade of trades) {
      const minutes = Math.round((Date.parse(trade.sellAt) - Date.parse(trade.buyAt)) / 60000);
      const line = add(section, 'p', 'Kauf ' + DATE.format(new Date(trade.buyAt)) +
        ' · Verkauf ' + DATE.format(new Date(trade.sellAt)) + ' · ' + minutes + ' Min. · ');
      const amount = add(line, 'strong', (trade.netEur > 0 ? '+' : '') + EURO.format(trade.netEur) + ' netto');
      amount.className = trade.netEur > 0 ? 'advisor-gain' : trade.netEur < 0 ? 'advisor-loss' : '';
    }
  }
  root.replaceChildren(content);
  if (restoreFocus) toggle.focus({preventScroll:true});
  historyFocus?.focus({preventScroll:true});
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
      const {report, pilotAudit, decisions, trades, krakenUsd, comparison, usdRound} = await response.json();
      if (controller !== request || !access.isUnlocked()) return;
      let asOf;
      if (usdRound?.schema === 'MERIDIAN_USD_ROUND_V1' && usdRound.pair === 'BTC/USD' &&
          timestamp(usdRound.at) && timestamp(usdRound.start)) {
        renderUsdRound(result, usdRound);
        asOf = usdRound.at;
      } else {
        if (!validAdvisorReport(report) || !pilotAudit ||
            !['closedModelTrades','maxObservedDrawdownPct','modeledApiUsd','apiBudgetUsd','unresolvedReserveUsd'].every(key => nonnegative(pilotAudit[key]))) {
          throw new Error('Invalid report');
        }
        renderAdvisorReport(result, report, pilotAudit, decisions, trades, krakenUsd, comparison);
        asOf = report.asOf;
      }
      result.dataset.asOf = asOf;
      const stale = Date.now() - Date.parse(asOf) > 15 * 60 * 1000;
      status.dataset.state = stale ? 'warning' : 'fresh';
      status.textContent = (stale ? 'Veralteter Datenstand · ' : 'Datenstand · ') + DATE.format(new Date(asOf));
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
