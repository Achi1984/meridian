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

test('r43 bot list requests only supported running futures types',()=>{
  assert.match(bot,/status:'running'/);
  assert.match(bot,/buOrderTypes:PIONEX_SUPPORTED_BOT_TYPES/);
  assert.match(bot,/PIONEX_SUPPORTED_BOT_TYPES/);
  assert.match(detail,/future_hedge_grid/);
  assert.match(detail,/futures_grid/);
});

test('r43 guard diagnostics are aggregate-only and preserve fail-closed behavior',()=>{
  assert.match(bot,/summarizePionexBotList/);
  assert.match(bot,/typeCounts/);
  assert.match(bot,/statusCounts/);
  assert.match(bot,/EMPTY_GUARD/);
  assert.match(bot,/zero_supported_running_bots/);
  assert.doesNotMatch(bot,/diagnostics.*buOrderId/);
  assert.match(v10,/Futures-Filter lieferte/);
  assert.match(v9,/Pionex Futures-Filter/);
});

test('r43 Pionex runtime stays GET-only',()=>{
  assert.doesNotMatch(bot,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.doesNotMatch(bot,/futuresGrid\/create|futuresGrid\/cancel|futuresGrid\/reduce|futuresGrid\/adjustParams/);
});

test('r43 preserves execution-neutral invariants',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r43 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r43');
  assert.match(root,/10\.0-r43-production/);
  assert.match(root,/\.\/v10\/\?build=r43/);
  assert.match(v10,/const BUILD='10\.0-r43'/);
  assert.match(v9,/qs\.set\('build','r43'\)/);
  assert.match(v9html,/p\.set\('build','r43'\)/);
});
