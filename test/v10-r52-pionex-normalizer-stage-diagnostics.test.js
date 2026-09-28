import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const account=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r52 shares exact production normalizer stage inspection',()=>{
  assert.match(bot,/export function inspectPionexBotOrder/);
  assert.match(bot,/typePass/);
  assert.match(bot,/statusPass/);
  assert.match(bot,/symbolPass/);
  assert.match(bot,/sidePass/);
  assert.match(bot,/const check=inspectPionexBotOrder\(order\)/);
  assert.match(bot,/if\(!check\.typePass\|\|!check\.statusPass\|\|!check\.symbolPass\|\|!check\.sidePass\)return null/);
});

test('r52 aggregates privacy-safe normalizer stage counts',()=>{
  for(const token of ['typePassCount','statusPassCount','symbolPassCount','sidePassCount','allStagePassCount','baseClassCounts','quoteClassCounts'])assert.ok(account.includes(token),token);
  assert.doesNotMatch(account,/rawBaseValue|rawQuoteValue|symbolValues/);
});

test('r52 gateway exposes aggregate stage diagnostics only',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletRiskTypePassCount','pionexWalletRiskStatusPassCount','pionexWalletRiskSymbolPassCount','pionexWalletRiskSidePassCount','pionexWalletRiskAllStagePassCount','pionexWalletRiskBaseClassCounts','pionexWalletRiskQuoteClassCounts'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/buOrderId|investmentAmount|investmentToken|profit|markPrice|liquidationPrice|unrealizedPnl/);
});

test('r52 UI exposes exact stages without relaxing guards',()=>{
  assert.match(v10,/NORMALIZER STAGES/);
  assert.match(v10,/TYPE /);
  assert.match(v10,/STATUS /);
  assert.match(v10,/SYMBOL /);
  assert.match(v10,/SIDE /);
  assert.match(v10,/ASSET CLASS/);
  assert.match(v10,/Keine Safety-Regel wurde gelockert/);
});

test('r52 leaves action and execution logic unchanged',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/typePassCount|symbolPassCount|baseClassCounts/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r52 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r52');
  assert.match(root,/10\.0-r52-production/);
  assert.match(root,/\.\/v10\/\?build=r52/);
  assert.match(v10,/const BUILD='10\.0-r52'/);
  assert.match(v9,/qs\.set\('build','r52'\)/);
  assert.match(v9html,/p\.set\('build','r52'\)/);
});
