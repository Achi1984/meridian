const original = {id:45185444796, start:1795440944, title:'Einstiege · Referenzlauf',
  names:{A:'Soforteinstieg', B:'Käufer-Erholung', C:'Käufer-Erholung mit 10 % Nettoziel'}};
const recovery = {id:45210142704, start:1795449172, title:'Ausstiege · Käufer-Erholung',
  names:{A:'Nachlaufender Gewinnausstieg', B:'Standardausstieg', C:'10 % Nettoziel'},
  policies:{A:'trailing', B:'standard', C:'fixed'}};

const validation = {id:45433341029, title:'A–F · Aktueller Vergleich',
  names:{...recovery.names, D:'Teilverkäufe', E:'Früher Verlustausstieg', F:'Nettoziel · Pool unter 20.000 USD'},
  policies:{...recovery.policies, D:'staged', E:'failedRecovery', F:'smallPoolFixed'}};

const reasons = new Map(Object.entries({early:'Soforteinstieg', wave:'Käufer-Erholung', time:'Zeitlimit',
  target:'Nettoziel', stop:'Verlustgrenze', trailing:'Nachlaufender Gewinnausstieg'}));
const vienna = time => new Date(time * 1000).toLocaleString('de-AT',{timeZone:'Europe/Vienna'});

export function accountRows(snapshot, campaign = original) {
  const {startedAt, endsAt, updatedAt} = snapshot;
  if (![startedAt, endsAt, updatedAt].every(Number.isSafeInteger) ||
      endsAt - startedAt !== 8 * 3600 || updatedAt < startedAt ||
      !Number.isFinite(new Date(updatedAt * 1000).getTime())) throw Error('timestamp');
  return Object.entries(campaign.names).map(([key, name]) => {
    const a = snapshot.accounts[key];
    if (campaign.policies && a.policy !== campaign.policies[key]) throw Error('policy');
    if (![a.cashUsdc, a.realizedUsdc].every(Number.isFinite) ||
        !(a.equityUsdc === null || Number.isFinite(a.equityUsdc)) ||
        !Number.isSafeInteger(a.closedTrades) || a.closedTrades < 0 ||
        !Array.isArray(a.openPositions)) throw Error('account');
    const withoutBest = a.realizedWithoutBestMintUsdc;
    const drawdown = a.sampledMaxDrawdownUsdc;
    if (withoutBest != null && !Number.isFinite(withoutBest)) throw Error('concentration');
    if (drawdown != null && (!Number.isFinite(drawdown) || drawdown < 0)) throw Error('drawdown');
    const missing = a.missingExitQuotes;
    if (missing !== undefined && (!Number.isSafeInteger(missing) || missing < 0)) throw Error('quotes');
    const trades = a.tradeEvents ?? [];
    if (!Array.isArray(trades) || trades.some((t,i) => !t || !Number.isSafeInteger(t.at) ||
        t.at < startedAt || t.at > updatedAt || (i && t.at < trades[i-1].at) ||
        typeof t.mint !== 'string' || !t.mint || typeof t.reason !== 'string' ||
        !['entry','exit'].includes(t.action) || (t.action === 'exit' && !Number.isFinite(t.netUsdc)))) {
      throw Error('trades');
    }
    return {trades, key, missing, name:key + ' · ' + name, cash:a.cashUsdc, equity:a.equityUsdc, net:a.realizedUsdc,
      closed:a.closedTrades, open:a.openPositions.length, withoutBest, drawdown};
  });
}

export function mountEightHourComparison(section, add, read, amount) {
  const panel = add(section,'section','');
  panel.className = 'solana-comparison';
  const label = add(panel,'label','Paperlauf ');
  const select = add(label,'select','');
  const campaigns = [validation, recovery, original];
  for (const campaign of campaigns) add(select,'option',campaign.title).value = String(campaign.id);
  const body = add(panel,'section','');
  let chosen = validation;
  let activeId = chosen.id;
  let refresh = mountCampaign(body, add, read, amount, chosen);
  let generation = 0;
  async function update() {
    const request = ++generation;
    let campaign = chosen;
    if (chosen === validation) {
      try {
        const feed = await read('https://api.github.com/repos/Achi1984/meridian/actions/workflows/' +
          'newcomer-eight-hour.yml/runs?branch=paper%2Fovernight-staged-exits&per_page=1');
        const id = feed.workflow_runs?.[0]?.id;
        campaign = {...validation, id:Number.isSafeInteger(id) ? Math.max(id, activeId, validation.id) : activeId};
      } catch { campaign = {...validation, id:activeId}; }
    }
    if (request !== generation) return;
    if (campaign.id !== activeId) {
      activeId = campaign.id;
      body.replaceChildren();
      refresh = mountCampaign(body, add, read, amount, campaign);
    }
    await refresh();
  }
  select.addEventListener('change',() => {
    chosen = campaigns.find(item => String(item.id) === select.value) || validation;
    activeId = chosen.id;
    body.replaceChildren();
    refresh = mountCampaign(body, add, read, amount, chosen);
    void update();
  });
  return update;
}

