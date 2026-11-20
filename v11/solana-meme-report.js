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
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  section.addEventListener('toggle',() => { if (section.open) update(); });
  refresh.addEventListener('click',update);
}
