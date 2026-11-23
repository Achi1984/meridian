const runId = 45185444796;
const runPath = 'Achi1984/meridian/actions/runs/' + runId;
const variants = {A:'Soforteinstieg', B:'Käufer-Erholung', C:'Käufer-Erholung mit 10 % Nettoziel'};

export function accountRows(snapshot) {
  const {startedAt, endsAt, updatedAt} = snapshot;
  if (![startedAt, endsAt, updatedAt].every(Number.isSafeInteger) ||
      endsAt - startedAt !== 8 * 3600 || updatedAt < startedAt ||
      !Number.isFinite(new Date(updatedAt * 1000).getTime())) throw Error('timestamp');
  return Object.entries(variants).map(([key, name]) => {
    const a = snapshot.accounts[key];
    if (![a.cashUsdc, a.realizedUsdc].every(Number.isFinite) ||
        !(a.equityUsdc === null || Number.isFinite(a.equityUsdc)) ||
        !Number.isSafeInteger(a.closedTrades) || a.closedTrades < 0 ||
        !Array.isArray(a.openPositions)) throw Error('account');
    const withoutBest = a.realizedWithoutBestMintUsdc;
    const drawdown = a.sampledMaxDrawdownUsdc;
    if (withoutBest != null && !Number.isFinite(withoutBest)) throw Error('concentration');
    if (drawdown != null && (!Number.isFinite(drawdown) || drawdown < 0)) throw Error('drawdown');
    return {name:key + ' · ' + name, cash:a.cashUsdc, equity:a.equityUsdc, net:a.realizedUsdc,
      closed:a.closedTrades, open:a.openPositions.length, withoutBest, drawdown};
  });
}

export function mountEightHourComparison(section, add, read, amount) {
  const root = add(section,'section','');
  add(root,'h3','Acht-Stunden-Vergleich · 23. November');
  const status = add(root,'p','Laufstatus wird beim Öffnen geladen.');
  status.setAttribute('role','status');
  add(root,'a','Laufprotokoll und Berichte auf GitHub').href = 'https://github.com/' + runPath;
  const label = add(root,'label','Kontostand aus status.json anzeigen ');
  const input = add(label,'input','');
  input.type = 'file';
  input.accept = '.json,application/json';
  const result = add(root,'div','Noch kein Kontobericht geladen.');
  result.setAttribute('aria-live','polite');
  let revision = 0;
  input.addEventListener('change',async () => {
    const current = ++revision;
    const file = input.files[0];
    result.textContent = 'Noch kein Kontobericht geladen.';
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error('size');
      const snapshot = JSON.parse(await file.text());
      if (current !== revision) return;
      const rows = accountRows(snapshot);
      result.replaceChildren();
      const at = new Date(snapshot.updatedAt * 1000).toLocaleString('de-AT',{timeZone:'Europe/Vienna'});
      add(result,'p','Lokaler Bericht · ' + at + ' (Wien)');
      for (const {name,cash,equity,net,closed,open,withoutBest,drawdown} of rows) {
        add(result,'h4',name);
        add(result,'p','Guthaben ' + amount(cash) + ' · Kontowert ' + amount(equity) +
          ' · Realisiert ' + amount(net) + ' · Geschlossen ' + closed + ' · Offen ' + open);
        if (withoutBest !== undefined) {
          add(result,'p',withoutBest === null ? 'Vergleich ab zwei abgeschlossenen Coins verfügbar.' :
            'Realisiert ohne besten Coin · ' + amount(withoutBest));
        }
        if (drawdown != null) add(result,'p','Größter beobachteter Rückgang des Kontowerts · ' + amount(drawdown));
      }
    } catch {
      if (current === revision) result.textContent = 'Datei konnte nicht als A/B/C-Kontobericht gelesen werden.';
    }
  });
  return async function refresh() {
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
  };
}
