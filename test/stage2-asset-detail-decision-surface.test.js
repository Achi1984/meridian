import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const visualQa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function block(startNeedle,endNeedle,src=js){
  const a=src.indexOf(startNeedle),b=src.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return src.slice(a,b);
}

test('Stage 2 draft stays non-release and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r127');
  assert.equal(release.terminalExecutionImpact,false);
});

test('Stage 2 preserves the r73 Asset Detail separation and read-only contract',()=>{
  const render=block('function renderAssetDetail(force=false){','function depotAssetCard');
  for(const token of [
    'KNOWN HOLDING DETAIL',
    'LIVE BOTS',
    'OPPORTUNITY QUALITY',
    'READ-ONLY DETAIL',
    'Holdings, Bot-Exposure und Markt-Kontext bleiben getrennte Ebenen.',
    'Keine Orders, keine automatische Promotion, keine Doppelzählung.',
    'nicht mit Bot-Exposure addieren',
    'NO FRESH CONTEXT',
    'Depot · Bots · Risk · Forecast · FIB/SK'
  ]) assert.equal(render.split(token).length-1,1,token);
  assert.match(render,/assetDetailHoldingHtml\(symbol\)\+assetDetailBotHtml\(symbol\)\+assetDetailMarketHtml\(symbol\)/);
  assert.match(render,/fibUi\.symbol=symbol/);
  assert.match(render,/data-asset-back data-context-back="asset-detail"/);
  const guard=render.indexOf('asset-detail-accounting-guard'),hero=render.indexOf('asset-detail-hero');
  assert.ok(guard>=0&&hero>guard,'READ-ONLY authority must precede Asset Detail evidence hero');
  const market=render.indexOf('MARKET'),holding=render.indexOf('KNOWN HOLDING DETAIL'),bots=render.indexOf('LIVE BOTS'),quality=render.indexOf('OPPORTUNITY QUALITY');
  assert.ok(market>=0&&holding>market&&bots>holding&&quality>bots,'Asset Detail evidence hero order must remain MARKET -> HOLDING -> LIVE BOTS -> OPPORTUNITY');
  assert.doesNotMatch(render,/known\s*\+\s*exposure|valueUsd\s*\+\s*longUsd|valueUsd\s*\+\s*shortUsd/);
  assert.doesNotMatch(render,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|executeTrade)/i);
});

test('Stage 2 Asset Detail CSS is view-scoped and enforces 9 10 11 and 44px roles',()=>{
  const marker='/* Stage 2 · Asset Detail decision surface draft */';
  const a=css.indexOf(marker);
  assert.ok(a>=0,'Stage 2 CSS marker missing');
  const src=css.slice(a);
  for(const token of [
    '#view-asset-detail .asset-detail-topbar span',
    '#view-asset-detail .asset-detail-hero small',
    '#view-asset-detail .asset-detail-accounting-guard small',
    '#view-asset-detail .asset-detail-topbar>strong',
    '#view-asset-detail .asset-detail-topbar>button',
    '#view-asset-detail .data-state-item>b',
    '#view-asset-detail .asset-detail-source b',
    'font-size:9px',
    'font-size:10px',
    'font-size:11px',
    'min-height:44px'
  ]) assert.ok(src.includes(token),token);
  assert.doesNotMatch(src,/#view-(?:command|depot|bots|market|research|paper)/);
  assert.doesNotMatch(src,/\.(?:fib-|sk-|edge-|holdout-|profit-agent-|lab-)/);
  assert.doesNotMatch(src,/!important|display\s*:\s*none|line-clamp/);
  assert.doesNotMatch(src,/(?:^|\n)\s*(?:html|body|\*)\s*\{/m);
});

test('Stage 2 visual QA gates Asset Detail trust action primary text clipping and first viewport',()=>{
  for(const token of [
    "stage2ActionSelectors=['#view-asset-detail .asset-detail-topbar>button']",
    'smallStage2AuthorityText',
    'smallStage2PrimaryText',
    'stage2TrustClipping',
    'stage2AssetDetailFirstViewportInvariant',
    'stage2AssetDetailGuardAboveNav'
  ]) assert.ok(js.includes(token),token);
  assert.match(js,/br\.bottom<=navTop/);
  assert.match(js,/hr\.top<navTop/);
  assert.match(js,/r\.bottom<=Math\.min\(innerHeight,navTop\)/);
  assert.match(js,/layout\.stage2AssetDetailFirstViewportInvariant/);
  assert.match(js,/layout\.stage2AssetDetailGuardAboveNav/);
  assert.match(js,/!smallStage2AuthorityText\.length/);
  assert.match(js,/!smallStage2PrimaryText\.length/);
  assert.match(js,/!stage2TrustClipping\.length/);
});

test('Stage 2 visual matrix covers Asset Detail fresh stale and error at real phone widths',()=>{
  for(const token of [
    "['asset-detail-top','asset-detail',0]",
    "['asset-detail-stale','asset-detail',0,null,'stale']",
    "['asset-detail-error','asset-detail',0,null,'error']",
    "['mobile-375-asset-detail','asset-detail',0,null,'fresh',375,667]",
    "['mobile-375-asset-detail-stale','asset-detail',0,null,'stale',375,667]",
    "['mobile-375-asset-detail-error','asset-detail',0,null,'error',375,667]",
    "['mobile-320-asset-detail','asset-detail',0,null,'fresh',320,568]",
    "['mobile-320-asset-detail-stale','asset-detail',0,null,'stale',320,568]",
    "['mobile-320-asset-detail-error','asset-detail',0,null,'error',320,568]"
  ]) assert.ok(visualQa.includes(token),token);
});

test('Stage 2 does not promote opportunity scoring or add Asset Detail execution actions',()=>{
  const render=block('function renderAssetDetail(force=false){','function depotAssetCard');
  assert.match(render,/OPPORTUNITY QUALITY/);
  assert.match(render,/ctx\.score\+'\/100'/);
  assert.equal((render.match(/<button/g)||[]).length,1);
  assert.doesNotMatch(render,/(?:recommend|winner|best|approved|buy|sell)/i);
});


test('Stage 2 rebase preserves all R126 Paper fail-closed QA guards',()=>{
  for(const token of [
    'r126PaperFirstViewportInvariant',
    'r126RenderedModelOrderInvariant',
    'r126RenderedR42Invariant',
    'smallR126AuthorityText',
    'smallR126PrimaryText',
    'r126TrustClipping'
  ]) assert.ok(js.includes(token),token);
  assert.match(js,/layout\.r126RenderedModelOrderInvariant/);
  assert.match(js,/layout\.r126RenderedR42Invariant/);
});
