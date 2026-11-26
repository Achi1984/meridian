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
        if (high) skipped++;
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
        if (buy.high) { missed += Math.max(net, 0); avoided += Math.max(-net, 0); }
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
  return {rows, delta, skipped, maxOwnerBps, measured:entryStates.high + entryStates.belowThreshold, unknown:entryStates.unknown, missed:missed/micro, avoided:avoided/micro,
    updatedAt:status.updatedAt, final:status.lastEvent === 'finished'};
}

export function mountHolderComparison(section, add, read, amount) {
  const card = add(section, 'section', '');
  card.className = 'solana-comparison';
  add(card, 'h3', 'Halterkonzentration · Solana');
  add(card, 'small', 'Je 1.000 USDC. H überspringt Einstiege ab 20 % gemessenem Anteil eines Halters. Bei unbekanntem Anteil gelten die Regeln von C.');
  const live = add(card, 'p', 'Laufstatus wird geladen.');
  const source = add(card, 'a', 'Laufprotokoll öffnen');
  source.href = runs + '45622083781';
  const body = add(card, 'section', '');
  function render(report, origin) {
    body.replaceChildren();
    const date = new Date(report.updatedAt*1000).toLocaleString('de-AT', {timeZone:'Europe/Vienna'});
    add(body, 'strong', (report.final ? 'Endstand' : 'Zwischenstand') + ' · ' + date + ' (Wien) · ' + origin);
    report.rows.forEach((a, i) => add(body, 'p', (i ? 'H · Filter' : 'C · Referenz') + ' · realisiert ' +
      amount(a.net) + ' · ' + a.closed + ' geschlossen · ' + a.open + ' offen' +
      (a.open ? ' · Einstand inkl. Kaufgebühren ' + amount(a.openCost) : '')));
    add(body, 'p', 'Differenz H zu C · ' + amount(report.delta));
    const maxShare = report.maxOwnerBps === null ? '' : ' · höchster gemessener Einzelanteil ' +
      (report.maxOwnerBps / 100).toLocaleString('de-AT', {maximumFractionDigits:2}) + ' %';
    add(body, 'p', 'Halterdaten bei ' + report.measured + ' von ' + (report.measured + report.unknown) +
      ' Einstiegssignalen' + maxShare);
    add(body, 'p', report.skipped + ' ausgelassene Einstiege · vermiedene Verluste ' +
      amount(report.avoided) + ' · entgangene Gewinne ' + amount(report.missed));
  }
  render({updatedAt:1795727317, final:true, rows:[{net:-22.021548,closed:16,open:2,openCost:40.1},
    {net:-22.021548,closed:16,open:2,openCost:40.1}], delta:0, measured:18, unknown:0,
    maxOwnerBps:651, skipped:0, missed:0, avoided:0}, 'Geprüftes Journal vom 26. November');
  const label = add(card, 'label', 'Bericht prüfen · status.json und events.jsonl auswählen ');
  const input = add(label, 'input', '');
  input.type = 'file';
  input.multiple = true;
  const notice = add(card, 'p', '');
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
    pending = read(api + '/runs?branch=paper%2Fholder-token2022-forward&per_page=20').then(feed => {
      const run = feed.workflow_runs.find(r => r.path === '.github/workflows/holder-concentration.yml');
      if (!safe(run?.id) || !safe(run.run_attempt)) throw Error('run');
      const state = {in_progress:'läuft', queued:'in Warteschlange', success:'abgeschlossen', failure:'fehlgeschlagen',
        cancelled:'abgebrochen'}[run.conclusion || run.status] || run.status;
      live.textContent = 'Paperlauf ' + run.id + ' · Versuch ' + run.run_attempt + ' · ' + state;
      source.href = runs + run.id + '/attempts/' + run.run_attempt;
    }).catch(() => { live.textContent = 'Aktueller Laufstatus nicht abrufbar.'; }).finally(() => { pending = null; });
    return pending;
  };
}
