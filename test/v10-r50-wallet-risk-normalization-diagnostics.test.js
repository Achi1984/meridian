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

test('r50 records aggregate wallet-risk normalization diagnostics',()=>{
  for(const token of ['rejectReasonCounts','statusCounts','trendCounts','missingBaseCount','detailEnvelopeFields','detailBotDataFields'])assert.ok(account.includes(token),token);
  assert.match(account,/normalizer_rejected/);
  assert.match(account,/inactive_status/);
  assert.match(account,/invalid_trend/);
  assert.match(account,/missing_base/);
});

test('r50 exposes aggregate diagnostics only on gateway health',()=>{
  const start=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/gateway-health")');
  const end=gateway.indexOf('if(req.method==="GET"&&u.pathname==="/api/private/write-check")');
  const block=gateway.slice(start,end);
  for(const token of ['pionexWalletRiskRejectReasonCounts','pionexWalletRiskStatusCounts','pionexWalletRiskTrendCounts','pionexWalletRiskMissingBaseCount','pionexWalletRiskDetailEnvelopeFields','pionexWalletRiskDetailBotDataFields'])assert.ok(block.includes(token),token);
  assert.doesNotMatch(block,/buOrderId|investmentAmount|investmentToken|profit|markPrice|liquidationPrice|unrealizedPnl/);
});

test('r50 UI shows normalization coverage without relaxing the guard',()=>{
  for(const token of ['RISK NORMALIZED','RISK STATUS','REJECT REASONS','DETAIL FIELDS'])assert.ok(v10.includes(token),token);
  assert.match(v10,/Keine Safety-Regel wurde gelockert/);
  assert.match(v10,/erst bei vollständiger Normalisierung als Live-Quelle/);
});

test('r50 leaves source selection and trading decisions unchanged',()=>{
  assert.match(v9,/wallet\?\.detailsComplete===true/);
  assert.match(v9,/freshRisk/);
  const readiness=v9.slice(v9.indexOf('function safetyReadyBot'),v9.indexOf('function exposureIntegrity'));
  assert.doesNotMatch(readiness,/rejectReasonCounts|statusCounts|trendCounts|detailEnvelopeFields/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ['pnl>=20','pnl>=12','pnl>=10','pnl>=8','pnl>=3'])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r50 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r50');
  assert.match(root,/10\.0-r50-production/);
  assert.match(root,/\.\/v10\/\?build=r50/);
  assert.match(v10,/const BUILD='10\.0-r50'/);
  assert.match(v9,/qs\.set\('build','r50'\)/);
  assert.match(v9html,/p\.set\('build','r50'\)/);
});
