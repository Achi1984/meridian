import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client=fs.readFileSync(new URL('../okx-read-client.js',import.meta.url),'utf8');
const sync=fs.readFileSync(new URL('../okx-account-read-sync.js',import.meta.url),'utf8');
const start=fs.readFileSync(new URL('../scripts/start-gateway.mjs',import.meta.url),'utf8');

test('OKX authority integration is statically GET-only',()=>{
  assert.match(client,/OKX_ACCOUNT_BALANCE_PATH='\/api\/v5\/account\/balance'/);
  assert.match(client,/method:'GET'/);
  assert.match(client,/path!==OKX_ACCOUNT_BALANCE_PATH/);
  assert.match(sync,/endpoints:\['GET '\+OKX_ACCOUNT_BALANCE_PATH\]/);
  assert.doesNotMatch(client+sync,/\/api\/v5\/(?:trade|asset\/transfer|account\/set|users\/subaccount\/transfer)/i);
  assert.doesNotMatch(client+sync,/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('OKX authority stores no API credentials in dashboard state',()=>{
  const stateWrites=[...sync.matchAll(/base\.okxAccountSync=\{([\s\S]*?)\n\s*\};/g)].map(x=>x[1]).join('\n');
  assert.ok(stateWrites.length>0);
  assert.doesNotMatch(stateWrites,/apiKey|apiSecret|passphrase/i);
  assert.doesNotMatch(sync,/base\.(?:okxAccount|portfolio)[^\n]*(?:apiKey|apiSecret|passphrase)/i);
});

test('runtime startup adds only account read sync and no OKX trading worker',()=>{
  assert.match(start,/startOkxAccountReadSync\(\)/);
  assert.doesNotMatch(start,/startOkx.*(?:Trade|Order|Transfer)/i);
});

test('automatic OKX authority is fail-closed and never erases prior value on read failure',()=>{
  const mergeStart=sync.indexOf('export function mergeOkxAccountState');
  const runStart=sync.indexOf('export async function runOkxAccountReadOnce');
  const block=sync.slice(mergeStart,runStart);
  assert.match(block,/if\(snapshot\)\{/);
  assert.match(block,/source:'OKX_ACCOUNT_READ_API'/);
  assert.match(sync,/status:'ERROR'/);
  assert.doesNotMatch(sync,/status:'ERROR'[\s\S]{0,300}manualVenueBalances=\[\]/);
});
