import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');

test('r19 data events force-refresh only the active data view and preserve LAB state',()=>{
  assert.match(v10,/function activeViewKey\(\)/);
  assert.match(v10,/function decorate\(forceData=false\)/);
  assert.match(v10,/renderCommand\(forceData&&active==='command'\)/);
  assert.match(v10,/renderBots\(forceData&&active==='bots'\)/);
  assert.match(v10,/renderMarket\(forceData&&active==='market'\)/);
  assert.match(v10,/renderScanner\(forceData&&active==='research'\)/);
  assert.match(v10,/renderLab\(\);renderSystemHeader\(\)/);
  assert.match(v10,/window\.addEventListener\('meridian:data',\(\)=>schedule\(true\)\)/);
  assert.match(v10,/new MutationObserver\(\(\)=>schedule\(false\)\)/);
});

test('r19 command bots market and scanner accept explicit refresh without removing LAB results',()=>{
  for(const fn of ['renderCommand','renderBots','renderMarket','renderScanner']){
    assert.ok(v10.includes('function '+fn+'(force=false)'),fn);
  }
  const lab=v10.slice(v10.indexOf('function renderLab(){'),v10.indexOf('function decorate('));
  assert.doesNotMatch(lab,/forceData|force=false/);
});

test('r19 does not reintroduce the known LAB single-selector collection bug',()=>{
  assert.ok(!v10.includes("...$('.card',view).filter"),'single-element $ selector must not be treated as a collection');
  assert.ok(v10.includes("...$('.card',view).filter"),'LAB cards must use the collection selector');
});

test('r19 stale MARKET rows never present an old bull bear signal as current',()=>{
  const block=v10.slice(v10.indexOf('function marketRow'),v10.indexOf('function btcRegimeLabel'));
  assert.match(block,/fresh=intelFresh\(i\)/);
  assert.match(block,/label:'DATA STALE'/);
  assert.match(block,/REFERENCE ONLY/);
  assert.match(block,/market-row-stale/);
});

test('r19 stale SCANNER rows are blocked while retaining reference diagnostics',()=>{
  const block=v10.slice(v10.indexOf('function scannerCard'),v10.indexOf('function renderScanner'));
  assert.match(block,/fresh=intelFresh\(i\)/);
  assert.match(block,/label:'DATA STALE'/);
  assert.match(block,/LONG VIEW <b>'\+\(fresh\?esc\(i\.longAction\):'BLOCKED'\)/);
  assert.match(block,/SHORT VIEW <b>'\+\(fresh\?esc\(i\.shortAction\):'BLOCKED'\)/);
  assert.match(block,/Veraltete technische Werte nur als Referenz/);
});

test('r19 market coverage distinguishes stale from missing assets',()=>{
  assert.match(v10,/staleAssets=Math\.max\(0,knownAssets-freshAssets\)/);
  assert.match(v10,/missingAssets=Math\.max\(0,totalAssets-knownAssets\)/);
  assert.ok(v10.includes("mh.staleAssets+' stale · '+mh.missingAssets+' missing"));
  assert.ok(v10.includes("stale.length+' / '+missing.length"));
});

test('r19 browser adapter parses after active-refresh audit',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
