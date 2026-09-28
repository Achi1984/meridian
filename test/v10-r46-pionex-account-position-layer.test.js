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

test('r46 exposes normalized read-only futures account positions',()=>{
  assert.match(account,/\/uapi\/v1\/account\/positions/);
  assert.match(account,/asset:baseAsset\(x\?\.symbol\)/);
  assert.match(account,/liquidationPrice:num\(x\?\.liquidationPrice\)/);
  assert.match(account,/unrealizedPnl:num\(x\?\.unrealizedPnL\)/);
  assert.doesNotMatch(account,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
});

test('r46 gateway health exposes only aggregate Pionex position status',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  assert.match(block,/pionexAccountStatus/);
  assert.match(block,/pionexFuturesPositionCount/);
  assert.match(block,/pionexBotStatus/);
  assert.match(block,/pionexBotListRows/);
  assert.doesNotMatch(block,/markPrice|liquidationPrice|unrealizedPnl|positionId/);
});

test('r46 renders account positions separately from bot decision readiness',()=>{
  assert.match(v10,/function accountPositionHealth\(\)/);
  assert.match(v10,/function accountPositionLayer\(compact=false\)/);
  assert.match(v10,/PIONEX ACCOUNT POSITIONS/);
  assert.match(v10,/nicht einem einzelnen Bot zugeordnet/);
  assert.match(v10,/keine Grid-\/TP-\/Profit-Lock-Aktion daraus/);
  assert.match(v10,/POSITION API/);
  assert.match(v9,/pionexAccountSync/);
  assert.match(v9,/pionexAccount/);
});

test('r46 account positions expand the market-data universe without becoming bot matches',()=>{
  assert.match(v9,/state\.pionexAccount\?\.futuresPositions/);
  assert.match(v10,/s\?\.pionexAccount\?\.futuresPositions/);
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/pionexAccount|futuresPositions/);
});

test('r46 preserves execution-neutral invariants',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r46 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r46');
  assert.match(root,/10\.0-r46-production/);
  assert.match(root,/\.\/v10\/\?build=r46/);
  assert.match(v10,/const BUILD='10\.0-r46'/);
  assert.match(v9,/qs\.set\('build','r46'\)/);
  assert.match(v9html,/p\.set\('build','r46'\)/);
});
