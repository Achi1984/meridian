const api = 'https://api.github.com/repos/Achi1984/meridian';
const workflows = [
  ['Solana · Memecoin-Pilot', 'main', 'solana-meme-paper-bot.yml'],
  ['Solana · Ausstiege A–F', 'paper/overnight-staged-exits', 'newcomer-eight-hour.yml'],
  ['Solana · Haltertest', 'paper/holder-token2022-forward', 'holder-concentration.yml'],
  ['Top 100 · Ausbruch und Rücktest', 'paper/top100-confirmation-20261127', 'top100-breakout.yml']
];
const raw = name => api + '/contents/' + name + '?ref=paper-dashboard-data';
const uncertain = ['unknown', 'Unbekannt', 'Laufdaten fehlen'];

export function okxStatus(report, now = Date.now()) {
  const obs = report?.observation;
  const stamp = obs?.decisionTs;
  if (report?.instrument !== 'BTC-USD_UM_XPERP-310328' || !Number.isSafeInteger(stamp) ||
      !['LONG','SHORT','FLAT'].includes(obs.flatStartSignal) || stamp > now || !report.sessions) return uncertain;
  if (now-stamp > 90*60000) return ['warn', 'Stand veraltet', 'Letzte Signalprüfung', stamp];
  const open = Object.values(report.sessions).find(t => t.state !== 'closed');
  if (open) {
    if (open.state === 'reserved' || open.state === 'exit_due') return ['warn', 'Im Abgleich', 'Orderbestätigung ausstehend', stamp];
    if (open.state !== 'tracking') return uncertain;
    return ['on','Aktiv',open.demoFilled ? 'Demoposition offen' : 'Papiervergleich läuft', stamp];
  }
  if (now >= Date.UTC(2026,11,8)) return ['off','Beendet','Einstiegsfenster geschlossen',stamp];
  const today = Object.hasOwn(report.sessions, obs.lastSessionUtc);
  const detail = today ? 'Tagessignal verarbeitet' : obs.flatStartSignal === 'FLAT' ? 'Wartet auf Signal' :
    obs.status !== 'EVALUATED' ? 'Wartet auf Stundenvergleich' : 'Signal ' + obs.flatStartSignal;
  return ['on','Aktiv',detail,stamp];
}

export function runStatus(run) {
  const stamp = Date.parse(run?.updated_at);
  if (!Number.isFinite(stamp)) return uncertain;
  if (run.status === 'in_progress') return ['on','Aktiv','Paperlauf läuft',stamp];
  if (['queued','waiting','pending','requested'].includes(run.status)) return ['warn','Wartet','Lauf eingeplant',stamp];
  if (run.status !== 'completed') return uncertain;
  if (run.conclusion === 'success') return ['off','Beendet','Lauf abgeschlossen',stamp];
  if (run.conclusion === 'cancelled') return ['off','Gestoppt','Lauf abgebrochen',stamp];
  return ['off','Gestoppt','Laufergebnis: ' + (run.conclusion || 'unbekannt'),stamp];
}

async function read(url, isRaw=false) {
  const response = await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000),
    headers:{Accept:isRaw?'application/vnd.github.raw+json':'application/vnd.github+json'}});
  if (!response.ok) throw Error('unavailable');
  return response.json();
}
const sources = [
  ['OKX · BTC Long/Short', async () => okxStatus(await read(raw('okx-filter-demo.json'),true))],
  ['OKX · BTC-Swingpilot', async () => {
    const r=await read(raw('okx-swing-demo.json'),true);
    const stamp=Date.parse(r.asOf);
    if (!Number.isFinite(stamp)) return uncertain;
    if (['pilot superseded','closed','entry window ended','entry unfilled'].includes(r.action))
      return ['off','Beendet',r.action==='pilot superseded'?'An Long/Short übergeben':'Pilot abgeschlossen',stamp];
    return ['warn','Stand prüfen','Letzter Pilotbericht',stamp];
  }],
  ...workflows.map(([name,branch,file]) => [name, async () => {
    const url = branch==='main' ? api+'/actions/workflows/'+file+'/runs?branch=main&per_page=1' :
      api+'/actions/runs?branch='+encodeURIComponent(branch)+'&per_page=30';
    const feed=await read(url);
    return runStatus(feed.workflow_runs.find(r=>r.path==='.github/workflows/'+file && r.head_branch===branch));
  }])
];

export function mountPaperStatus(panel) {
  const rows=panel.querySelector('[data-status-rows]');
  const count=panel.querySelector('output');
  const button=panel.querySelector('button');
  const view=panel.closest('.view');
  let last=0;
  async function refresh(force=false) {
    if (view.hidden || document.hidden || button.disabled || (!force && Date.now()-last<600000)) return;
    button.disabled=true;
    try {
      const results=await Promise.all(sources.map(async ([name,load])=>{
        try {return [name,await load()];} catch {return [name,uncertain];}
      }));
      results.sort((a,b)=>Number(b[1][0]==='on')-Number(a[1][0]==='on'));
      const fragment=document.createDocumentFragment();
      for (const [name,[tone,label,detail,stamp]] of results) {
        const row=document.createElement('div');
        const title=document.createElement('strong');
        title.textContent=name;
        const badge=document.createElement('span');
        badge.dataset.tone=tone;
        badge.textContent=label;
        const note=document.createElement('small');
        note.textContent=detail+(stamp?' · '+new Date(stamp).toLocaleString('de-AT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Vienna'})+' Wien':'');
        row.append(title,badge,note);
        fragment.append(row);
      }
      rows.replaceChildren(fragment);
      const known=results.filter(([,s])=>s[0]!=='unknown');
      count.textContent=known.length ? results.filter(([,s])=>s[0]==='on').length+' aktiv'+(known.length<results.length?' · '+(results.length-known.length)+' unbekannt':'') : 'Status unbekannt';
      last=Date.now();
    } finally {button.disabled=false;}
  }
  button.addEventListener('click',()=>refresh(true));
  new MutationObserver(()=>refresh()).observe(view,{attributes:true,attributeFilter:['hidden','class']});
  document.addEventListener('visibilitychange',()=>refresh());
  setInterval(()=>refresh(),60000);
  refresh();
}

if(typeof document!=='undefined') {
  const panel=document.getElementById('paper-status-panel');
  if(panel) mountPaperStatus(panel);
}
