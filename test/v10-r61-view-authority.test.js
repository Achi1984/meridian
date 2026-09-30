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

test('r61 delegates fresh Wallet-vs-private precedence to the canonical authority resolver',()=>{
  const block=v9.slice(v9.indexOf('function portfolioModel'),v9.indexOf('function pick'));
  assert.match(v9,/authoritativePionexEquitySnapshot/);
  assert.match(block,/resolvedPionex=authoritativePionexEquitySnapshot\(d,now\)/);
  assert.match(block,/pionexSource:resolvedPionex\.source/);
  assert.match(block,/pionexUpdatedAt:resolvedPionex\.updatedAt/);
});

test('r61 changes lifecycle and portfolio source precedence only in successor releases',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=61);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
