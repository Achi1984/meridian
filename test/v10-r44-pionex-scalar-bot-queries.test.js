import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r44 avoids repeated-array signing by issuing one scalar GET per supported bot type',()=>{
  assert.match(bot,/fetchRunningBotOrdersForType/);
  assert.match(bot,/buOrderTypes:type/);
  assert.match(bot,/for\(let i=0;i<PIONEX_SUPPORTED_BOT_TYPES\.length;i\+\+\)/);
  assert.doesNotMatch(bot,/buOrderTypes:PIONEX_SUPPORTED_BOT_TYPES/);
});

test('r44 remains GET-only and fail-closed',()=>{
  assert.doesNotMatch(bot,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.match(bot,/EMPTY_GUARD/);
  assert.match(bot,/zero_supported_running_bots/);
});

test('r44 preserves execution-neutral invariants',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r44 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r44');
  assert.match(root,/10\.0-r44-production/);
  assert.match(root,/\.\/v10\/\?build=r44/);
  assert.match(v10,/const BUILD='10\.0-r44'/);
  assert.match(v9,/qs\.set\('build','r44'\)/);
  assert.match(v9html,/p\.set\('build','r44'\)/);
});
