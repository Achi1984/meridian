// Read only the structured audit from the approved seven-day run.
let cached;
let pending;

async function readReport() {
  const token = process.env.MERIDIAN_PILOT_LOG_READ_TOKEN;
  if (!token) throw new Error('Missing pilot log access');
  const runId = process.env.MERIDIAN_PILOT_RUN_ID;
  if (!/^[a-f0-9-]{36}$/i.test(runId || '')) throw new Error('Missing pilot run');
  const rows = await readRun(runId, token);
  // This pilot moved to a new job instance with its original account ledger.
  if (runId === '17c5dbdf-641b-465b-80cc-12b7691af7b7' && rows.length &&
      Date.now() < Date.parse('2026-11-19T15:11:42Z')) {
    const earlier = await readRun('f68a62a4-5446-481a-9aef-df1241b1e959', token).catch(() => []);
    rows.push(...earlier.filter(item => item.pilotAudit.startUtc === rows[0].pilotAudit.startUtc));
  }
  return summarize(rows);
}

async function readRun(runId, token) {
  const endpoint = new URL('https://api.northflank.com/v1/projects/meridian/jobs/meridian-paper-advisor/logs');
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
    if (report?.schema === 'MERIDIAN_ADVISOR_V1' && Number.isFinite(Date.parse(report.last?.at)) &&
        Number.isFinite(Date.parse(report.asOf)) && Number.isInteger(pilotAudit?.completedSlots) &&
        typeof report.last.reason === 'string' && typeof report.last.execution === 'string') rows.push(item);
  }
  return rows;
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
