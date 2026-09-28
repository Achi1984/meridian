import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const account=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../pionex-read-client.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r48 classifies private wallet bot entries and probes details read-only',()=>{
  assert.match(account,/normalizeWalletBotEntries/);
  assert.match(account,/probeWalletBotDetails/);
  assert.match(account,/PIONEX_FUTURES_GRID_DETAIL_PATH/);
  assert.match(account,/TRADING_BOT/);
  assert.match(account,/FUTURES_LITE/);
  assert.match(account,/buOrderId/);
  assert.doesNotMatch(client,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.doesNotMatch(account,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
});

test('r48 public health exposes aggregates but no bot IDs or values',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletBotEntryCount','pionexWalletBuOrderTypeCounts','pionexWalletCateTypeCounts','pionexWalletBotDetailSuccessCount','pionexWalletBotDetailFailureCount','pionexWalletSuccessCateTypeCounts'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/buOrderId|investmentAmount|investmentToken|profit|totalInUsdt|markPrice|liquidationPrice|unrealizedPnl/);
});

test('r48 UI exposes only aggregate probe coverage and keeps actions fail-closed',()=>{
  assert.match(v10,/DETAIL PROBE/);
  assert.match(v10,/BUORDERTYPE/);
  assert.match(v10,/CATETYPE/);
  assert.match(v10,/FUTURE_GRID_COIN_MARGINED = Coin-M Futures Grid/);
  assert.match(v10,/Detaildaten bleiben privat/);
  assert.match(v10,/Bot-Aktionen bleiben fail-closed/);
});

test('r48 does not alter bot decision readiness or execution rules',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/walletBotProbe|walletBotEntries|balancesFull/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r48 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r48');
  assert.match(root,/10\.0-r48-production/);
  assert.match(root,/\.\/v10\/\?build=r48/);
  assert.match(v10,/const BUILD='10\.0-r48'/);
  assert.match(v9,/qs\.set\('build','r48'\)/);
  assert.match(v9html,/p\.set\('build','r48'\)/);
});
