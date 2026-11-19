// Read only the structured audit from the approved seven-day run.
let cached;
let pending;

const jobUrl = 'https://api.northflank.com/v1/projects/meridian/jobs/meridian-paper-advisor';
const runIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function resolvePilotRun(token, fallback, request = fetch) {
  const endpoint = new URL(jobUrl + '/runs');
  endpoint.searchParams.set('per_page', '100');
  const signal = AbortSignal.timeout(3000);
  const seen = new Set();
  let newest;
  let completed;
  try {
    for (;;) {
      const response = await request(endpoint, {
        headers: {authorization: 'Bearer ' + token}, redirect: 'error', signal
      });
      if (!response.ok) throw new Error('Pilot run lookup unavailable');
      const {data, pagination} = await response.json();
      for (const run of data.runs) {
        if (!run || !runIdPattern.test(run.id) || !Number.isFinite(Date.parse(run.startedAt))) continue;
        if (run.status === 'RUNNING' && run.active === 1 && run.concluded === false) {
          if (!newest || Date.parse(run.startedAt) > Date.parse(newest.startedAt)) newest = run;
        } else if (run.status === 'SUCCESS' && run.concluded === true &&
            (!completed || Date.parse(run.startedAt) > Date.parse(completed.startedAt))) {
          completed = run;
        }
      }
      if (!pagination.hasNextPage) break;
      const cursor = pagination.cursor;
      if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new Error('Invalid run cursor');
      seen.add(cursor);
      endpoint.searchParams.set('cursor', cursor);
    }
  } catch (error) {
    // Existing log-only tokens may lack permission to list runs.
    if (runIdPattern.test(fallback)) return fallback;
    throw error;
  }
  if (newest) return newest.id;
  if (completed) return completed.id;
  if (runIdPattern.test(fallback)) return fallback;
  throw new Error('Missing pilot run');
}

async function readReport() {
  const token = process.env.MERIDIAN_PILOT_LOG_READ_TOKEN;
  if (!token) throw new Error('Missing pilot log access');
  const runId = await resolvePilotRun(token, process.env.MERIDIAN_PILOT_RUN_ID);
  const items = await readRun(runId, token);
  const usd = items.filter(item => item.usdRound).map(item => item.usdRound)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (usd) return {usdRound: usd};
  const rows = items.filter(item => item.report);
  const comparisons = items.map(item => item.pilotAudit?.comparison).filter(Boolean);
  // This pilot moved to a new job instance with its original account ledger.
  if (runId === '17c5dbdf-641b-465b-80cc-12b7691af7b7' && rows.length &&
      Date.now() < Date.parse('2026-11-19T15:11:42Z')) {
    const earlier = await readRun('f68a62a4-5446-481a-9aef-df1241b1e959', token).catch(() => []);
    rows.push(...earlier.filter(item => item.pilotAudit.startUtc === rows[0].pilotAudit.startUtc));
  }
  const summary = summarize(rows);
  const latestSlot = Math.floor(Date.parse(summary.report.last.at)/600000)*600000;
  summary.comparison = comparisons.filter(row => Date.parse(row.at) <= latestSlot)
    .sort((a,b) => Date.parse(b.at)-Date.parse(a.at) || Number(Boolean(b.v3))-Number(Boolean(a.v3)) || Number(Boolean(b.v2))-Number(Boolean(a.v2)))[0] ?? null;
  summary.krakenUsd = decisionUsdClose(await readUsdBars(), summary.report.last.at);
  return summary;
}

async function readUsdBars() {
  try {
    const response = await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1', {
      redirect: 'error', signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data.error) && data.error.length === 0 ? data.result?.XXBTZUSD : null;
  } catch {
    return null;
  }
}

export function decisionUsdClose(bars, decisionAt) {
  if (!Array.isArray(bars)) return null;
  const end = Math.floor(Date.parse(decisionAt) / 600000) * 600;
  // Kraken's final row is provisional, including during a delayed rollover.
  const row = bars.slice(0, -1).find(bar => Array.isArray(bar) && bar[0] === end - 60);
  if (typeof row?.[4] !== 'string' || !/^\d+(?:\.\d+)?$/.test(row[4])) return null;
  const close = Number(row[4]);
  return Number.isFinite(close) && close > 0 ? {close, at: new Date(end * 1000).toISOString()} : null;
}

