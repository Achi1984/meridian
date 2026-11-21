const repo = 'Achi1984/meridian';
const workflow = 'solana-meme-paper-bot.yml';
const api = 'https://api.github.com/repos/' + repo;
const runs = 'https://github.com/' + repo + '/actions/runs/';
const count = n => Number.isSafeInteger(n) && n >= 0;
const amount = n => Number.isFinite(n) ? n.toLocaleString('de-AT', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}) + ' USDC' : 'Unbewertet';

async function read(url, raw = false) {
  const response = await fetch(url, {credentials:'omit', cache:'no-store',
    signal:AbortSignal.timeout(10000),
    headers:{Accept:raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}});
  if (!response.ok) throw Error('unavailable');
  return response.json();
}

export function mountSolanaReport(section) {
  const doc = section.ownerDocument;
  const add = (parent, tag, text) => {
    const child = doc.createElement(tag);
    child.textContent = text;
    parent.append(child);
    return child;
  };
  const live = add(section,'p','Laufstatus wird beim Öffnen geladen.');
  const body = add(section,'div','');
  const refresh = add(section,'button','Aktualisieren');
  refresh.type = 'button';
  refresh.className = 'strategy-entry-link';
  const source = add(section,'a','Pilotläufe auf GitHub');
  source.href = 'https://github.com/' + repo + '/actions/workflows/' + workflow;
  source.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;padding:0 10px';
  let loading = false;
  async function update() {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    live.textContent = 'Laufstatus wird geladen …';
    body.replaceChildren();
    const [status, report] = await Promise.allSettled([
      read(api + '/actions/workflows/' + workflow + '/runs?branch=main&per_page=1'),
      read(api + '/contents/solana-meme.json?ref=paper-dashboard-data',true)
    ]);
    try {
      const run = status.value?.workflow_runs?.[0];
      const states = {queued:'Wartet',in_progress:'Läuft',completed:'Beendet',waiting:'Wartet'};
      live.textContent = run && states[run.status] ? 'Letzter Pilot · ' + states[run.status] : 'Laufstatus unbekannt';
      if (run?.status === 'completed' && run.conclusion !== 'success') live.textContent += ' · ohne erfolgreichen Abschluss';
      if (count(run?.id)) {
        const link = add(live,'a',' · Lauf öffnen');
        link.href = runs + run.id;
      }
      const s = report.value;
      if (!(s?.schema === 1 && count(s.runId) && s.runId > 0 && Number.isFinite(Date.parse(s.at))
          && count(s.pools) && count(s.open) && count(s.closed) && Number.isFinite(s.realized)
          && (s.equity === null || Number.isFinite(s.equity)))) {
        add(body,'p','Kein bestätigter Abschlussbericht verfügbar.');
        return;
      }
      const title = add(body,'a','Abschlussbericht · ' + new Date(s.at).toLocaleString('de-AT'));
      title.href = runs + s.runId;
      const list = add(body,'dl','');
      list.className = 'strategy-summary';
      function field(label,value) {
        const group = add(list,'div','');
        add(group,'dt',label);
        return add(group,'dd',String(value));
      }
      field('Kontowert',amount(s.equity));
      field('Realisierter PnL',amount(s.realized)).className =
        s.realized > 0 ? 'tone-safe' : s.realized < 0 ? 'tone-danger' : '';
      field('Offene Positionen',s.open);
      field('Geschlossene Trades',s.closed);
      field('Beobachtete Pools',s.pools);
      if (count(s.withdrawn)) field('Signal zurückgenommen · Pools',s.withdrawn);
      if (count(s.expired)) field('Signal abgelaufen · Pools',s.expired);
      if (s.fiveMinuteComparison) {
        const rows = ['10000','5000'].map(key=>s.fiveMinuteComparison[key]);
        if (rows.every(row=>row && [row.signals,row.priced,row.missing].every(count)
            && row.signals === row.priced + row.missing
            && (row.priced === 0 ? row.medianPct === null : Number.isFinite(row.medianPct)))) {
          const comparison = add(body,'details','');
          add(comparison,'summary','Liquiditätsvergleich · 5 Minuten');
          add(comparison,'p','Kursänderung ab dem ersten Signal je Pool, vor Handelskosten.');
          for (const [i,row] of rows.entries()) {
            const label = i === 0 ? '10.000 USD' : '5.000 USD';
            add(comparison,'h3','Mindestliquidität ' + label);
            add(comparison,'p',row.signals + ' Signalpools · ' + row.priced +
                ' mit Folgekurs · ' + row.missing + ' ohne Folgekurs');
            const value = row.medianPct === null ? 'nicht ermittelbar' :
              row.medianPct.toLocaleString('de-AT',{maximumFractionDigits:2}) + ' %';
            add(comparison,'p','Mediane Kursänderung · ' + value);
          }
        }
      }
      const study = s.persistenceAt5000;
      if (study && [study.signals,study.confirmed,study.rejected,study.missingConfirmation,
          study.priced,study.missingOutcome].every(count)
          && study.signals === study.confirmed + study.rejected + study.missingConfirmation
          && study.confirmed === study.priced + study.missingOutcome
          && (study.priced ? Number.isFinite(study.medianPct) : study.medianPct === null)) {
        const detail = add(body,'details','');
        add(detail,'summary','Signalbestätigung · 5.000 USD');
        add(detail,'p',study.signals + ' Signale · ' + study.confirmed + ' bestätigt · ' +
            study.rejected + ' verworfen · ' + study.missingConfirmation + ' ohne Kurs nach 60–120 Sekunden');
        add(detail,'p','Fünf Minuten ab Bestätigung · ' + study.priced + ' mit Folgekurs · ' +
            study.missingOutcome + ' ohne Folgekurs');
        const median = study.priced ? study.medianPct.toLocaleString('de-AT',{maximumFractionDigits:2}) + ' %' : 'nicht ermittelbar';
        add(detail,'p','Mediane Kursänderung vor Kosten · ' + median);
      }
      const quotes = s.confirmationExecution;
      if (quotes && study && [quotes.quoted,quotes.passed,quotes.skipped,quotes.buyMissing,quotes.sellMissing].every(count)
          && quotes.passed <= quotes.quoted
          && quotes.quoted + quotes.skipped + quotes.buyMissing + quotes.sellMissing === study.confirmed
          && (quotes.quoted ? Number.isFinite(quotes.medianReturnUsdc) : quotes.medianReturnUsdc === null)) {
        const detail = add(body,'details','');
        add(detail,'summary','Kauf und Rückverkauf · 20 USDC');
        add(detail,'p',quotes.quoted + ' mit beiden Kursen · davon ' + quotes.passed + ' mit mindestens 19 USDC Rückfluss');
        add(detail,'p',quotes.buyMissing + ' ohne Kaufkurs · ' + quotes.sellMissing +
            ' ohne Rückverkaufskurs · ' + quotes.skipped + ' übersprungen');
        add(detail,'p','Medianer Rückfluss vor Netzwerkgebühren · ' +
            (quotes.quoted ? amount(quotes.medianReturnUsdc) : 'nicht ermittelbar'));
      }
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  section.addEventListener('toggle',() => { if (section.open) update(); });
  refresh.addEventListener('click',update);
}
