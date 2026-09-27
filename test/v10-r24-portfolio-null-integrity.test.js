import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=fs.readFileSync(new URL('../portfolio-data-contract.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r24 canonical holdings are missing-aware',()=>{
  assert.match(contract,/const finite=v=>v===null\|\|v===undefined\|\|v===''\?null/);
  const block=contract.slice(contract.indexOf('export function holdingUsd'),contract.indexOf('export function pionexEquitySnapshot'));
  assert.match(block,/q=finite\(holding\.quantity\)/);
  assert.match(block,/stored=finite\(holding\.value\)\?\?finite\(holding\.valueUsd\)\?\?finite\(holding\.usdValue\)/);
  assert.doesNotMatch(block,/Number\(holding\.quantity\)/);
});

test('r24 v9 cache identity follows canonical contract revision',()=>{
  assert.match(v9,/portfolio-data-contract\.js\?v=10\.0-r24/);
});

test('r24 release identity is canonical',()=>{
  assert.equal(release.terminalBuild,'10.0-r24');
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
