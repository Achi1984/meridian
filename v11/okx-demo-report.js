import {strategyLamp} from './paper-group-pnl.js?v=B20-M11-FIX6';
import {okxStatus} from './paper-status.js?v=B20-M11-FIX6';
const source = 'https://api.github.com/repos/Achi1984/meridian/contents/okx-demo-pilot.json?ref=paper-dashboard-data';
const amount = number => number.toLocaleString('de-AT', {maximumFractionDigits: 8});

const swingSource = source.replace('okx-demo-pilot.json', 'okx-swing-demo.json');
const actions = new Map([
  ['pilot superseded', 'Einstiege an Long/Short-Demopilot übergeben'], ['wait', 'Wartet auf Einstieg'], ['hold', 'Position offen'],
  ['entry unfilled', 'Einstieg ohne Ausführung'], ['entry window ended', 'Einstiegsfenster beendet'],
  ['closed', 'Trade abgeschlossen']
]);

export function swingText(report) {
  const {action, asOf, flatStartSignal, positionBTC} = report;
  if (!actions.has(action) || !Number.isFinite(Date.parse(asOf))) throw Error('invalid swing report');
  const parts = ['BTC-Swingbot · ' + actions.get(action),
    'Stand ' + new Date(asOf).toLocaleString('de-AT', {timeZone:'Europe/Vienna'}) + ' (Wien)'];
  if (flatStartSignal) {
    if (!['FLAT', 'LONG', 'SHORT'].includes(flatStartSignal)) throw Error('invalid signal');
    parts.push('Einstiegssignal ' + flatStartSignal);
  }
  if (action === 'hold') {
    if (!['0.0001', '-0.0001'].includes(positionBTC)) throw Error('invalid position');
    parts.push('Position ' + amount(Number(positionBTC)) + ' BTC');
  } else {
    parts.push('Position 0 BTC');
  }
  if (action === 'closed') {
    const pnl = report.realizedAfterTradingFeesUSDC;
    if (typeof pnl !== 'string' || !pnl.trim() || !Number.isFinite(Number(pnl))) throw Error('invalid PnL');
    parts.push('Realisiert nach Handelsgebühren ' + amount(Number(pnl)) + ' USDC (vor Funding)');
  } else {
    parts.push('0 abgeschlossene Strategietrades');
  }
  return parts.join(' · ');
}

