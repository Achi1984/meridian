const original = {id:45185444796, start:1795440944, title:'Referenzlauf · Einstiege',
  names:{A:'Soforteinstieg', B:'Käufer-Erholung', C:'Käufer-Erholung mit 10 % Nettoziel'}};
const recovery = {id:45210142704, start:1795449172, title:'Neustart · Ausstiege nach Käufer-Erholung',
  names:{A:'Nachlaufender Gewinnausstieg', B:'Standardausstieg', C:'10 % Nettoziel'},
  policies:{A:'trailing', B:'standard', C:'fixed'}};

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
    return {key, missing, name:key + ' · ' + name, cash:a.cashUsdc, equity:a.equityUsdc, net:a.realizedUsdc,
      closed:a.closedTrades, open:a.openPositions.length, withoutBest, drawdown};
  });
}

export function mountEightHourComparison(section, add, read, amount) {
  const panel = add(section,'section','');
  add(panel,'h3','Acht-Stunden-Vergleich · 23. November');
  const label = add(panel,'label','Paperlauf ');
  const select = add(label,'select','');
  for (const campaign of [recovery, original]) add(select,'option',campaign.title).value = String(campaign.id);
  const body = add(panel,'section','');
  let refresh = mountCampaign(body, add, read, amount, recovery);
  select.addEventListener('change',() => {
    body.replaceChildren();
    const campaign = select.value === String(original.id) ? original : recovery;
    refresh = mountCampaign(body, add, read, amount, campaign);
    void refresh();
  });
  return () => refresh();
}

function mountCampaign(parent, add, read, amount, campaign) {
  const runId = campaign.id;
  const runPath = 'Achi1984/meridian/actions/runs/' + runId;
  const root = add(parent,'section','');
  const status = add(root,'p','Laufstatus wird beim Öffnen geladen.');
  status.setAttribute('role','status');
  add(root,'a','Laufprotokoll und Berichte auf GitHub').href = 'https://github.com/' + runPath;
  const label = add(root,'label','Kontostand aus status.json anzeigen ');
  const input = add(label,'input','');
  input.type = 'file';
  input.accept = '.json,application/json';
  const result = add(root,'div','Noch kein Kontobericht geladen.');
  result.setAttribute('aria-live','polite');
  let displayedAt = -1;
  let revision = 0;
  function render(snapshot, source) {
    if (snapshot.startedAt !== campaign.start ||
        (snapshot.runId !== undefined && snapshot.runId !== runId)) throw Error('run');
    const rows = accountRows(snapshot, campaign);
    result.replaceChildren();
    const at = new Date(snapshot.updatedAt * 1000).toLocaleString('de-AT',{timeZone:'Europe/Vienna'});
    add(result,'p',source + ' · ' + at + ' (Wien)');
    const benchmark = rows[1];
    for (const index of [0, 2]) {
      const candidate = rows[index];
      const label = candidate.key + ' gegenüber B';
      const delta = candidate.equity === null || benchmark.equity === null
        ? 'Bewertung offen' : amount(candidate.equity - benchmark.equity);
      add(result,'p','Kontowert ' + label + ' · ' + delta);
    }
    for (const {name,cash,equity,net,closed,open,withoutBest,drawdown,missing} of rows) {
      add(result,'h4',name);
      add(result,'p','Guthaben ' + amount(cash) + ' · Kontowert ' + amount(equity) +
        ' · Realisiert ' + amount(net) + ' · Geschlossen ' + closed + ' · Offen ' + open);
      if (missing > 0) add(result,'p','Fehlende Rückverkaufsquoten für die Positionsgröße · ' + missing);
      if (withoutBest !== undefined) {
        add(result,'p',withoutBest === null ? 'Vergleich ab zwei abgeschlossenen Coins verfügbar.' :
          'Realisiert ohne besten Coin · ' + amount(withoutBest));
      }
      if (drawdown != null) add(result,'p','Größter beobachteter Rückgang des Kontowerts · ' + amount(drawdown));
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
      if (current === revision) notice.textContent = 'Datei konnte nicht als A/B/C-Kontobericht gelesen werden.';
    }
  });
  async function refreshReport() {
    const current = revision;
    try {
      const snapshot = await read('https://api.github.com/repos/Achi1984/meridian/contents/solana-abc-' +
        runId + '.json?ref=paper-dashboard-data', true);
      if (snapshot.runId !== runId || snapshot.startedAt !== campaign.start) throw Error('run');
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
      status.textContent = phases.map(([id,title]) => {
        const job = jobs.jobs.find(item => item.name === id);
        return title + ' · ' + (job ? states[job.conclusion || job.status] || 'unbekannt' : 'noch nicht gemeldet');
      }).join(' | ');
    } catch {
      status.textContent = 'Laufstatus derzeit nicht abrufbar.';
    }
  }
  return () => Promise.all([refreshReport(), refreshJobs()]);
}
