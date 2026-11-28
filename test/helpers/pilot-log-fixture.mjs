import assert from 'node:assert/strict';

export const pilotEndpoint = 'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/paper-advisor';

export const pilotStatusEndpoint = 'https://api.github.com/repos/Achi1984/meridian/actions/workflows/solana-meme-paper-bot.yml/runs?branch=main&per_page=5';

export const top100Endpoint='https://api.github.com/repos/Achi1984/meridian/contents/top100-45678525838.json?ref=paper-dashboard-data';
export const followupEndpoints = [
  'https://api.github.com/repos/Achi1984/meridian/actions/runs?branch=paper%2Ftop100-confirmation-20261127&event=push&per_page=20',
  'https://api.github.com/repos/Achi1984/meridian/contents/top100-followup-46069348362.json?ref=paper-dashboard-data'
];
export const strategyStatusEndpoints = ['solana-scanner-live', 'okx-filter-demo'].map(name =>
  'https://api.github.com/repos/Achi1984/meridian/contents/' + name + '.json?ref=paper-dashboard-data');
export const swingCheckpointEndpoint = 'https://api.github.com/repos/Achi1984/meridian/contents/studies/swing48/45624335706/state.json?ref=paper%2Fsecond-wave-48h-data';

export const pionexReadEndpoints=['dashboard','asset-watch','pionex-history?range=1w'].map(path=>
  'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/'+path);

export async function servePilotFixture(call, event, payload) {
  const {method, headers, url} = event.request;
  const runStatus = url === pilotStatusEndpoint;
  const checkpoint = url === swingCheckpointEndpoint;
  const pionex=pionexReadEndpoints.includes(url);
  const followup = followupEndpoints.includes(url);
  const strategyStatus = strategyStatusEndpoints.includes(url);
  if (!strategyStatus && !followup && url!==top100Endpoint && !runStatus && !checkpoint && !pionex && url !== pilotEndpoint) return false;
  if (followup) payload = url === followupEndpoints[0] ? {workflow_runs:[]} : null;
  if (strategyStatus) payload = url === strategyStatusEndpoints[0]
    ? {schema:1,asOf:Math.floor(Date.now()/1000),qualified:0,warnings:[],candidates:[],sampled:0}
    : {instrument:'BTC-USD_UM_XPERP-310328',asOf:new Date().toISOString(),sessions:{test:{state:'tracking',signal:'LONG',demoFilled:false}},
       observation:{flatStartSignal:'FLAT',decisionTs:Date.now()-1000}};
  if(pionex)payload={};
  if (checkpoint) payload = {start:1000,lastTick:1600,candidates:{pool:{}},positions:{},cash:{fixed:1e9,runner:1e9}};
  if (runStatus) payload = {workflow_runs:[{id:55,run_number:5,status:'in_progress'}]};
  const preflight = method === 'OPTIONS';
  if (!preflight) {
    assert.equal(method, 'GET');
    const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
    if (strategyStatus || followup || url===top100Endpoint || runStatus || checkpoint) assert.equal(authorization,undefined);
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
