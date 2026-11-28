const source = 'https://api.github.com/repos/Achi1984/meridian/contents/okx-demo-pilot.json?ref=paper-dashboard-data';
const amount = number => number.toLocaleString('de-AT', {maximumFractionDigits: 8});

export function mountOkxDemo(section) {
  const doc = section.ownerDocument;
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Demokonto aktualisieren';
  section.append(status, button);
  async function refresh() {
    if (button.disabled) return;
    button.disabled = true;
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
      status.textContent = 'Stand ' + time + ' (Wien) · Verfügbar ' + amount(r.available) +
        ' USDC · 2 geschlossene BTC-Demotrades · Position 0 BTC · Netto-PnL ' +
        amount(r.net) + ' USDC · Gebühren ' + amount(r.fees) + ' USDC';
    } catch {
      status.textContent = 'OKX-Demobericht derzeit nicht verfügbar.';
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
