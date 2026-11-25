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

import {mountEightHourComparison} from './solana-eight-hour.js?v=B19-M11-FIX1';

// The experiment stores raw USDC in millionths and charges 0.05 USDC per fill.
const swingRun = 45624335706;
const swingSource = 'https://raw.githubusercontent.com/' + repo +
  '/paper/second-wave-48h-data/studies/swing48/' + swingRun + '/state.json';

export function swingAccounts(state) {
  const isMap = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!isMap(state?.candidates) || !isMap(state.positions) || !count(state.start) ||
      !count(state.lastTick) || state.lastTick < state.start) throw Error('Invalid checkpoint');
  return ['fixed','runner'].map(key => {
    let cash = 1000000000, realized = 0, open = 0;
    for (const p of Object.values(state.positions)) {
      const arm = p.arms?.[key];
      if (!count(p.qty) || !p.qty || !count(arm?.left) || !Array.isArray(arm.fills)) throw Error('Position');
      let sold = 0, proceeds = 0;
      for (const f of arm.fills) {
        if (!count(f.qty) || !f.qty || !count(f.gross) || f.fee !== 50000) throw Error('Fill');
        sold += f.qty;
        proceeds += f.gross - f.fee;
      }
      if (sold + arm.left !== p.qty) throw Error('Quantity mismatch');
      cash += proceeds - 20050000;
      realized += proceeds - 20050000 * (sold / p.qty);
      if (arm.left > 0) open++;
    }
    if (!count(cash) || cash !== state.cash?.[key]) throw Error('Cash mismatch');
    return {key, cash:cash/1e6, realized:realized/1e6, open};
  });
}

