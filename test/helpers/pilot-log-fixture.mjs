import assert from 'node:assert/strict';

export const pilotEndpoint = 'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/paper-advisor';

export const pilotStatusEndpoint = 'https://api.github.com/repos/Achi1984/meridian/actions/workflows/solana-meme-paper-bot.yml/runs?branch=main&per_page=5';

export async function servePilotFixture(call, event, payload) {
  const {method, headers, url} = event.request;
  const runStatus = url === pilotStatusEndpoint;
  if (!runStatus && url !== pilotEndpoint) return false;
  if (runStatus) payload = {workflow_runs:[{id:55,run_number:5,status:'in_progress'}]};
  const preflight = method === 'OPTIONS';
  if (!preflight) {
    assert.equal(method, 'GET');
    const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
    if (runStatus) assert.equal(authorization,undefined);
    else assert.match(authorization?.[1] || '', /^Bearer .+/);
  }
  await call('Fetch.fulfillRequest', {
    requestId: event.requestId,
    responseCode: preflight ? 204 : payload ? 200 : 503,
    ...(payload && !preflight ? {body:Buffer.from(JSON.stringify(payload)).toString('base64')} : {}),
    responseHeaders: [
      {name:'Access-Control-Allow-Origin', value:'*'},
      {name:'Access-Control-Allow-Methods', value:'GET'},
      {name:'Access-Control-Allow-Headers', value:'accept,authorization'},
      {name:'Cache-Control', value:'no-store'}
    ]
  });
  return true;
}
