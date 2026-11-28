import {paperGroupPnl, strategyLamp} from './paper-group-pnl.js?v=B20-M11-FIX6';
const runId = 45678525838;
const repo = 'Achi1984/meridian';
const source = 'https://api.github.com/repos/' + repo + '/contents/top100-' + runId + '.json?ref=paper-dashboard-data';
const money = value => value.toLocaleString('de-AT', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' USDT';
const count = value => Number.isSafeInteger(value) && value >= 0;

export function dashboardRows(report) {
  if (report?.runId !== runId || !['first','final'].includes(report.stage) ||
      !count(report.asOf) || !Number.isFinite(new Date(report.asOf * 1000).getTime())) throw Error('report');
  const rows = [['direct','Direkter Ausbruch'], ['retest','Rücktest']].map(([key, name]) => {
    const a = report.accounts?.[key];
    if (!a || ![a.open, a.closed, a.pending].every(count) || a.pending > a.closed ||
        !Number.isFinite(a.realized) || (a.closed === a.pending && a.realized !== 0)) throw Error('account');
    const equity = a.open || a.pending ? null : 1000 + a.realized;
    return {name, equity, open:a.open, closed:a.closed, pending:a.pending, realized:a.realized};
  });
  return [...rows, {name:'Cash halten', equity:1000, open:0, closed:0, pending:0, realized:0}];
}

function mountPilot(section) {
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  const status = element('p', '');
  status.setAttribute('role','status');
  const accounts = element('div','');
  const button = element('button','Bericht aktualisieren');
  button.type = 'button';
  const link = element('a','Paperlauf auf GitHub');
  link.href = 'https://github.com/' + repo + '/actions/runs/' + runId;
  const sourceLine = element('p','');
  sourceLine.append(link);
  section.append(status, accounts, button, sourceLine);
  const headline=paperGroupPnl(section);headline();
  let lastReport = null;
  async function refresh() {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const response = await fetch(source, {cache:'no-store', credentials:'omit',
        headers:{Accept:'application/vnd.github.raw+json'}, signal:AbortSignal.timeout(10000)});
      if (response.status === 404 && !lastReport) {
        status.textContent = 'Wartet auf ersten Bericht.';
        return;
      }
      if (!response.ok) throw Error('unavailable');
      const report = await response.json();
      const rows = dashboardRows(report);
      const time = new Date(report.asOf * 1000).toLocaleString('de-AT',{timeZone:'Europe/Vienna'});
      const stage = report.stage === 'final' ? 'Abschlussbericht' : 'Zwischenbericht';
      const models = rows.slice(0, 2).map(account => [
        account.name + ' (' + account.open + ' offen)',
        account.closed > 0 && account.closed === account.pending ? null : account.realized
      ]);
      const note = [stage, rows.some(account => account.pending) && 'Funding offen'].filter(Boolean).join(' · ');
      lastReport = {models, note};
      headline('Realisiert', 'USDT', models, note);
      const fragment = document.createDocumentFragment();
      for (const a of rows) {
        fragment.append(element('h4', a.name), element('p', a.equity === null
          ? 'Kontowert ausstehend' : 'Kontowert ' + money(a.equity)),
        element('p', (a.pending && a.closed === a.pending ? 'Realisiert netto offen' : 'Realisiert netto ' + money(a.realized)) + ' · ' + a.closed + ' geschlossen · ' + a.open + ' offen'
          + (a.pending ? ' · Funding ausstehend bei ' + a.pending : '')));
      }
      accounts.replaceChildren(fragment);
      status.textContent = stage + ' · Datenstand ' + time + ' (Wien)';
    } catch {
      if (lastReport) headline('Realisiert', 'USDT', lastReport.models, lastReport.note + ' · Abruf fehlgeschlagen');
      if (!lastReport) status.textContent = 'Bericht derzeit nicht abrufbar.';
      else if (!status.textContent.endsWith('Abruf fehlgeschlagen.')) status.textContent += ' · Abruf fehlgeschlagen.';
    } finally {
      button.disabled = false;
    }
  }
  section.addEventListener('toggle', () => { if (section.open) refresh(); });
  button.addEventListener('click', refresh);
  return refresh;
}

const followupBranch = 'paper/top100-confirmation-20261127';
const firstFollowup = 46069348362;
const models = [['direct','Ausbruch'], ['retest','Rücktest'], ['confirmed','Stundenbestätigung']];

export function followupRows(report, id) {
  if (report?.runId !== id || !['initial','first','final'].includes(report.stage) ||
      !count(report.asOf) || !count(report.start) || !count(report.observations)) throw Error('report');
  return models.map(([key,name]) => {
    const a = report.accounts?.[key];
    if (!a || !count(a.closed) || !count(a.open) || !Number.isFinite(a.realizedGross) ||
        !Number.isFinite(a.fees) || a.fees < 0 ||
        ![a.funding,a.openGross,a.equity].every(v => v === null || Number.isFinite(v))) throw Error('account');
    const complete = a.openGross !== null && a.funding !== null;
    if (complete !== (a.equity !== null) ||
        (complete && Math.abs(1000 + a.realizedGross + a.openGross - a.fees + a.funding - a.equity) > 0.000001))
      throw Error('balance');
    return {name,...a};
  });
}

