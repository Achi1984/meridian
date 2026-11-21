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
  const badge = add(section.querySelector('summary'),'small','Status wird geladen');
  badge.className = 'pilot-status';
  const live = add(section,'p','Laufstatus wird beim Öffnen geladen.');
  live.setAttribute('role','status');
  const notice = add(section,'p','');
  notice.hidden = true;
  const body = add(section,'div','');
  const refresh = add(section,'button','Aktualisieren');
  refresh.type = 'button';
  refresh.className = 'strategy-entry-link';
  const source = add(section,'a','Pilotläufe auf GitHub');
  source.href = 'https://github.com/' + repo + '/actions/workflows/' + workflow;
  source.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;padding:0 10px';
  let loading = false;
  let hasReport = false;
  let pendingStatus;
  let statusAt = 0;
  let observedRuns = [];
  function renderStatus(status) {
    const recent = status?.workflow_runs;
    observedRuns = Array.isArray(recent) ? recent : [];
    const run = observedRuns[0];
    const states = {queued:'Wartet',pending:'Wartet',requested:'Wartet',waiting:'Wartet',
      in_progress:'Läuft',completed:'Beendet'};
    let label = states[run?.status] || 'Status unbekannt';
    if (run?.status === 'completed') {
      const conclusions = {success:'Beendet',cancelled:'Abgebrochen',failure:'Fehlgeschlagen',
        timed_out:'Zeitlimit erreicht',skipped:'Übersprungen',neutral:'Neutral beendet',
        action_required:'Eingriff erforderlich',stale:'Veraltet'};
      label = Object.hasOwn(conclusions,run.conclusion) ? conclusions[run.conclusion] : 'Ergebnis unbekannt';
    }
    badge.textContent = count(run?.run_number) ? 'Pilot ' + run.run_number + ' · ' + label : label;
    badge.dataset.state = run?.status === 'in_progress' ? 'running' : 'other';
    function linkRun(parent, item) {
      if (count(item?.id) && item.id > 0) {
        const label = count(item.run_number) ? ' · Lauf #' + item.run_number : ' · Lauf öffnen';
        add(parent,'a',label).href = runs + item.id;
      }
    }
    live.textContent = run && states[run.status] ? 'Letzter Pilot · ' + label : 'Laufstatus unbekannt';
    linkRun(live,run);
    if (run && states[run.status] === 'Wartet') {
      const active = observedRuns.find(item=>item?.status === 'in_progress' && item.id !== run.id);
      if (active) linkRun(add(live,'span',' · Aktuell laufender Pilot'),active);
    }
  }
  function refreshStatus(force=false) {
    if (pendingStatus) return pendingStatus;
    if (!force && Date.now()-statusAt < 30000) return Promise.resolve();
    pendingStatus = read(api + '/actions/workflows/' + workflow + '/runs?branch=main&per_page=5')
      .then(renderStatus,()=>renderStatus(null))
      .finally(()=>{ statusAt = Date.now(); pendingStatus = null; });
    return pendingStatus;
  }
  async function update() {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    live.textContent = 'Laufstatus wird geladen …';
    const [, report] = await Promise.allSettled([
      refreshStatus(true),
      read(api + '/contents/solana-meme.json?ref=paper-dashboard-data',true)
    ]);
    try {
      const s = report.value;
      if (!(s?.schema === 1 && count(s.runId) && s.runId > 0 && Number.isFinite(Date.parse(s.at))
          && count(s.pools) && count(s.open) && count(s.closed) && Number.isFinite(s.realized)
          && (s.equity === null || Number.isFinite(s.equity)))) {
        notice.textContent = hasReport ? 'Abruf fehlgeschlagen. Angezeigt wird der zuletzt geladene Bericht.' :
          'Kein bestätigter Abschlussbericht verfügbar.';
        notice.hidden = false;
        return;
      }
      body.replaceChildren();
      notice.hidden = true;
      hasReport = true;
      const sourceRun = observedRuns.find(item=>item?.id === s.runId);
      const label = observedRuns[0]?.id === s.runId ? 'Abschlussbericht' : 'Letzter verfügbarer Abschlussbericht';
      const number = count(sourceRun?.run_number) ? ' · Lauf #' + sourceRun.run_number : '';
      const finished = new Date(s.at).toLocaleString('de-AT',{timeZone:'Europe/Vienna',
        day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
      const title = add(body,'a',label + number + ' · ' + finished);
      title.href = runs + s.runId;
      const list = add(body,'dl','');
      list.className = 'strategy-summary';
      function field(label,value,parent=list) {
        const group = add(parent,'div','');
        add(group,'dt',label);
        return add(group,'dd',String(value));
      }
      field('Realisierter PnL',amount(s.realized)).className =
        s.realized > 0 ? 'tone-safe' : s.realized < 0 ? 'tone-danger' : '';
      field('Offene Positionen',s.open);
      field('Kontowert',amount(s.equity));
      field('Geschlossene Trades',s.closed);
      const diagnostics = add(body,'details','');
      add(diagnostics,'summary','Signal- und Pooldetails');
      const counters = add(diagnostics,'dl','');
      counters.className = 'strategy-summary';
      field('Beobachtete Pools',s.pools,counters);
      if (count(s.withdrawn)) field('Signal zurückgenommen · Pools',s.withdrawn,counters);
      if (count(s.expired)) field('Signal abgelaufen · Pools',s.expired,counters);
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
      const inflow = s.earlyInflow;
      if (inflow && [inflow.signals,inflow.entryQuotes,inflow.buyUnavailable,inflow.skipped,
          inflow.pricedExits,inflow.unresolved].every(count)
          && inflow.signals === inflow.entryQuotes + inflow.buyUnavailable + inflow.skipped
          && inflow.entryQuotes === inflow.pricedExits + inflow.unresolved
          && (inflow.pricedExits ? Number.isFinite(inflow.pricedNetUsdc) : inflow.pricedNetUsdc === null)) {
        const detail = add(body,'details','');
        add(detail,'summary','Frühe Liquiditätszuflüsse · Jupiter');
        add(detail,'p',inflow.signals + ' Signale · ' + inflow.entryQuotes + ' mit Kaufkurs für 20 USDC · ' +
            inflow.buyUnavailable + ' ohne Kaufkurs · ' + inflow.skipped + ' übersprungen');
        add(detail,'p','Nach 3–5 Minuten: ' + inflow.pricedExits + ' mit Rückverkaufskurs · ' +
            inflow.unresolved + ' ohne Rückverkaufskurs');
        add(detail,'p','Geschätztes Netto aus bewerteten Kurspaaren: ' +
            (inflow.pricedExits ? amount(inflow.pricedNetUsdc) : 'nicht ermittelbar'));
        add(detail,'p','Die Schätzung berücksichtigt 0,10 USDC Netzwerkgebühren je Kurspaar.');
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
        let limits = quotes.withinCostPct;
        if (limits === undefined && quotes.quoted === 1) {
          // With one pair the reported median is the individual quote.
          limits = Object.fromEntries([1,2,5].map(limit =>
            [limit, Number(quotes.medianReturnUsdc >= (100-limit)/5)]));
        }
        if (quotes.quoted > 0 && limits && [limits[1],limits[2],limits[5]].every(count)
            && limits[1] <= limits[2] && limits[2] <= limits[5] && limits[5] === quotes.passed) {
          add(detail,'h3','Verlust beim sofortigen Rückverkauf');
          const counts = add(detail,'dl','');
          counts.className = 'strategy-summary';
          for (const limit of [1,2,5]) {
            field('Höchstens ' + limit + ' %',limits[limit] + ' von ' + quotes.quoted,counts);
          }
        }
        if (quotes.quoted > 0) {
          const difference = quotes.medianReturnUsdc - 20;
          const percent = (difference / 20).toLocaleString('de-AT',{
            style:'percent',maximumFractionDigits:2,minimumFractionDigits:2
          });
          add(detail,'p','Differenz zum Einsatz von 20 USDC · ' + amount(difference) + ' (' + percent + ')');
          add(detail,'p','Grundlage sind Kauf- und Rückverkaufsangebote vor Netzwerkgebühren.');
        }
      }
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }
  section.addEventListener('toggle',() => { if (section.open) update(); });
  refresh.addEventListener('click',update);
  return refreshStatus;
}
