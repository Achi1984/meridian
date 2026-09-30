import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r78 context-navigation contract remains active on successor terminal builds',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=78);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/CONTEXT-NAV/);
  assert.match(String(release.dashboardShell||''),/UI-REGRESSION-GATE/);
  assert.ok(root.includes(release.terminalBuild+'-production'));
  assert.ok(html.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  const rev=release.terminalBuild.split('-').at(-1);
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r78 keeps exactly five primary tabs and existing secondary surfaces',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  for(const id of ['view-asset-detail','view-paper','view-more'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.doesNotMatch(html,/data-v="asset-detail"|data-v="paper"|data-v="more"/);
});

test('r78 stores only selected asset and Bot filter in browser session context',()=>{
  const ctx=block("const UI_CONTEXT_KEY='meridian.v10.context.v1'","const MARKET_FRESH_MS");
  assert.match(ctx,/sessionStorage\.getItem\(UI_CONTEXT_KEY\)/);
  assert.match(ctx,/sessionStorage\.setItem\(UI_CONTEXT_KEY/);
  assert.doesNotMatch(ctx,/localStorage/);
  assert.match(ctx,/JSON\.stringify\(\{fibSymbol:String\(fibUi\.symbol\|\|'BTC'\)\.toUpperCase\(\),botFilter:/);
  assert.doesNotMatch(ctx,/token|authorization|portfolio|paperCockpitUi\.data|positions|pnl/i);
});

test('r78 rejects unknown persisted assets and Bot filters',()=>{
  const ctx=block("const UI_CONTEXT_KEY='meridian.v10.context.v1'","const MARKET_FRESH_MS");
  assert.match(ctx,/const UI_CONTEXT_ASSETS=\[/);
  assert.match(ctx,/const BOT_FILTERS=\['ALL','RISK','PROFIT','HEDGE'\]/);
  assert.match(ctx,/UI_CONTEXT_ASSETS\.includes\(fibSymbol\)\?fibSymbol:'BTC'/);
  assert.match(ctx,/BOT_FILTERS\.includes\(botFilter\)\?botFilter:'ALL'/);
});

test('r78 contextual secondary navigation captures origin but Back does not create a new context',()=>{
  const signature=v10.includes("function showSecondaryView(v,navKey='research',context=null,scrollY=0){")
    ?"function showSecondaryView(v,navKey='research',context=null,scrollY=0){"
    :"function showSecondaryView(v,navKey='research',context=null){";
  const nav=block(signature,"let feedRefreshBusy=false");
  assert.match(nav,/const from=activeViewKey\(\)/);
  assert.match(nav,/\['asset-detail','paper','more','market'\]\.includes\(v\)/);
  assert.match(nav,/viewContextUi\[v\]=\{returnView,navKey:returnNav,label:/);
  const back=block('function contextualBack(target','function contextBarHtml(target)');
  assert.match(back,/delete viewContextUi\[target\]/);
  assert.match(back,/showSecondaryView\(ctx\?\.returnView\|\|fallbackView,ctx\?\.navKey\|\|fallbackNav,false(?:,ctx\?\.scrollY\|\|0)?\)/);
});

test('r78 Scanner to Forecast keeps selected asset and exposes a contextual return bar',()=>{
  const scanner=block('function renderScanner(force=false){','function skNum(');
  assert.match(scanner,/fibUi\.symbol=String\(btn\.dataset\.forecastAsset\|\|'BTC'\)\.toUpperCase\(\)/);
  assert.match(scanner,/persistUiContext\(\);showSecondaryView\('market','market'\)/);
  const market=block('function renderMarket(force=false){','function scannerCard(symbol){');
  assert.match(market,/contextBarHtml\('market'\)/);
  assert.match(market,/bindContextBack\(view,'market','research','research'\)/);
  assert.match(css,/\.context-return-bar/);
});

test('r78 Asset Detail returns to its actual Depot Bots or Scanner origin',()=>{
  const open=block('function openAssetDetail(symbol','function assetDetailHoldingHtml(symbol){');
  assert.match(open,/showSecondaryView\('asset-detail',navKey,\{returnView,navKey,label:/);
  assert.match(open,/contextualBack\('asset-detail',assetDetailUi\.returnView\|\|'depot',assetDetailUi\.navKey\|\|'depot'\)/);
  assert.match(v10,/contextReturnLabel\('asset-detail','ZURÜCK'\)/);
});

test('r78 Paper to LAB to Paper preserves the nested return path',()=>{
  const paper=block('function renderPaperCockpit(force=false){','function renderLab(){');
  assert.match(paper,/contextReturnLabel\('paper','SCANNER'\)/);
  assert.match(paper,/contextualBack\('paper','research','research'\)/);
  assert.match(paper,/showSecondaryView\('more','research'\)/);
  const lab=block('function renderLab(){','function activeViewKey(){');
  assert.match(lab,/contextReturnLabel\('more','SCANNER'\)/);
  assert.match(lab,/contextualBack\('more','research','research'\)/);
  assert.match(lab,/Rücksprung folgt dem Aufrufkontext/);
});

test('r78 direct primary navigation clears stale return context for that target',()=>{
  const nav=block('function bindV10NavigationAuthority(){','let raf=0');
  assert.match(nav,/delete viewContextUi\[v\]/);
  assert.ok(nav.indexOf('delete viewContextUi[v]')<nav.indexOf('bridge()?.goView?.(v)'));
});

test('r78 persists context only when the user changes an asset/filter or opens an asset drill-down',()=>{
  const fib=block('function bindFibMap(view){','function renderMarket(force=false){');
  assert.match(fib,/persistUiContext\(\);refreshFibMap\(view\)/);
  const bots=block('function bindBotOverviewControls(view){','function renderBots(force=false){');
  assert.match(bots,/botViewUi\.filter=String\(btn\.dataset\.botFilter\|\|'ALL'\)\.toUpperCase\(\);persistUiContext\(\);renderBots\(true\)/);
  const asset=block('function openAssetDetail(symbol','function assetDetailHoldingHtml(symbol){');
  assert.match(asset,/fibUi\.symbol=key;[\s\S]*persistUiContext\(\)/);
});

test('r78 extends the permanent UI regression gate and remains presentation-only',()=>{
  for(const token of ['UI session context block missing','UI context must remain session-only','contextual back helper missing','Scanner-to-Forecast return context missing','Paper contextual back missing','LAB contextual back missing','direct primary navigation must clear stale target context','contextual return bar styling missing'])assert.ok(gate.includes(token),token);
  const core=block("const UI_CONTEXT_KEY='meridian.v10.context.v1'","function dataGuardDecorate(){");
  assert.doesNotMatch(core,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
  assert.match(css,/@media\(max-width:760px\)\{\.context-return-bar button\{min-height:44px\}\}/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
