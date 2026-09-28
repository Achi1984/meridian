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

test('r49 builds wallet-derived live bot risk only from validated futures_grid details',()=>{
  assert.match(account,/function buildWalletBotRisk/);
  assert.match(account,/PIONEX_WALLET_BOT_DETAIL/);
  assert.match(account,/detailsComplete/);
  assert.match(account,/supportedRows:expected/);
  assert.match(account,/rejectedCount:rejected\.length/);
});

test('r49 selects wallet detail only when fresh and complete',()=>{
  assert.match(v9,/function selectPionexRisk/);
  assert.match(v9,/WALLET_DETAIL_OK/);
  assert.match(v9,/freshRisk/);
  assert.match(v9,/15\*60\*1000/);
  assert.match(v9,/wallet\?\.detailsComplete===true/);
});

test('r49 keeps classic Bot API status separate from active wallet source',()=>{
  assert.match(v10,/botApiStatus/);
  assert.match(v10,/walletFeed/);
  assert.match(v10,/BOT SOURCE/);
  assert.match(v10,/WALLET DETAIL/);
  assert.match(v10,/Bot API /);
});

test('r49 public health remains aggregate-only',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletRiskRows','pionexWalletRiskSupportedRows','pionexWalletRiskDetailsComplete','pionexWalletRiskRejectedCount'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/buOrderId|investmentAmount|investmentToken|profit|markPrice|liquidationPrice|unrealizedPnl/);
});

test('r49 does not alter decision thresholds or live execution invariants',()=>{
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/walletBotRisk|WALLET_DETAIL_OK/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r49 release identity remains canonical on successors',()=>{
  const build=String(release.terminalBuild||''),rev=build.split('-').at(-1);
  assert.ok(/^10\.0-r\d+$/.test(build));
  assert.ok(Number(build.split('r').at(-1))>=49);
  assert.ok(root.includes(build+'-production'));
  assert.ok(root.includes('./v10/?build='+rev));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
});