export function mountSwingCard(section, add, load = read) {
  const card = add(section,'section','');
  card.className = 'solana-comparison';
  add(card,'h3','Memecoins · 48 Stunden');
  const status = add(card,'p','Laufstand wird geladen.');
  status.setAttribute('role','status');
  const body = add(card,'div','');
  add(card,'a','Paperlauf auf GitHub').href = runs + swingRun;
  let last = 0, pending = false;
  return async function refreshSwing() {
    if (pending) return;
    pending = true;
    try {
      const state = await load(swingSource);
      const rows = swingAccounts(state);
      if (state.lastTick < last) throw Error('Older checkpoint');
      const entries = Object.keys(state.positions).length;
      const pools = Object.keys(state.candidates).length;
      const elapsed = state.lastTick-state.start;
      const phase = elapsed >= 72*3600 ? 'Ende des Beobachtungsfensters' :
        elapsed >= 24*3600 || entries >= 30 ? 'Nachbeobachtung' :
        entries ? 'Einstiegsphase' : 'Wartet auf Einstieg';
      const time = new Date(state.lastTick*1000).toLocaleString('de-AT',{
        timeZone:'Europe/Vienna', day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      const stale = Date.now()/1000-state.lastTick > 1200 && elapsed < 72*3600;
      status.textContent = phase + ' · ' + pools + ' Pools · ' + entries + ' Einstiege · ' +
        time + ' (Wien)' + (stale ? ' · Datenstand veraltet' : '');
      body.replaceChildren();
      for (const row of rows) {
        const line = add(body,'p','');
        add(line,'strong',row.key === 'fixed' ? 'Festes Gewinnziel' : 'Teilverkauf');
        add(line,'span','Kasse ' + amount(row.cash) + ' · ' + row.open + ' offen').className = 'account-value';
        add(line,'span','Realisiert ' + amount(row.realized)).className = 'account-pnl af-' +
          (row.realized > 0 ? 'positive' : row.realized < 0 ? 'negative' : 'muted');
      }
      last = state.lastTick;
    } catch {
      if (!last) status.textContent = 'Laufstand derzeit nicht abrufbar.';
      else if (!status.textContent.includes('Abruf fehlgeschlagen')) status.textContent += ' · Abruf fehlgeschlagen';
    } finally { pending = false; }
  };
}

export function mountSolanaReport(section) {
  const doc = section.ownerDocument;
  const add = (parent, tag, text) => {
    const child = doc.createElement(tag);
    child.textContent = text;
    parent.append(child);
    return child;
  };
  const refreshSwing = mountSwingCard(section, add);
  const refreshComparison = mountEightHourComparison(section, add, read, amount);
  const refresh = add(section,'button','Aktualisieren');
  refresh.type = 'button';
  refresh.className = 'strategy-entry-link';
  const archive = add(section,'details','');
  add(archive,'summary','Pilotarchiv und Analysen');
  const badge = add(archive,'small','Status wird geladen');
  badge.className = 'pilot-status';
  const live = add(archive,'p','Laufstatus wird beim Öffnen geladen.');
  live.setAttribute('role','status');
  const notice = add(archive,'p','');
  notice.hidden = true;
  const body = add(archive,'div','');
  const source = add(archive,'a','Pilotläufe auf GitHub');
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
    void refreshSwing();
    void refreshComparison();
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
      const windows = s.exitWindowComparison;
      if (windows && [windows.observed,windows.paired,windows.incomplete,
          windows.fourBetter,windows.fiveBetter,windows.equal].every(count)
          && windows.observed === windows.paired + windows.incomplete
          && windows.paired === windows.fourBetter + windows.fiveBetter + windows.equal
          && (windows.paired ? Number.isFinite(windows.medianDifferenceUsdc) : windows.medianDifferenceUsdc === null)) {
        const detail = add(body,'details','');
        add(detail,'summary','Rückverkauf nach 4 oder 5 Minuten');
        add(detail,'p',windows.paired + ' vollständige Kurspaare · ' + windows.incomplete + ' unvollständig');
        if (windows.paired) {
          add(detail,'p','Mehr USDC nach 4 Minuten: ' + windows.fourBetter +
              ' · nach 5 Minuten: ' + windows.fiveBetter + ' · gleicher Betrag: ' + windows.equal);
          const coverage = windows.breakEven;
          if (coverage && Number.isFinite(coverage.requiredUsdc) && coverage.requiredUsdc > 0
              && [coverage.fourCovered,coverage.fiveCovered].every(n=>count(n) && n <= windows.paired)) {
            add(detail,'p','Einsatz und geschätzte Gebühren gedeckt (ab ' + amount(coverage.requiredUsdc) +
                '): nach 4 Minuten ' + coverage.fourCovered + ' von ' + windows.paired +
                ', nach 5 Minuten ' + coverage.fiveCovered + ' von ' + windows.paired + '.');
          }
          add(detail,'p','Median der Differenz (5 minus 4 Minuten): ' + amount(windows.medianDifferenceUsdc));
        }
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
  let swingTimer;
  function syncSwingTimer() {
    clearInterval(swingTimer);
    if (section.open && !doc.hidden) {
      void refreshSwing();
      swingTimer = setInterval(refreshSwing, 300000);
    }
  }
  section.addEventListener('toggle',syncSwingTimer);
  doc.addEventListener('visibilitychange',syncSwingTimer);
  refresh.addEventListener('click',update);
  return refreshStatus;
}

export function mountLiveScanner(section) {
  const doc = section.ownerDocument;
  function add(parent, tag, text) {
    const element = doc.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element;
  }
  const status = add(section, 'p', 'Warte auf Scanner-Daten.');
  status.setAttribute('role', 'status');
  const controls = add(section, 'label', 'Rangliste ');
  const select = add(controls, 'select', '');
  for (const minutes of [5, 10, 30, 60, 120, 180, 360, 720]) {
    add(select, 'option', minutes < 120 ? minutes + ' Minuten' : minutes / 60 + ' Stunden').value = String(minutes);
  }
  const result = add(section, 'div', '');
  const fmt = (value, unit) => Number.isFinite(value)
    ? value.toLocaleString('de-AT', {maximumFractionDigits:2}) + unit : '–';
  const time = seconds => new Date(seconds*1000).toLocaleString('de-AT', {
    timeZone:'Europe/Vienna', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
  });
  const reasons = {shortHistory:'Historie zu kurz', missing30mData:'30-Minuten-Daten lückenhaft',
    quoteUnavailable:'Quote fehlt', roundTripCost:'Rückverkauf zu teuer',
    tradeDataUnavailable:'Handelsdaten fehlen', marketDataUnavailable:'Marktdaten fehlen', outsidePairedTopTen:'Außerhalb der gemeinsamen Top 10'};
  let latest, pending, timer, failed = false;
  function mint(parent, c) {
    const link = add(parent, 'a', c.symbol || c.mint.slice(0,8));
    link.href = 'https://jup.ag/tokens/' + encodeURIComponent(c.mint);
    link.title = c.mint;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  function render() {
    if (!latest) {
      status.textContent = failed ? 'Noch kein Scanner-Stand abrufbar.' : 'Scanner-Daten werden geladen …';
      return;
    }
    const age = Math.max(0, Math.floor((Date.now()/1000-latest.asOf)/60));
    status.textContent = 'Stand ' + time(latest.asOf) + ' (Wien) · vor ' + age + ' Min. · ' +
      latest.sampled + ' geprüft · ' + latest.qualified + ' in der Vorauswahl' +
      (age >= 30 ? ' · Daten veraltet' : '') + (failed ? ' · Aktualisierung fehlgeschlagen' : '') +
      (latest.warnings.length ? ' · Datenquelle eingeschränkt' : '');
    result.replaceChildren();
    const w = select.value || '5';
    const ranked = latest.candidates.filter(c => Number.isInteger(c.ranks[w]))
      .sort((a,b) => a.ranks[w]-b.ranks[w]);
    if (!ranked.length) add(result, 'p', 'Kein Pool mit vollständigem Zeitfenster und positivem Volumen.');
    else {
      const wrap = add(result,'div','');
      wrap.style.overflowX = 'auto';
      const table = add(wrap,'table','');
      const header = add(add(table,'thead',''),'tr','');
      for (const label of ['Rang','Coin','Volumen','Kurs','Käufer','Netto aus 20 USDC','Scanner-Auswahl']) {
        add(header,'th',label).scope = 'col';
      }
      const body = add(table,'tbody','');
      for (const c of ranked) {
        const row = add(body,'tr','');
        const stats = c.windows[w];
        add(row,'td',String(c.ranks[w]));
        mint(add(row,'td',''),c);
        add(row,'td',fmt(stats.volumeUsd,' USD'));
        add(row,'td',fmt(stats.changePct,' %'));
        add(row,'td',fmt(stats.uniqueBuyers,''));
        add(row,'td',fmt(c.netResaleUsdc,' USDC'));
        add(row,'td',c.reasons.map(r => reasons[r] || r).join(' · ') || 'Vorauswahl');
      }
    }
    const young = latest.candidates.filter(c => c.earliest30mAt > latest.asOf)
      .sort((a,b) => a.earliest30mAt-b.earliest30mAt);
    if (young.length) {
      const watch = add(result,'details','');
      add(watch,'summary','Beobachtungsliste (' + young.length + ')');
      for (const c of young) {
        const line = add(watch,'p','');
        mint(line,c);
        add(line,'span',' · 30 volle Minuten frühestens ' + time(c.earliest30mAt) + ' (Wien)');
      }
    }
    const gaps = latest.candidates.filter(c => c.reasons.includes('marketDataUnavailable') ||
      c.reasons.includes('missing30mData') || c.reasons.includes('tradeDataUnavailable')).length;
    if (gaps) add(result,'p','Fehlende Marktdaten bei ' + gaps + ' Kandidaten.');
  }
  async function refresh() {
    if (pending || !section.open || doc.hidden) return;
    pending = true;
    try {
      const s = await read(api+'/contents/solana-scanner-live.json?ref=paper-dashboard-data',true);
      if (s.schema !== 1 || !count(s.asOf) || !count(s.qualified) || !Array.isArray(s.warnings) ||
          !Array.isArray(s.candidates) || s.sampled !== s.candidates.length ||
          !s.candidates.every(c => typeof c.mint === 'string' && c.ranks && c.windows &&
            Array.isArray(c.reasons) && Object.keys(c.ranks).every(k => c.windows[k]))) throw Error('format');
      if (!latest || s.asOf >= latest.asOf) latest = s;
      failed = false;
    } catch { failed = true; }
    finally { pending = false; render(); }
  }
  function activate() {
    clearInterval(timer);
    if (!section.open || doc.hidden) return;
    void refresh();
    timer = setInterval(refresh, 60000);
  }
  select.addEventListener('change',render);
  section.addEventListener('toggle',activate);
  doc.addEventListener('visibilitychange',activate);
  return activate;
}
