import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const account=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r47 adds fail-soft read-only full-wallet discovery',()=>{
  assert.match(account,/\/api\/v1\/wallet\/balancesFull/);
  assert.match(account,/walletStatus:walletResult\.ok\?'OK':'ERROR'/);
  assert.match(account,/normalizeWalletOverview/);
  assert.match(account,/botCategories/);
  assert.match(account,/entryFields/);
  assert.doesNotMatch(account,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
});

test('r47 gateway exposes only aggregate wallet discovery metadata',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletStatus','pionexWalletBotCategoryCount','pionexWalletBotReportedCount','pionexWalletBotListCount','pionexWalletBotCategories'])assert.ok(block.includes(token),token);
  assert.match(block,/entryFields/);
  assert.doesNotMatch(block,/totalInUsdt|positionId|markPrice|liquidationPrice|unrealizedPnl|buOrderId/);
});

test('r47 UI keeps wallet discovery separate from bot actions',()=>{
  assert.match(v10,/function walletDiscoveryHealth\(\)/);
  assert.match(v10,/function walletDiscoveryLayer\(\)/);
  assert.match(v10,/BOT ACCOUNT API/);
  assert.match(v10,/WALLET(?: \+ DETAIL)? DISCOVERY/);
  assert.match(v10,/keine automatische Bot-Zuordnung|Detaildaten bleiben privat|Keine Safety-Regel wurde gelockert/);
  assert.match(v10,/Bot-Aktionen bleiben fail-closed|erst bei vollständiger Normalisierung als Live-Quelle/);
});

test('r47 does not alter bot decision readiness or execution rules',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/wallet|botCategories|balancesFull/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r47 release identity remains canonical on successors',()=>{
  const build=String(release.terminalBuild||''),rev=build.split('-').at(-1);
  assert.ok(/^10\.0-r\d+$/.test(build));
  assert.ok(Number(build.split('r').at(-1))>=47);
  assert.ok(root.includes(build+'-production'));
  assert.ok(root.includes('./v10/?build='+rev));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
});
