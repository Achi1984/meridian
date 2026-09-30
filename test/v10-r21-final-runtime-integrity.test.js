import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r21 data events force-refresh only the active live-data view',()=>{
  assert.match(v10,/function activeViewKey\(\)/);
  assert.match(v10,/function decorate\(forceData=false\)/);
  assert.match(v10,/renderCommand\(forceData&&active==='command'\)/);
  assert.match(v10,/renderBots\(forceData&&active==='bots'\)/);
  assert.match(v10,/renderMarket\(forceData&&active==='market'\)/);
  assert.match(v10,/renderScanner\(forceData&&active==='research'\)/);
  assert.match(v10,/window\.addEventListener\('meridian:data',[\s\S]*schedule\(true\)/);
  assert.match(v10,/activeViewKey\(\)==='command'[\s\S]*refreshCurrentView/);
  assert.match(v10,/new MutationObserver\(\(\)=>schedule\(false\)\)/);
});

test('r21 LAB is not force-rebuilt by background data refresh',()=>{
  const block=v10.slice(v10.indexOf('function decorate(forceData=false)'),v10.indexOf("window.addEventListener('meridian:data'"));
  assert.match(block,/renderLab\(\);renderSystemHeader\(\)/);
  assert.doesNotMatch(block,/renderLab\(forceData/);
});

test('r21 force refresh preserves manual Fib input before MARKET rerender',()=>{
  const block=v10.slice(v10.indexOf('function renderMarket(force=false)'),v10.indexOf('function scannerCard'));
  assert.match(block,/if\(force&&fibUi\.mode==='MANUAL'\)/);
  assert.match(block,/fibUi\.manualLow=lo/);
  assert.match(block,/fibUi\.manualHigh=hi/);
  assert.match(block,/fibUi\.direction=dir/);
});

test('r21 stale MARKET data is explicitly reference-only',()=>{
  const block=v10.slice(v10.indexOf('function marketRow'),v10.indexOf('function btcRegimeLabel'));
  assert.match(block,/fresh=intelFresh\(i\)/);
  assert.match(block,/market-row-stale/);
  assert.match(block,/REFERENCE ONLY/);
  assert.match(block,/marketSignal\(i\)/);
});

test('r21 stale SCANNER diagnostics are visible but actions and ranking are blocked',()=>{
  const block=v10.slice(v10.indexOf('function scannerCard'),v10.indexOf('function renderScanner'));
  assert.match(block,/fresh=intelFresh\(i\)/);
  assert.match(block,/scan-stale/);
  assert.match(block,/REFERENCE ONLY/);
  assert.match(block,/OPPORTUNITY QUALITY/);
  assert.match(block,/ctx\.available\?ctx\.score\+'\/100':'—'/);
  assert.match(v10,/if\(!i\|\|!intelFresh\(i\)\)return\{available:false,score:0/);
  assert.match(block,/LONG VIEW <b>'\+\(fresh\?esc\(i\.longAction\):'BLOCKED'\)/);
  assert.match(block,/SHORT VIEW <b>'\+\(fresh\?esc\(i\.shortAction\):'BLOCKED'\)/);
});

test('r21 market coverage separates stale and missing technical feeds',()=>{
  assert.ok(v10.includes("mh.staleAssets+' stale · '+mh.missingAssets+' missing"));
  const successorCanonical=v10.includes("stale=all.filter(x=>!!marketIntel(x)&&!intelFresh(marketIntel(x)))")&&v10.includes("missing=all.filter(x=>!marketIntel(x))");
  const legacyAssetIntel=v10.includes("stale=all.filter(x=>!!s?.assetIntel?.[x]&&!intelFresh(s.assetIntel[x]))")&&v10.includes("missing=all.filter(x=>!s?.assetIntel?.[x])");
  assert.ok(successorCanonical||legacyAssetIntel);
  assert.ok(v10.includes("stale.length+' / '+missing.length"));
});

test('r21 release identity is canonical and browser adapter parses',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=21);
  assert.ok(shell.includes(release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  for(const modulePath of ['./fib-core.js','../research/sk-paperbot-v1.js','../research/sk-research-v2.js','../research/documented-edge-v1.js','../research/tsmom-holdout-v1.js'])assert.ok(v10.includes(modulePath+'?v='+release.terminalBuild),modulePath);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
