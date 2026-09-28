import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r53 resolves inverse Coin-M asset from quote only under explicit inverse semantics',()=>{
  assert.match(bot,/function inverseCoinM\(order\)/);
  assert.match(bot,/cateType/);
  assert.match(bot,/gridType/);
  assert.match(bot,/source:'quote_inverse'/);
  assert.match(bot,/inverseCoinM\(order\)&&baseClass==='stable_quote'&&quoteClass==='asset'/);
});

test('r53 keeps normal symbol resolution on base',()=>{
  assert.match(bot,/if\(baseClass==='asset'\)return\{symbol:baseSymbol\(order\?\.base\),source:'base'/);
  assert.doesNotMatch(bot,/quoteClass==='asset'\)return\{symbol:baseSymbol\(order\?\.quote\),source:'quote'/);
});

test('r53 leaves action and execution logic unchanged',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/quote_inverse|inverseCoinM|resolvedSymbol/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r53 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r53');
  assert.match(root,/10\.0-r53-production/);
  assert.match(root,/\.\/v10\/\?build=r53/);
  assert.match(v10,/const BUILD='10\.0-r53'/);
  assert.match(v9,/qs\.set\('build','r53'\)/);
  assert.match(v9html,/p\.set\('build','r53'\)/);
});
