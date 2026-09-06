import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.css',import.meta.url),'utf8');

test('R18 cohort board is wired into v8 clean PAPER',()=>{
  assert.match(html,/paper-cohort-r18\.css\?v=8\.0-r18/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r18/);
  assert.match(js,/\/api\/research-analytics/);
  assert.match(js,/CHALLENGER V2 · COHORT DEEP DIVE/);
});

test('R18 exposes side regime asset cohort views and sample adequacy',()=>{
  assert.match(js,/block\('SIDE',deep\.bySide\)/);
  assert.match(js,/block\('REGIME',deep\.byRegime\)/);
  assert.match(js,/block\('ASSET',deep\.bySymbol\)/);
  assert.match(js,/N OK/);
  assert.match(js,/n&lt;8/);
});

test('R18 remains research-only and read-only',()=>{
  const all=js+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['\"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
  assert.match(js,/Research only/);
});
