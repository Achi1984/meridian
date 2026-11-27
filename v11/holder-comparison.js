const api = 'https://api.github.com/repos/Achi1984/meridian/actions';
const runs = 'https://github.com/Achi1984/meridian/actions/runs/';
const micro = 1_000_000;
const stake = 20 * micro;
const fee = 50_000;
const safe = Number.isSafeInteger;

export function auditHolderReport(status, journal) {
  const c = status.holderComparison;
  if (status.ledgerVerified !== true || !['handoff','finished'].includes(status.lastEvent) ||
      c?.thresholdBps !== 2000 || c.reference !== 'C' || c.filtered !== 'H' ||
      !safe(status.startedAt) || !safe(status.updatedAt) || status.updatedAt < status.startedAt) throw Error('status');
  const seen = new Map();
  const entries = new Map();
  const filteredTrades = new Map();
  let lastExitQuoteAt = null;
  const accounts = Object.fromEntries(['C','H'].map(k => [k, {cash:1000*micro, open:new Map(), net:0, closed:0}]));
  const entryStates = {high:0, belowThreshold:0, unknown:0};
  let maxOwnerBps = null;
  let missed = 0, avoided = 0, skipped = 0, last;
  for (const line of journal.trim().split(/\r?\n/)) {
    const row = JSON.parse(line);
    if (!row.eventId || !safe(row.at)) throw Error('event');
    if (seen.has(row.eventId)) {
      if (seen.get(row.eventId) !== JSON.stringify(row)) throw Error('duplicate');
      continue;
    }
    if (!seen.size && (row.event !== 'start' || row.at !== status.startedAt)) throw Error('start');
    seen.set(row.eventId, JSON.stringify(row));
    last = row;
    if (row.event === 'entry' && row.arm === 'wave') {
      const evidence = row.holderEvidence;
      if (!evidence || !Object.hasOwn(entryStates, evidence.state)) throw Error('holder state');
      if (evidence.state !== 'unknown') {
        const {largestOwnerBps, sampledSupplyBps} = evidence;
        if (!safe(largestOwnerBps) || !safe(sampledSupplyBps) || largestOwnerBps < 0 ||
            largestOwnerBps > sampledSupplyBps || sampledSupplyBps > 10000 ||
            evidence.state !== (largestOwnerBps >= c.thresholdBps ? 'high' : 'belowThreshold')) {
          throw Error('holder measurement');
        }
        maxOwnerBps = Math.max(maxOwnerBps ?? 0, largestOwnerBps);
      }
      entryStates[evidence.state]++;
      const id = row.positionId;
      if (!safe(row.session) || !row.mint || id !== row.session + ':wave:' + row.mint ||
          !safe(row.qty) || row.qty <= 0 || row.inputRaw !== stake) throw Error('entry quote');
      const previous = entries.get(id);
      if (previous && (previous.at !== row.at || previous.qty !== row.qty ||
          previous.state !== evidence.state)) throw Error('conflicting entry');
      for (const key of ['C','H']) {
        const expected = !previous && accounts[key].cash >= stake + fee &&
          (key === 'C' || evidence.state !== 'high');
        const fills = row.fills.filter(fill => fill.account === key);
        if (fills.length !== Number(expected)) throw Error('entry admission');
      }
      entries.set(id, {at:row.at, qty:row.qty, state:evidence.state});
    }
    if (row.arm === 'wave' && ['resaleMark','exit'].includes(row.event) &&
        safe(row.usdcRaw) && row.usdcRaw > 0) lastExitQuoteAt = row.at;
    for (const fill of row.fills) {
      if (!['C','H'].includes(fill.account)) continue;
      const a = accounts[fill.account];
      const id = fill.positionId;
      if (!id || !safe(fill.qty) || fill.qty <= 0 || !safe(fill.usdcRaw) || fill.usdcRaw <= 0) throw Error('fill');
      if (fill.side === 'buy') {
        if (a.open.has(id) || row.event !== 'entry' || row.arm !== 'wave' ||
            id !== row.positionId || fill.qty !== row.qty || fill.usdcRaw !== stake) throw Error('entry fill');
        const high = row.holderEvidence.state === 'high';
        if (high && fill.account === 'H') throw Error('filter');
        if (high) {
          skipped++;
          filteredTrades.set(id, {id, net:null});
        }
        a.cash -= fill.usdcRaw + fee;
        a.open.set(id, {cost:fill.usdcRaw + fee, qty:fill.qty, high});
      } else {
        const buy = a.open.get(id);
        if (fill.side !== 'sell' || !buy || buy.qty !== fill.qty || row.arm !== 'wave' ||
            !['resaleMark','exit'].includes(row.event) || id !== row.positionId ||
            id !== row.session + ':wave:' + row.mint || row.qty !== fill.qty || row.usdcRaw !== fill.usdcRaw) throw Error('exit fill');
        const proceeds = fill.usdcRaw - fee;
        const net = proceeds - buy.cost;
        a.cash += proceeds;
        a.net += net;
        a.closed++;
        a.open.delete(id);
        if (buy.high) { filteredTrades.get(id).net = net/micro; missed += Math.max(net, 0); avoided += Math.max(-net, 0); }
      }
    }
  }
  const rows = [];
  for (const key of ['C','H']) {
    const a = accounts[key], record = status.accounts[key];
    if (record.policy !== 'fixed' || a.cash/micro !== record.cashUsdc || a.net/micro !== record.realizedUsdc ||
        a.closed !== record.closedTrades || a.open.size !== record.openPositions.length ||
        new Set(record.openPositions.map(p => p.positionId)).size !== a.open.size ||
        record.openPositions.some(p => a.open.get(p.positionId)?.qty !== p.qty)) throw Error('balance');
    const openCost = [...a.open.values()].reduce((total, position) => total + position.cost, 0);
    rows.push({net:a.net/micro, open:a.open.size, closed:a.closed, openCost:openCost/micro});
  }
  const delta = (accounts.H.net-accounts.C.net)/micro;
  if (last?.event !== status.lastEvent || last.at !== status.updatedAt || skipped !== c.skippedReferenceEntries ||
      delta !== c.realizedDeltaUsdc || Object.entries(entryStates).some(([state, count]) => count !== (c.entryStates[state] ?? 0))) throw Error('comparison');
  return {rows, filteredTrades:[...filteredTrades.values()], lastExitQuoteAt, delta, skipped, maxOwnerBps, measured:entryStates.high + entryStates.belowThreshold, unknown:entryStates.unknown, missed:missed/micro, avoided:avoided/micro,
    updatedAt:status.updatedAt, final:status.lastEvent === 'finished'};
}

