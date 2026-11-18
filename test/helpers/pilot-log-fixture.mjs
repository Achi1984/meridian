import assert from 'node:assert/strict';

export const pilotEndpoint = 'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/paper-advisor';

export async function servePilotFixture(call, event) {
  const {method, headers, url} = event.request;
  if (url !== pilotEndpoint) return false;
  const preflight = method === 'OPTIONS';
  if (!preflight) {
    assert.equal(method, 'GET');
    const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
    assert.match(authorization?.[1] || '', /^Bearer .+/);
  }
  await call('Fetch.fulfillRequest', {
    requestId: event.requestId,
    responseCode: preflight ? 204 : 503,
    responseHeaders: [
      {name:'Access-Control-Allow-Origin', value:'*'},
      {name:'Access-Control-Allow-Methods', value:'GET'},
      {name:'Access-Control-Allow-Headers', value:'accept,authorization'},
      {name:'Cache-Control', value:'no-store'}
    ]
  });
  return true;
}
