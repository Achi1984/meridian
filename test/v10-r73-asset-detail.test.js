import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

function block(start,end){
  const a=v10.indexOf(start),b=v10.indexOf(end,a);
  assert.ok(a>=0&&b>a,'block missing: '+start);
  return v10.slice(a,b);
}

test('r73 Asset Detail contract remains active on successor terminal builds',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=73);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/ASSET-DETAIL/);
  assert.ok(root.includes(release.terminalBuild+'-production'));
  assert.ok(html.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  const rev=release.terminalBuild.split('-').at(-1);
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r73 adds Asset Detail as secondary view without creating a sixth primary tab',()=>{
  assert.match(html,/id="view-asset-detail"/);
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="asset-detail"/);
  assert.match(v10,/if\(active==='asset-detail'\)return renderAssetDetail\(force\)/);
});

test('r73 Asset Detail keeps Holdings Bot exposure and market context separate',()=>{
  const render=block('function renderAssetDetail(force=false){','function depotAssetCard');
  assert.match(render,/KNOWN HOLDING DETAIL/);
  assert.match(render,/LIVE BOTS/);
  assert.match(render,/OPPORTUNITY QUALITY/);
  assert.match(render,/Holdings, Bot-Exposure und Markt-Kontext bleiben getrennte Ebenen/);
  assert.match(render,/keine Doppelzählung/);
  assert.doesNotMatch(render,/known\s*\+\s*exposure|valueUsd\s*\+\s*longUsd|valueUsd\s*\+\s*shortUsd/);
});

test('r73 Asset Detail composes existing read-only bot risk and Forecast/Fib functions',()=>{
  const holding=block('function assetDetailHoldingHtml(symbol){','function assetDetailBotHtml(symbol){');
  const bots=block('function assetDetailBotHtml(symbol){','function assetDetailMarketHtml(symbol){');
  const market=block('function assetDetailMarketHtml(symbol){','function renderAssetDetail(force=false){');
  assert.match(holding,/depotAssetRows\(\)/);
  assert.match(bots,/matchedRows\(symbol\)/);
  assert.match(bots,/pairCard\(symbol,false,true,false\)/);
  assert.match(market,/forecastContextHtml\(symbol\)/);
  assert.match(market,/marketRow\(symbol\)/);
  assert.match(market,/fibMapHtml\(\)/);
});

test('r73 links Depot Bots and Scanner into the same Asset Detail drill-down',()=>{
  assert.match(v10,/bindAssetDetailLinks\(view,'depot','depot'\)/);
  assert.match(v10,/bindAssetDetailLinks\(view,'bots','bots'\)/);
  assert.match(v10,/bindAssetDetailLinks\(view,'research','research'\)/);
  assert.match(v10,/data-asset-detail/);
  assert.match(v10,/ASSET DETAIL/);
  assert.match(css,/\.asset-detail-open/);
});

test('r73 remembers the originating primary view for deterministic Back navigation',()=>{
  const open=block('function openAssetDetail(symbol','function closeAssetDetail(){');
  const close=block('function closeAssetDetail(){','function assetDetailHoldingHtml(symbol){');
  assert.match(open,/assetDetailUi\.returnView=returnView/);
  assert.match(open,/assetDetailUi\.navKey=navKey/);
  assert.match(open,/showSecondaryView\('asset-detail',navKey\)/);
  assert.match(close,/showSecondaryView\(assetDetailUi\.returnView\|\|'depot',assetDetailUi\.navKey\|\|'depot'\)/);
});

test('r73 fixes the Fib selector to the selected Asset Detail identity across rerenders',()=>{
  const bind=block('function bindFibMap(view){','function renderMarket(force=false){');
  assert.match(bind,/assetLocked=view\?\.id==='view-asset-detail'/);
  assert.match(bind,/asset\.value=assetDetailUi\.symbol/);
  assert.match(bind,/asset\.disabled=true/);
  assert.match(v10,/fibUi\.symbol=symbol/);
});

test('r73 Asset Detail stays read-only and mobile-first',()=>{
  const start=v10.indexOf('function assetDetailButton');
  const end=v10.indexOf('function depotAssetCard',start);
  const ui=v10.slice(start,end);
  assert.doesNotMatch(ui,/submitOrder|placeOrder|createOrder|cancelOrder|method:\s*['"]POST|\/trade\/order/);
  assert.match(css,/\.asset-detail-hero/);
  assert.match(css,/@media\(max-width:520px\)[\s\S]*\.asset-detail-holding-summary/);
  assert.match(css,/\.scan-drill-actions/);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