export function mountHolderComparison(section, add, read, amount) {
  const card = add(section, 'section', '');
  card.className = 'solana-comparison';
  const heading = add(card, 'h3', 'Halterkonzentration · Solana');
  heading.id = 'solana-holder-heading';
  heading.tabIndex = -1;
  const live = add(card, 'p', 'Laufstatus lädt …');
  const audit = add(card, 'details', '');
  add(audit, 'summary', 'Läufe & Journal');
  add(audit, 'small', 'Filter ab 20 % Einzelanteil. Bei fehlender Messung gilt die Referenz.');
  const source = add(audit, 'a', 'Laufprotokoll öffnen');
  source.href = 'https://github.com/Achi1984/meridian/actions/workflows/holder-concentration.yml';
  const queuedLink = add(audit, 'a', '');
  queuedLink.hidden = true;
  const body = add(card, 'section', '');
  body.style.overflowWrap = 'anywhere';
  function render(report, origin) {
    body.replaceChildren();
    const date = new Date(report.updatedAt*1000).toLocaleString('de-AT', {timeZone:'Europe/Vienna'});
    add(body, 'small', (report.final ? 'Endstand' : 'Zwischenstand') + ' · ' + date + ' Wien');
    report.rows.forEach((a,i) => {
      const row = add(body,'p','');
      row.className = 'paper-metric';
      add(row,'span',i ? 'Mit Filter' : 'Referenz');
      add(row,'strong',amount(a.net)).className = a.net > 0 ? 'paper-gain' : a.net < 0 ? 'paper-loss' : '';
    });
    const info = add(body,'details','');
    add(info,'summary','Konten & Filterwirkung');
    add(info,'p',origin);
    report.rows.forEach((a,i) => add(info,'p',(i ? 'Filter' : 'Referenz') + ' · Kasse ' +
      amount(1000 + a.net - a.openCost) + ' · ' + a.closed + ' geschlossen · ' + a.open + ' offen'));
    add(info,'p','Filterdifferenz ' + amount(report.delta));
    if ('lastExitQuoteAt' in report) {
      const stamp = report.lastExitQuoteAt && new Date(report.lastExitQuoteAt*1000).toLocaleString('de-AT', {timeZone:'Europe/Vienna'});
      add(info, 'p', 'Letzter erfolgreicher Wave-Verkaufskurs im Journal · ' + (stamp || 'keiner'));
    }
    const trades = report.filteredTrades ?? [];
    const details = trades.length ? add(info, 'details', '') : null;
    if (details) add(details, 'summary', 'Ausgelassene Trades ansehen (' + trades.length + ')');
    for (const trade of trades) {
      add(details, 'p', trade.id + ' · C ' + (trade.net === null ? 'offen' : amount(trade.net) + ' realisiert'));
    }
    const maxShare = report.maxOwnerBps === null ? '' : ' · höchster gemessener Einzelanteil ' +
      (report.maxOwnerBps / 100).toLocaleString('de-AT', {maximumFractionDigits:2}) + ' %';
    add(info, 'p', 'Halterdaten bei ' + report.measured + ' von ' + (report.measured + report.unknown) +
      ' Einstiegssignalen' + maxShare);
    add(info, 'p', report.skipped + ' ausgelassene Einstiege · vermiedene Verluste ' +
      amount(report.avoided) + ' · entgangene Gewinne ' + amount(report.missed));
  }
  const comparisons = add(card, 'details', '');
  add(comparisons,'summary','Ausstiege vergleichen');
  const exits = add(comparisons, 'section', '');
  let displayedKey = '';
  let displayedAt = 0;
  let localReport = false;
  async function showPublished(runId, attempt) {
    const key = runId + '-' + attempt;
    if (localReport || key === displayedKey) return;
    const url = 'https://api.github.com/repos/Achi1984/meridian/contents/holder-' + key +
      '.json?ref=paper-dashboard-data';
    const data = await read(url, true);
    if (localReport) return;
    const h = data.holder, e = data.exits;
    if (data.source?.runId !== runId || data.source.attempt !== attempt || !h?.final ||
        !safe(h.updatedAt) || !Array.isArray(h.rows) || h.rows.length !== 2 ||
        !safe(e?.bothClosed) || !safe(e.sharedStillOpenOnEitherSide) ||
        e.sharedEntries !== e.bothClosed + e.sharedStillOpenOnEitherSide ||
        ![e.pairedFixedNetUsdc, e.pairedTrailingNetUsdc].every(Number.isFinite) ||
        (e.bothClosed >= 2 && ![e.minDeltaAfterOmittingOneUsdc, e.maxDeltaAfterOmittingOneUsdc].every(Number.isFinite))) {
      throw Error('dashboard report');
    }
    if (h.updatedAt < displayedAt) return;
    render(h, 'Lauf ' + runId + ' · Versuch ' + attempt);
    exits.replaceChildren();
    add(exits, 'strong', 'Ausstiege bei kleinen Pools');
    add(exits, 'p', e.bothClosed + ' gemeinsame Abschlüsse · ' + e.sharedStillOpenOnEitherSide + ' Paare offen');
    if (e.bothClosed > 0) add(exits, 'p', 'Netto · Fixes Ziel ' + amount(e.pairedFixedNetUsdc) +
      ' · Trailing ' + amount(e.pairedTrailingNetUsdc));
    if (e.bothClosed >= 2) {
      add(exits, 'p', 'Ohne jeweils einen Trade · Differenz Trailing minus fixes Ziel ' +
        amount(e.minDeltaAfterOmittingOneUsdc) + ' bis ' + amount(e.maxDeltaAfterOmittingOneUsdc));
      if (e.minDeltaAfterOmittingOneUsdc < 0 && e.maxDeltaAfterOmittingOneUsdc > 0) {
        add(exits, 'strong', 'Ein einzelner Trade kann die Rangfolge drehen.');
      }
    }
    const delay = e.delayedSales;
    if (delay) {
      add(exits, 'strong', 'Folgeangebot · Abfrage nach fünf Sekunden');
      add(exits, 'p', delay.quoted + ' Folgekurse bei ' + delay.sales + ' Paper-Verkäufen · ' +
        delay.unavailable + ' nicht verfügbar · ' + delay.busy + ' gleichzeitig belegt · ' + delay.missing + ' ohne Messung');
      if (delay.quoted && Number.isFinite(delay.medianResponseSeconds) && Number.isFinite(delay.maxResponseSeconds)) {
        const seconds = n => n.toLocaleString('de-AT', {maximumFractionDigits:2}) + ' s';
        add(exits, 'p', 'Zeit bis zum Folgeangebot · Median ' + seconds(delay.medianResponseSeconds) +
          ' · längste Wartezeit ' + seconds(delay.maxResponseSeconds));
      }
      if (delay.quoted) add(exits, 'p', 'Netto auf denselben Verkäufen · ursprünglich ' +
        amount(delay.originalNetUsdc) + ' · zum Folgeangebot ' + amount(delay.delayedNetUsdc) +
        ' · von Gewinn zu Verlust: ' + delay.profitToLoss);
    }
    const guard = e.confirmedLoss;
    if (guard) {
      add(exits, 'strong', 'Paper-Test · bestätigter Verlustausstieg');
      add(exits, 'p', 'Verkauf nach zwei Rückverkaufskursen mit mindestens 10 % Nettoverlust.');
      add(exits, 'p', guard.matchedClosed + ' gemeinsame Abschlüsse · Trailing ' +
        amount(guard.ordinaryNetUsdc) + ' · mit Verlustausstieg ' + amount(guard.guardedNetUsdc));
      add(exits, 'p', guard.triggered + ' Verlustausstiege · ' + guard.open + ' offen · ' +
        guard.unmatchedClosed + ' einseitige Abschlüsse · ' + guard.skipped + ' Einstiege wegen Guthaben ausgelassen');
    }
    add(exits, 'a', 'Quelllauf des Ergebnisses').href = runs + runId + '/attempts/' + attempt;
    displayedKey = key;
    displayedAt = h.updatedAt;
  }
  add(body, 'p', 'Bestätigter Endstand wird geladen.');
  const label = add(audit, 'label', 'Journal importieren ');
  const input = add(label, 'input', '');
  input.type = 'file';
  input.multiple = true;
  const notice = add(audit, 'p', '');
  notice.setAttribute('role', 'status');
  let revision = 0;
  input.addEventListener('change', async () => {
    const request = ++revision;
    try {
      const files = Array.from(input.files);
      const pair = ['status.json','events.jsonl'].map(name => files.find(f => f.name === name));
      if (pair.some(f => !f || f.size > 16*1024*1024)) throw Error('files');
      const [status, journal] = await Promise.all(pair.map(f => f.text()));
      const report = auditHolderReport(JSON.parse(status), journal);
      if (request !== revision) return;
      render(report, 'lokales Handelsjournal');
      localReport = true;
      exits.replaceChildren();
      notice.textContent = 'Beide Konten und die Filterwirkung sind abgeglichen.';
    } catch (error) {
      if (request !== revision) return;
      const messages = {
        'entry admission':'Einstieg fehlt oder widerspricht Filter bzw. verfügbarem Guthaben.',
        'entry fill':'Kaufbuchung passt nicht zum protokollierten Einstieg.',
        'exit fill':'Verkaufsbuchung passt nicht zum protokollierten Ausstieg.'
      };
      notice.textContent = 'Import fehlgeschlagen. ' +
        (messages[error.message] ?? 'Bitte Status und Journal desselben Haltertests prüfen.');
    }
  });
  let pending;
  return function refresh() {
    if (pending) return pending;
    pending = read(api + '/workflows/holder-concentration.yml/runs?branch=paper%2Fholder-token2022-forward&per_page=5').then(async feed => {
      const recent = feed.workflow_runs.filter(r => r.path === '.github/workflows/holder-concentration.yml' &&
        safe(r.id) && safe(r.run_attempt));
      const waiting = recent.filter(r => ['pending','queued','waiting','requested'].includes(r.status));
      const run = recent.find(r => r.status === 'in_progress') || waiting[0] || recent[0];
      if (!safe(run?.id) || !safe(run.run_attempt)) throw Error('run');
      const state = {in_progress:'läuft', queued:'in Warteschlange', pending:'in Warteschlange', waiting:'wartet', requested:'angefordert', success:'abgeschlossen', failure:'fehlgeschlagen',
        cancelled:'abgebrochen'}[run.conclusion || run.status] || run.status;
      live.className = run.status === 'in_progress' ? 'paper-live' : 'paper-wait';
      live.textContent = 'Versuch ' + run.run_attempt + ' · ' + state + (waiting.some(r => r.id !== run.id) ? ' · Folgelauf wartet' : '');
      source.textContent = 'Lauf ' + run.id + ' · Versuch ' + run.run_attempt;
      source.href = runs + run.id + '/attempts/' + run.run_attempt;
      const next = waiting.find(item => item.id !== run.id);
      queuedLink.hidden = !next;
      if (next) {
        queuedLink.textContent = 'In Warteschlange · Lauf ' + next.id + ' · Versuch ' + next.run_attempt;
        queuedLink.href = runs + next.id + '/attempts/' + next.run_attempt;
      }
      // A rerun shares its run ID with earlier attempts. Only completed attempts have reports.
      const candidates = [];
      for (const item of feed.workflow_runs) {
        if (!safe(item.id) || !safe(item.run_attempt)) continue;
        const first = item.conclusion === 'success' ? item.run_attempt : item.run_attempt - 1;
        for (let attempt = first; attempt >= Math.max(1, first - 1); attempt--) {
          candidates.push([item.id, attempt]);
        }
      }
      candidates.push([45900543591, 1]);
      for (const [id, attempt] of candidates) {
        try { await showPublished(id, attempt); return; } catch { /* Try an earlier verified report. */ }
      }
      if (!displayedKey && !localReport) body.textContent = 'Bestätigter Endstand derzeit nicht abrufbar.';
    }).catch(async () => {
      queuedLink.hidden = true;
      live.className = 'paper-wait';
      live.textContent = 'Aktueller Laufstatus nicht abrufbar.';
      if (!displayedKey && !localReport) {
        try { await showPublished(45900543591, 1); }
        catch { if (!localReport) body.textContent = 'Bestätigter Endstand derzeit nicht abrufbar.'; }
      }
    }).finally(() => { pending = null; });
    return pending;
  };
}