async function readRun(runId, token) {
  const endpoint = new URL(jobUrl + '/logs');
  endpoint.search = new URLSearchParams({
    runId: runId, type: 'runtime', queryType: 'range',
    duration: '86400', lineLimit: '200', direction: 'backward', textIncludes: '"pilotAudit"'
  });
  const response = await fetch(endpoint, {
    headers: {authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Pilot logs unavailable');
  const {data} = await response.json();
  const rows = [];
  for (const {log} of data) {
    const start = typeof log === 'string' ? log.indexOf('{') : -1;
    if (start < 0 || log.length > 65536) continue;
    let item;
    try { item = JSON.parse(log.slice(start)); } catch { continue; }
    const {report, pilotAudit} = item || {};
    const usd = pilotAudit?.usdRound;
    if (usd?.schema === 'MERIDIAN_USD_ROUND_V1' && usd.pair === 'BTC/USD' &&
        Number.isFinite(Date.parse(usd.at)) && Number.isFinite(Date.parse(usd.start)) &&
        ['v3','v4','cash','btcHold'].every(name => usd.arms?.[name])) {
      rows.push({usdRound: usd});
      continue;
    }
    if (!report && validComparison(pilotAudit?.comparison)) {
      rows.push(item);
      continue;
    }
    if (report?.schema === 'MERIDIAN_ADVISOR_V1' && Number.isFinite(Date.parse(report.last?.at)) &&
        Number.isFinite(Date.parse(report.asOf)) && Number.isInteger(pilotAudit?.completedSlots) &&
        typeof report.last.reason === 'string' && typeof report.last.execution === 'string') rows.push(item);
  }
  return rows;
}

export function validComparison(row) {
  if (!row || !Number.isFinite(Date.parse(row.start)) || !Number.isFinite(Date.parse(row.at)) ||
      Date.parse(row.start) > Date.parse(row.at) || Date.parse(row.at) % 600000 !== 0) return false;
  if (!row.v2 && !row.v3) return false;
  const arms = [row.v1];
  if ('v2' in row) arms.push(row.v2);
  if ('v3' in row) arms.push(row.v3);
  return arms.every(arm => arm && ['BUY','SELL','HOLD','SKIPPED'].includes(arm.action) &&
    (arm.equity === null || Number.isFinite(arm.equity) && arm.equity >= 0) &&
    (arm.change === null || Number.isFinite(arm.change)));
}

export function summarize(rows) {
  // completedSlots persists across restarts. A repeated publication represents one decision.
  const unique = new Map();
  for (const item of rows) {
    const id = item.pilotAudit.completedSlots;
    if (!unique.has(id)) unique.set(id, item);
  }
  const ordered = [...unique.values()].sort((a,b) => a.pilotAudit.completedSlots - b.pilotAudit.completedSlots);
  const latest = ordered.at(-1);
  if (!latest) throw new Error('Missing pilot report');
  const trades = [];
  let entry, previous;
  for (const {report, pilotAudit} of ordered) {
    const model = report.arms?.model;
    if (!previous || pilotAudit.completedSlots !== previous.id + 1 ||
        !Number.isFinite(model?.cashEur) || !Number.isFinite(model?.btc)) entry = null;
    else if (report.last.execution === 'PAPER_BUY' && previous.btc === 0 && model.btc > 0 &&
             Number.isFinite(previous.cash)) entry = {at:report.last.at, cash:previous.cash};
    else if (report.last.execution === 'PAPER_SELL' && model.btc === 0 && entry) {
      trades.push({buyAt:entry.at, sellAt:report.last.at, netEur:model.cashEur-entry.cash});
      entry = null;
    }
    previous = {id:pilotAudit.completedSlots, btc:model?.btc, cash:model?.cashEur};
  }
  return {report:latest.report, pilotAudit:latest.pilotAudit,
    decisions:ordered.slice(-10).reverse().map(({report}) => report.last), trades:trades.reverse()};
}

export async function latestPilotReport() {
  if (cached && Date.now() < cached.until) return cached.value;
  pending ??= readReport().then(value => {
    cached = {value, until: Date.now() + 30000};
    return value;
  }).finally(() => { pending = null; });
  return pending;
}
