import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r61 legacy renderer emits a deterministic view lifecycle event',()=>{
  assert.match(v9,/function go\(v\).*CustomEvent\('meridian:view'/s);
  assert.match(v9,/queueMicrotask/);
  assert.match(v10,/window\.addEventListener\('meridian:view',\(\)=>schedule\(true\)\)/);
});

test('r61 prefers fresh Wallet API equity when an older private snapshot has no usable freshness',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(block,/walletFresh=String\(d\?\.pionexAccountSync\?\.status\|\|'UNKNOWN'\)==='OK'/);
  assert.match(block,/privateFresh=privatePionex\.found&&Number\.isFinite\(privateTs\)/);
  assert.match(block,/walletPionex&&\(!privateFresh\|\|walletTs>=privateTs\)\?walletPionex/);
  assert.match(block,/source:'PIONEX_WALLET_READ_API'/);
});

test('r61 changes lifecycle and portfolio source precedence only',()=>{
  assert.equal(release.terminalBuild,'10.0-r61');
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
