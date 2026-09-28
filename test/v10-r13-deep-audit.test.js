import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const pionex=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const releaseCheck=fs.readFileSync(new URL('../scripts/release-check.mjs',import.meta.url),'utf8');
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/backend-safety.yml',import.meta.url),'utf8');

test('r13 fixes SHORT break-even direction and keeps bot risk on fresh data',()=>{
  assert.match(v9,/return b\.side==='SHORT'\?\(be-p\)\/be\*100:\(p-be\)\/be\*100/);
  assert.match(v9,/confirmed=botFeedFresh\(\)\?state\.bots\.filter\(liveMatched\):\[\]/);
  assert.match(v9,/mom=marketIntelFresh\(rawMom\)\?rawMom:null/);
});

test('r13 refuses coin-denominated investment as USD exposure or inferred USD pnl',()=>{
  assert.match(v9,/function liveInvestUsdAvailable\(b\)/);
  assert.match(v9,/botNotional=b=>liveInvestUsdAvailable\(b\)/);
  assert.match(v9,/const raw=num\(b&&b\.pnl\),investUsd=num\(b&&b\.investUsd\)/);
  assert.doesNotMatch(v9,/PCT_X_INVEST/);
  assert.doesNotMatch(v9,/botNotional=b=>liveInvestAvailable\(b\)/);
  assert.match(v10,/Exposure-Einheit unvollständig/);
});

test('r13 aligns technical price sources to liquid perpetual futures and tight cross-check',()=>{
  assert.match(v9,/okx\.com\/api\/v5\/market\/candles/);
  assert.match(v9,/fapi\.binance\.com\/fapi\/v1\/klines/);
  assert.match(v9,/fapi\.binance\.com\/fapi\/v1\/ticker\/price/);
  assert.match(v9,/spread<=\.5/);
  assert.match(v10,/OKX SWAP \+ BINANCE USD-M/);
});

test('r13 separates market freshness, bot freshness and Asset Watch reference',()=>{
  assert.match(v9,/marketPriceSyncedAt:null/);
  assert.match(v9,/updatedAt:Date\.now\(\)/);
  assert.match(v10,/function marketHealth\(\)/);
  assert.match(v10,/● MKT /);
  assert.match(v10,/● BOT /);
  assert.match(v10,/ASSET WATCH/);
  assert.match(html,/id="market-status"/);
  assert.match(html,/id="data-status"/);
});

test('r13 suppresses stale bot action cards but keeps the 34-bot screenshot roster visible',()=>{
  assert.match(v10,/if\(!fresh&&!compact\)return ''/);
  assert.match(v10,/KEINE FRISCHEN LIVE-AKTIONSKARTEN/);
  assert.match(v10,/snapshotDetails\((?:snapshotOpen\?\?)?!g\.fresh\)/);
  assert.match(v10,/ASSET WATCH SNAPSHOT/);
});

test('r13 distinguishes live bot links from reference bot links in scanner',()=>{
  assert.match(v10,/LIVE BOT · FRESH/);
  assert.match(v10,/REF BOT · ASSET WATCH/);
  assert.match(v10,/Bot-Referenz beeinflusst Ranking nicht/);
  assert.match(v10,/if\(!intelFresh\(i\)\)return\{label:'DATA STALE'/);
});

test('r13 normalizes stop loss read-only and checks protection before profit logic',()=>{
  assert.match(pionex,/function slFor\(order,d\)/);
  assert.match(pionex,/stopLoss:slFor\(order,d\)/);
  assert.match(v10,/function stopLossIssue\(b\)/);
  const pair=v10.slice(v10.indexOf('function pairStatus'),v10.indexOf('function exposure',v10.indexOf('function pairStatus')));
  assert.ok(pair.indexOf('PROTECTION_RISK')<pair.indexOf('PROFIT_LOCK'));
  assert.doesNotMatch(v10,/submitOrder|placeOrder|createOrder/);
});

test('r13 Fib manual mode validates anchors and prefers freshly fetched 4h close',()=>{
  assert.match(v10,/Swing High muss über Swing Low liegen/);
  assert.match(v10,/let current=rows\?\.length\?Number\(rows\.at\(-1\)\?\.close\):null/);
  assert.match(v10,/aria-busy/);
});

test('r13 LAB makes discovery versus holdout hierarchy explicit',()=>{
  assert.match(v10,/TSMOM DISCOVERY/);
  assert.match(v10,/TSMOM HOLDOUT/);
  assert.match(v10,/Discovery PASS ≠ bestätigtes Edge/);
  assert.match(v10,/nie Auto-Promotion/);
});

test('r13 publishes one canonical terminal build and runtime-smokes actual v10 assets',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(html.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.match(releaseCheck,/terminalBuild/);
  assert.match(releaseCheck,/v10 runtime BUILD must match terminalBuild/);
  assert.match(smoke,/v10\/index\.html\?smoke=/);
  assert.match(smoke,/v10\/v10\.js\?smoke=/);
  assert.match(smoke,/Gateway terminal metadata stale/);
});

test('r13 expands release syntax coverage and mobile accessibility guardrails',()=>{
  for(const file of ['v9/v9.js','v10/v10.js','v10/fib-core.js','research/documented-edge-v1.js','research/tsmom-holdout-v1.js'])assert.ok(workflow.includes('node --check '+file),file);
  assert.match(v10,/aria-current/);
  assert.match(v10,/aria-live/);
  assert.match(css,/#nav button\{min-height:44px/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('r13 legacy bridge cannot crash on unknown USD exposure and COMMAND is idempotent',()=>{
  assert.match(v9,/shareText=rv\.share==null\?'Exposure —':rv\.share\.toFixed\(1\)/);
  assert.match(v9,/capitalComplete=fresh\.length>0&&fresh\.every\(liveInvestUsdAvailable\)/);
  assert.match(v10,/legacyCommandPresent=legacyCommandSelectors\.some/);
  assert.match(v10,/if\(!force&&!legacyCommandPresent&&\$\('\.command-source-strip',view\)&&\$\('\.v10-critical-wrap',view\)&&\$\('\.v10-data-guard',view\)\)return/);
});

test('r13 stale public prices cannot drive bot risk fallbacks',()=>{
  assert.match(v9,/checkFresh=check\?\.updatedAt&&Date\.now\(\)-Number\(check\.updatedAt\)<=3\*60\*1000/);
  assert.match(v9,/feed=marketIntelFresh\(intel\)\?num\(intel\.price\):null/);
  assert.match(v9,/return b&&b\._livePrice&&direct>0\?direct:null/);
});

test('r13 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
