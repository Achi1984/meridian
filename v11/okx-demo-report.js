const source = 'https://api.github.com/repos/Achi1984/meridian/contents/okx-demo-pilot.json?ref=paper-dashboard-data';
const amount = number => number.toLocaleString('de-AT', {maximumFractionDigits: 8});

const swingSource = source.replace('okx-demo-pilot.json', 'okx-swing-demo.json');
const actions = new Map([
  ['wait', 'Wartet auf Einstieg'], ['hold', 'Position offen'],
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
  section.append(swing, status, button);
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
      await Promise.all([loadSwing(), loadPilot()]);
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', refresh);
  status.textContent = 'Bericht beim Öffnen laden.';
  section.addEventListener('toggle', () => {
    if (section.open) refresh();
  });
}