function mountCampaign(parent, add, read, amount, campaign) {
  const runId = campaign.id;
  const runPath = 'Achi1984/meridian/actions/runs/' + runId;
  const root = add(parent,'section','');
  const status = add(root,'p','Laufstatus wird beim Öffnen geladen.');
  status.setAttribute('role','status');
  const result = add(root,'div','Noch kein Kontobericht geladen.');
  result.setAttribute('aria-live','polite');
  const details = add(root,'details','');
  add(details,'summary','Kontodetails und Quellen');
  const metrics = add(details,'section','');
  add(details,'a','Laufprotokoll auf GitHub').href = 'https://github.com/' + runPath;
  const label = add(details,'label','Lokalen Bericht laden ');
  const input = add(label,'input','');
  input.type = 'file';
  input.accept = '.json,application/json';
  let displayedAt = -1;
  let revision = 0;
  function render(snapshot, source) {
    if ((campaign.start === undefined ? snapshot.runId !== runId : snapshot.startedAt !== campaign.start) ||
        (snapshot.runId !== undefined && snapshot.runId !== runId)) throw Error('run');
    const rows = accountRows(snapshot, campaign);
    result.replaceChildren();
    const at = vienna(snapshot.updatedAt);
    const table = add(result,'table','');
    table.setAttribute('style','table-layout:fixed;overflow-wrap:anywhere');
    const header = add(add(table,'thead',''),'tr','');
    for (const title of ['Strategie', 'Kontowert / PnL']) {
      const cell = add(header,'th',title);
      cell.scope = 'col';
      cell.setAttribute('style','white-space:normal');
    }
    const body = add(table,'tbody','');
    for (const row of rows) {
      const line = add(body,'tr','');
      const strategy = add(line,'th',row.name);
      strategy.scope = 'row';
      add(strategy,'small',row.closed + ' geschlossen · ' + row.open + ' offen').setAttribute('style','display:block');
      if (row.withoutBest != null) add(strategy,'small','Ohne besten Token · ' + amount(row.withoutBest))
        .setAttribute('style','display:block');
      const last = row.trades.at(-1);
      if (last) add(strategy,'small',(last.action === 'exit' ? 'Verkauf' : 'Kauf') + ' · ' + vienna(last.at)).setAttribute('style','display:block');
      const balance = add(line,'td',row.equity === null ? 'Bewertung offen' : amount(row.equity));
      const pnl = add(balance,'span',(row.net > 0 ? '+' : '') + amount(row.net));
      pnl.setAttribute('style','display:block');
      pnl.className = row.net > 0 ? 'tone-safe' : row.net < 0 ? 'tone-danger' : '';
    }
    add(result,'small',source + ' · ' + at + ' (Wien)');
    metrics.replaceChildren();
    if (Number.isSafeInteger(snapshot.lastQuoteAt) && snapshot.lastQuoteAt >= snapshot.startedAt &&
        snapshot.lastQuoteAt <= snapshot.updatedAt) add(metrics,'p','Letzte Rückverkaufsquote · ' + vienna(snapshot.lastQuoteAt));
    const f = rows.find(row => row.key === 'F');
    if (f) {
      const c = rows.find(row => row.key === 'C');
      add(metrics,'p','F gegenüber C · realisiert ' + amount(f.net-c.net) + ' · Kontowert ' +
        (f.equity === null || c.equity === null ? 'Bewertung offen' : amount(f.equity-c.equity)));
    }
    const benchmark = rows[1];
    for (const index of [0, 2]) {
      const candidate = rows[index];
      const label = candidate.key + ' gegenüber B';
      const delta = candidate.equity === null || benchmark.equity === null
        ? 'Bewertung offen' : amount(candidate.equity - benchmark.equity);
      add(metrics,'p','Kontowert ' + label + ' · ' + delta);
    }
    for (const {name,cash,equity,net,closed,open,withoutBest,drawdown,missing,trades} of rows) {
      add(metrics,'h4',name);
      if (!trades.length) add(metrics,'p','Im Bericht fehlen einzelne Handelsentscheidungen.');
      add(metrics,'p','Guthaben ' + amount(cash) + ' · Kontowert ' + amount(equity) +
        ' · Realisiert ' + amount(net) + ' · Geschlossen ' + closed + ' · Offen ' + open);
      if (trades.length) {
        const ledger = add(metrics,'details','');
        ledger.setAttribute('style','overflow-wrap:anywhere');
        add(ledger,'summary','Paper-Trades (' + closed + ' abgeschlossen)');
        for (const trade of [...trades].reverse()) {
          add(ledger,'p',vienna(trade.at) + ' · ' + (trade.action === 'exit' ? 'Verkauf' : 'Kauf') +
            ' · ' + (reasons.get(trade.reason) || trade.reason) + ' · ' + trade.mint +
            (trade.action === 'exit' ? ' · Netto ' + amount(trade.netUsdc) : ''));
        }
      }
      if (missing > 0) add(metrics,'p','Fehlende Rückverkaufsquoten für die Positionsgröße · ' + missing);
      if (withoutBest !== undefined) {
        add(metrics,'p',withoutBest === null ? 'Vergleich ab zwei abgeschlossenen Coins verfügbar.' :
          'Realisiert ohne besten Coin · ' + amount(withoutBest));
      }
      if (drawdown != null) add(metrics,'p','Größter beobachteter Rückgang des Kontowerts · ' + amount(drawdown));
    }
    displayedAt = snapshot.updatedAt;
  }
  const notice = add(root,'p','');
  input.addEventListener('change',async () => {
    const current = ++revision;
    const file = input.files[0];
    notice.textContent = '';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error('size');
      const snapshot = JSON.parse(await file.text());
      if (current === revision) render(snapshot,'Lokaler Bericht');
    } catch {
      if (current === revision) notice.textContent = 'Datei konnte nicht als Kontobericht gelesen werden.';
    }
  });
  async function refreshReport() {
    const current = revision;
    try {
      const snapshot = await read('https://api.github.com/repos/Achi1984/meridian/contents/solana-abc-' +
        runId + '.json?ref=paper-dashboard-data', true);
      if (snapshot.runId !== runId) throw Error('run');
      if (current !== revision) return;
      if (snapshot.updatedAt > displayedAt) render(snapshot,'Bestätigter Laufbericht');
      notice.textContent = '';
    } catch {
      if (current === revision) notice.textContent = displayedAt < 0 ? 'Noch kein bestätigter Laufbericht abrufbar.' :
        'Abruf fehlgeschlagen. Der angezeigte Bericht behält seinen Zeitstand.';
    }
  }
  async function refreshJobs() {
    try {
      const jobs = await read('https://api.github.com/repos/' + runPath + '/jobs');
      const phases = [['first','Erste vier Stunden'],['finish','Zweite vier Stunden']];
      const states = {in_progress:'läuft',queued:'wartet',pending:'wartet',waiting:'wartet',
        success:'abgeschlossen',failure:'fehlgeschlagen',cancelled:'abgebrochen',skipped:'übersprungen',
        timed_out:'Zeitlimit erreicht'};
      const phase = jobs.jobs.find(item => item.name === 'finish') || jobs.jobs.find(item => item.name === 'first');
      const first = jobs.jobs.find(item => item.name === 'first');
      const current = first && first.status !== 'completed' ? first : phase;
      status.textContent = current ? phases.find(([id]) => id === current.name)[1] + ' · ' +
        (states[current.conclusion || current.status] || 'unbekannt') : 'Laufstatus ausstehend';
    } catch {
      status.textContent = 'Laufstatus derzeit nicht abrufbar.';
    }
  }
  return () => Promise.all([refreshReport(), refreshJobs()]);
}
