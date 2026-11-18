// Read only the structured audit from the approved seven-day run.
let cached;
let pending;

async function readReport() {
  const token = process.env.MERIDIAN_PILOT_LOG_READ_TOKEN;
  if (!token) throw new Error('Missing pilot log access');
  const runId = process.env.MERIDIAN_PILOT_RUN_ID;
  if (!/^[a-f0-9-]{36}$/i.test(runId || '')) throw new Error('Missing pilot run');
  const endpoint = new URL('https://api.northflank.com/v1/projects/meridian/jobs/meridian-paper-advisor/logs');
  endpoint.search = new URLSearchParams({
    runId: runId, type: 'runtime', queryType: 'range',
    duration: '86400', lineLimit: '1', direction: 'backward', textIncludes: '"pilotAudit"'
  });
  const response = await fetch(endpoint, {
    headers: {authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Pilot logs unavailable');
  const {data} = await response.json();
  const line = data?.[0]?.log;
  const start = typeof line === 'string' ? line.indexOf('{') : -1;
  if (start < 0 || line.length > 65536) throw new Error('Missing pilot report');
  const {report, pilotAudit} = JSON.parse(line.slice(start));
  if (report?.schema !== 'MERIDIAN_ADVISOR_V1' || !Number.isFinite(Date.parse(report.asOf)) ||
      !Number.isInteger(pilotAudit?.completedSlots)) throw new Error('Invalid pilot report');
  return {report, pilotAudit};
}

export async function latestPilotReport() {
  if (cached && Date.now() < cached.until) return cached.value;
  pending ??= readReport().then(value => {
    cached = {value, until: Date.now() + 30000};
    return value;
  }).finally(() => { pending = null; });
  return pending;
}