export function mountOkxDemo(section) {
  const doc = section.ownerDocument;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Demokonto aktualisieren';
  const swing = doc.createElement('p');
  swing.setAttribute('role', 'status');
  const bots = doc.createElement('p');
  bots.setAttribute('role', 'status');
  const lamp = strategyLamp(section);
  const concise = doc.createElement('p');
  const details = doc.createElement('details');
  const title = doc.createElement('summary');
  title.textContent = 'Details';
  details.append(title, bots, swing, status);
  section.append(concise, details, button);
  async function loadBots() {
    try {
      const response = await fetch(source.replace('okx-demo-pilot.json', 'okx-filter-demo.json'),
        {credentials:'omit', cache:'no-store', headers:{Accept:'application/vnd.github.raw+json'},
         signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('unavailable');
      const report = await response.json();
      bots.textContent = filterText(report);
      const [tone,label,detail] = okxStatus(report);
      lamp(tone,label);
      const fills = Object.values(report.sessions).filter(r=>r.state==='closed' && r.demoFilled);
      concise.textContent = detail + ' · ' + fills.length + ' abgeschlossene Demotrades';
    } catch {
      lamp('unknown','Unbekannt');
      concise.textContent = 'Demobericht nicht verfügbar.';
      bots.textContent = 'BTC Long/Short · Demobericht derzeit nicht verfügbar.';
    }
  }
  async function loadPilot() {
    try {
      const response = await fetch(source, {credentials:'omit', cache:'no-store',
        headers:{Accept:'application/vnd.github.raw+json'}, signal:AbortSignal.timeout(10000)});
      if (response.status === 404) {
        status.textContent = 'Wartet auf den ersten abgeschlossenen OKX-Paperlauf.';
        return;
      }
      if (!response.ok) throw Error('report unavailable');
      const r = await response.json();
      if (![r.net,r.fees,r.available].every(Number.isFinite) || r.closed !== 2 ||
          r.position !== 0 || !Number.isFinite(Date.parse(r.asOf)) ||
          r.instrument !== 'BTC-USD_UM_XPERP-310328') throw Error('invalid report');
      const time = new Date(r.asOf).toLocaleString('de-AT', {timeZone:'Europe/Vienna'});
      status.textContent = 'Technischer Pilot · Stand ' + time + ' (Wien) · Verfügbar ' + amount(r.available) +
        ' USDC · 2 geschlossene BTC-Demotrades · Position 0 BTC · Netto-PnL ' +
        amount(r.net) + ' USDC · Gebühren ' + amount(r.fees) + ' USDC';
    } catch {
      status.textContent = 'OKX-Demobericht derzeit nicht verfügbar.';
    }
  }
  async function loadSwing() {
    try {
      const response = await fetch(swingSource, {credentials:'omit', cache:'no-store',
        headers:{Accept:'application/vnd.github.raw+json'}, signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('unavailable');
      swing.textContent = swingText(await response.json());
    } catch {
      swing.textContent = 'BTC-Swingbot · Strategiebericht derzeit nicht verfügbar.';
    }
  }
  async function refresh() {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await Promise.all([loadBots(), ...(details.open ? [loadSwing(),loadPilot()] : [])]);
    } finally {
      button.disabled = false;
    }
  }
  details.addEventListener('toggle', () => { if (details.open) { void loadSwing(); void loadPilot(); } });
  button.addEventListener('click', refresh);
  status.textContent = 'Bericht beim Öffnen laden.';
  section.addEventListener('toggle', () => {
    if (section.open) refresh();
  });
  return refresh;
}

export function filterText(report) {
  const obs = report.observation;
  if (report.instrument !== 'BTC-USD_UM_XPERP-310328' ||
      !['FLAT', 'LONG', 'SHORT'].includes(obs?.flatStartSignal) ||
      !Number.isFinite(Date.parse(report.asOf))) throw Error('invalid report');
  const rows = Object.values(report.sessions);
  const states = {reserved:'Orderbestätigung ausstehend', tracking:'Ausstieg wird überwacht',
    exit_due:'Abschluss wird abgeglichen', closed:'Abgeschlossen'};
  const parts = ['BTC Long/Short · OKX-Demo',
    'Stand ' + new Date(report.asOf).toLocaleString('de-AT',{timeZone:'Europe/Vienna'}) + ' (Wien)',
    'Signal ' + obs.flatStartSignal];
  if (obs.status !== 'EVALUATED') parts.push('Filter wartet auf Stundenvergleich');
  else if (obs.flatStartSignal !== 'FLAT') {
    parts.push((obs.filteredLong || obs.filteredShort) ? 'Einstieg zugelassen' : 'Einstieg gefiltert');
  }
  const sum = (items, field) => amount(items.reduce((total, r) => {
    if (typeof r[field] !== 'string' || !Number.isFinite(Number(r[field]))) throw Error('invalid PnL');
    return total + Number(r[field]);
  }, 0));
  for (const side of ['LONG','SHORT']) {
    const trades = rows.filter(r => r.signal === side);
    const completed = trades.filter(r => r.state === 'closed');
    const fills = completed.filter(r => r.demoFilled);
    parts.push(side + ' · ' + fills.length + ' abgeschlossene Demotrades' +
      (fills.length ? ' · ' + sum(fills,'demoAfterFees') + ' USDC nach Handelsgebühren, vor Funding' : ''));
    if (fills.length) {
      const settled = fills.filter(r => typeof r.demoNetUSDC === 'string');
      if (settled.length === fills.length) {
        parts.push('Netto inkl. Funding ' + sum(settled,'demoNetUSDC') +
          ' USDC · davon Funding ' + sum(settled,'fundingUSDC') + ' USDC');
      } else {
        parts.push('Funding-Abgleich offen für ' + (fills.length - settled.length) + ' Demotrade(s)');
      }
    }
    if (completed.length) parts.push('Papiervergleich vor Funding · Basis ' + sum(completed,'modelBase') +
      ' / Filter ' + sum(completed,'modelFiltered') + ' USDC');
    const last = trades.at(-1);
    if (last) parts.push('Letztes Signal ' + last.day + ' · ' + states[last.state] +
      (last.demoFilled ? ' · Einstieg ausgeführt' : last.accepted ? ' · kein bestätigter Fill' : ' · ausgelassen'));
  }
  return parts.join(' · ');
}

export function createShortComparison() {
  const study=document.createElement('details');
  const title=document.createElement('summary');
  title.textContent='Short nach Fehlausbruch · Papervergleich';
  const status=document.createElement('p');
  status.setAttribute('role','status');
  const accounts=document.createElement('div');
  const retry=document.createElement('button');
  retry.type='button';
  retry.textContent='Vergleich aktualisieren';
  const money=new Intl.NumberFormat('de-AT',{minimumFractionDigits:2,maximumFractionDigits:2});
  async function refresh() {
    if(retry.disabled || !study.open) return;
    retry.disabled=true;
    try {
      const response=await fetch('https://api.github.com/repos/Achi1984/meridian/contents/okx-rejection-paper.json?ref=paper-dashboard-data',{
        cache:'no-store',credentials:'omit',headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw Error('unavailable');
      const report=await response.json();
      const time=Date.parse(report.asOf);
      const phases={planned:'Geplant',running:'Paperlauf',final:'Abgeschlossen'};
      if(!Number.isFinite(time)||!Object.hasOwn(phases,report.phase)) throw Error('report');
      const rows=[];
      for(const [name,a] of [['Mit Historienfilter',report.historyFilter],['Ohne Historienfilter',report.control]]) {
        if(!Number.isFinite(a?.equity)||![a.open,a.closed].every(n=>Number.isSafeInteger(n)&&n>=0)) throw Error('account');
        const row=document.createElement('p');
        const value=document.createElement('strong');
        value.textContent=money.format(a.equity)+' USDT';
        value.className=a.equity>1000?'paper-gain':a.equity<1000?'paper-loss':'';
        row.append(name+' · ',value,document.createElement('br'),a.closed+' geschlossen · '+a.open+' offen');
        rows.push(row);
      }
      accounts.replaceChildren(...rows);
      const stale=report.phase!=='final' && Date.now()-time>6*3600000;
      status.textContent=phases[report.phase]+' · '+new Date(time).toLocaleString('de-AT',{timeZone:'Europe/Vienna'})+' Wien'+(stale?' · Stand veraltet':'');
    } catch {
      accounts.replaceChildren();
      status.textContent='Vergleich derzeit nicht abrufbar.';
    } finally { retry.disabled=false; }
  }
  retry.addEventListener('click',refresh);
  study.addEventListener('toggle',refresh);
  study.append(title,status,accounts,retry);
  return study;
}
