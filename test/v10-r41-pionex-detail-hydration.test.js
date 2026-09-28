import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../pionex-bot-detail-read.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r41 hydrates supported Pionex bot summaries from the detail read endpoint',()=>{
  assert.match(sync,/hydratePionexBotSummaries/);
  assert.match(sync,/fetchFuturesGridOrderDetail/);
  assert.match(sync,/PIONEX_FUTURES_GRID_DETAIL_PATH/);
  assert.match(helper,/\/api\/v1\/bot\/orders\/futuresGrid\/order/);
  assert.match(sync,/syncMode:'BOT_READING_DETAIL_HYDRATED'/);
});

test('r41 publishes independent list, supported and detail coverage',()=>{
  assert.match(sync,/apiRows:hydrated\.listRows/);
  assert.match(sync,/supportedRows:hydrated\.supportedRows/);
  assert.match(sync,/detailRows:hydrated\.detailRows/);
  assert.match(sync,/detailsComplete:hydrated\.detailsComplete/);
  assert.match(v9,/botSupportedRows/);
  assert.match(v9,/botDetailRows/);
  assert.match(v9,/botDetailsComplete/);
  assert.match(v9,/BOT DETAIL/);
});

test('r41 Pionex integration remains GET-only and execution-neutral',()=>{
  assert.doesNotMatch(sync,/method:'POST'/);
  assert.doesNotMatch(sync,/futuresGrid\/create/);
  assert.doesNotMatch(sync,/futuresGrid\/adjust/);
  assert.doesNotMatch(sync,/futuresGrid\/reduce/);
  assert.doesNotMatch(sync,/futuresGrid\/cancel/);
  assert.equal(release.terminalExecutionImpact,false);
});

test('r41 preserves trading and Paper decision invariants',()=>{
  assert.match(v9,/hedgePct<15/);
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(v9.includes(token),token);
  assert.match(v9,/if\(!g\.coverageComplete\)/);
});

test('r41 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r41');
  assert.match(root,/10\.0-r41-production/);
  assert.match(root,/\.\/v10\/\?build=r41/);
  assert.match(v10,/const BUILD='10\.0-r41'/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