export function mountTop100(section) {
  const doc = section.ownerDocument;
  function add(parent, tag, text) {
    const item = doc.createElement(tag);
    item.textContent = text;
    parent.append(item);
    return item;
  }
  const status = add(section,'p','Folgeversuch wird geladen …');
  status.setAttribute('role','status');
  const accounts = add(section,'div','');
  const action = add(section,'button','Bericht aktualisieren');
  action.type = 'button';
  const link = add(section,'a','Folgeversuch auf GitHub');
  const archive = add(section,'details','');
  add(archive,'summary','Vorheriger Pilotlauf');
  mountPilot(archive);
  const lamp = strategyLamp(section);
  const headline = paperGroupPnl(section);
  headline();
  const api = 'https://api.github.com/repos/' + repo;
  let id = firstFollowup, last = null;
  link.href = 'https://github.com/' + repo + '/actions/runs/' + id;
  async function read(url, raw = false) {
    const r = await fetch(url,{cache:'no-store', credentials:'omit', signal:AbortSignal.timeout(10000),
      headers:{Accept:raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'}});
    if (!r.ok) throw Error('fetch');
    return r.json();
  }
  async function refresh() {
    if (action.disabled) return;
    action.disabled = true;
    try {
      try {
        const feed = await read(api + '/actions/runs?branch=' + encodeURIComponent(followupBranch) + '&event=push&per_page=20');
        for (const run of feed.workflow_runs) {
          if (run.path === '.github/workflows/top100-breakout.yml' && run.head_branch === followupBranch && count(run.id))
            id = Math.max(id,run.id);
        }
        const run = feed.workflow_runs.find(r=>r.id===id && r.head_branch===followupBranch && r.path==='.github/workflows/top100-breakout.yml');
        if (run?.status === 'completed') lamp('off',run.conclusion === 'success' ? 'Beendet' : 'Gestoppt');
        else if (run?.status === 'in_progress') lamp('on','Aktiv');
        else if (run && ['queued','pending','waiting','requested'].includes(run.status)) lamp('warn','Wartet');
        else lamp('unknown','Unbekannt');
      } catch { lamp('unknown','Unbekannt'); /* The known campaign has its own versioned report. */ }
      link.href = 'https://github.com/' + repo + '/actions/runs/' + id;
      if (last && last.id !== id) { last = null; accounts.replaceChildren(); headline(); }
      const report = await read(api + '/contents/top100-followup-' + id + '.json?ref=paper-dashboard-data',true);
      const rows = followupRows(report,id);
      if (last && report.asOf < last.asOf) throw Error('older report');
      if (report.stage === 'final') {
        lamp('off','Beendet');
        doc.getElementById?.('paper-history-section')?.append(section);
      } else {
        const reports = doc.getElementById?.('paper-reports-section');
        if (reports && section.parentElement !== reports.parentElement) reports.before(section);
      }
      const stage = {initial:'Startbericht', first:'Zwischenbericht', final:'Abschlussbericht'}[report.stage];
      const values = rows.map(a=>[a.name,a.equity === null ? null : a.equity-1000]);
      last = {id,asOf:report.asOf,values,stage};
      headline('Gesamt-P/L','USDT',values,stage);
      const stamp = report.stage === 'initial' ? report.start : report.asOf;
      status.textContent = stage + ' · ' + new Date(stamp*1000).toLocaleString('de-AT',{timeZone:'Europe/Vienna'}) + ' Wien';
      accounts.replaceChildren();
      const show = v => v === null ? 'offen' : money(v);
      for (const a of rows) {
        const panel = add(accounts,'details','');
        add(panel,'summary',a.name + ' · Kontowert ' + show(a.equity));
        add(panel,'p',a.closed + ' geschlossen · ' + a.open + ' offen');
        add(panel,'p','Realisiert brutto ' + show(a.realizedGross) + ' · Offen brutto ' + show(a.openGross));
        add(panel,'p','Gebühren ' + show(a.fees) + ' · Funding ' + show(a.funding));
      }
    } catch {
      if (last) {
        headline('Gesamt-P/L','USDT',last.values,last.stage + ' · Abruf fehlgeschlagen');
        if (!status.textContent.endsWith('Abruf fehlgeschlagen')) status.textContent += ' · Abruf fehlgeschlagen';
      } else status.textContent = 'Bericht zum Folgeversuch derzeit nicht abrufbar.';
    } finally { action.disabled = false; }
  }
  section.addEventListener('toggle', () => { if (section.open) refresh(); });
  action.addEventListener('click', refresh);
  return refresh;
}
