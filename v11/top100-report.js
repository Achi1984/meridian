import {paperGroupPnl} from './paper-group-pnl.js?v=B20-M11-FIX6';
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

export function mountTop100(section) {
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
