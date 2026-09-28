import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const start=fs.readFileSync(new URL('../scripts/start-gateway.mjs',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const account=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../pionex-read-client.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r42 starts a separate Pionex read-only account sync',()=>{
  assert.match(start,/startPionexAccountReadSync/);
  assert.match(start,/pionex-account-read-sync\.js/);
  assert.match(account,/GET-only|read-only/i);
});

test('r42 reads only documented account and futures GET endpoints',()=>{
  for(const path of ['/api/v1/account/balances','/uapi/v1/account/balances','/uapi/v1/account/positions'])assert.ok(account.includes(path),path);
  assert.doesNotMatch(client,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.doesNotMatch(account,/\/trade\/order|\/assets\/transfer|adjustParams|\/reduce|\/cancel/);
});

test('r42 gateway exposes normal read and bot-read configuration separately',()=>{
  assert.match(gateway,/PIONEX_READ_CONFIGURED/);
  assert.match(gateway,/pionexReadConfigured:PIONEX_READ_CONFIGURED/);
  assert.match(gateway,/pionexBotReadConfigured:PIONEX_BOT_READ_CONFIGURED/);
});

test('r42 Data Truth separates account API from bot API',()=>{
  assert.match(v9,/pionexAccountSync/);
  assert.match(v9,/pionexAccount/);
  assert.match(v9,/ACCOUNT API/);
  assert.match(v9,/FUT POS/);
  assert.match(v9,/BOT API/);
});

test('r42 preserves execution-neutral invariants',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r42 release identity is canonical across active and legacy entrypoints',()=>{
  assert.equal(release.terminalBuild,'10.0-r42');
  assert.match(root,/10\.0-r42-production/);
  assert.match(root,/\.\/v10\/\?build=r42/);
  assert.match(v10,/const BUILD='10\.0-r42'/);
  assert.match(v9,/qs\.set\('build','r42'\)/);
  assert.match(v9html,/p\.set\('build','r42'\)/);
});
