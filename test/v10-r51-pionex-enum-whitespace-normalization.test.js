import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const detail=fs.readFileSync(new URL('../pionex-bot-detail-read.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r51 trims documented bot enum strings before allowlist checks',()=>{
  assert.match(bot,/String\(v\|\|''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(bot,/String\(o\?\.buOrderData\?\.status\|\|o\?\.status\|\|''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(bot,/ACTIVE_TYPES\.has\(String\(order\.buOrderType\|\|''\)\.trim\(\)\)/);
  assert.match(detail,/SUPPORTED\.has\(String\(o\?\.buOrderType\|\|''\)\.trim\(\)\)/);
});

test('r51 keeps the same supported bot types and active status allowlist',()=>{
  assert.match(detail,/PIONEX_SUPPORTED_BOT_TYPES=Object\.freeze\(\['futures_grid','future_hedge_grid'\]\)/);
  for(const status of ['prepare','lock_currency','condition_lock','open_position','init_grid','running','adjust_params','adjust_params_open_position','adjust_params_init_grid','pre_pause','pausing','paused','pre_resume','resuming'])assert.ok(bot.includes("'"+status+"'"),status);
  assert.doesNotMatch(bot,/future_magic_grid/);
});

test('r51 leaves decision thresholds and execution invariants unchanged',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/trim\(\)|enum|whitespace/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r51 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r51');
  assert.match(root,/10\.0-r51-production/);
  assert.match(root,/\.\/v10\/\?build=r51/);
  assert.match(v10,/const BUILD='10\.0-r51'/);
  assert.match(v9,/qs\.set\('build','r51'\)/);
  assert.match(v9html,/p\.set\('build','r51'\)/);
});
