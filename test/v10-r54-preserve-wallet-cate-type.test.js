import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const account=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
const detail=fs.readFileSync(new URL('../pionex-bot-detail-read.js',import.meta.url),'utf8');
const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r54 preserves Wallet cateType into the live-risk summary',()=>{
  assert.match(account,/cateType:wallet\?\.cateType\|\|detail\?\.cateType\|\|detail\?\.buOrderData\?\.cateType\|\|null/);
  assert.match(detail,/cateType:envelope\.cateType\|\|summary\.cateType\|\|detailData\?\.cateType\|\|null/);
});

test('r54 does not broaden inverse detection or normal bot allowlists',()=>{
  assert.match(bot,/String\(v\|\|''\)\.trim\(\)\.toLowerCase\(\)==='inverse'/);
  assert.match(bot,/inverseCoinM\(order\)&&baseClass==='stable_quote'&&quoteClass==='asset'/);
  assert.match(bot,/PIONEX_SUPPORTED_BOT_TYPES/);
});

test('r54 leaves action and execution logic unchanged',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/cateType:wallet|quote_inverse|inverseCoinM/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r54 release identity remains canonical on successors',()=>{
  const build=String(release.terminalBuild||''),rev=build.split('-').at(-1);
  assert.ok(/^10\.0-r\d+$/.test(build));
  assert.ok(Number(build.split('r').at(-1))>=54);
  assert.ok(root.includes(build+'-production'));
  assert.ok(root.includes('./v10/?build='+rev));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
});
