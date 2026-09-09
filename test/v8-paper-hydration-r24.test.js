import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const module=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');

test('R24 loads one cache-coherent PAPER data module graph',()=>{
  assert.match(html,/app\.js\?v=8\.0-r37/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r37/);
  assert.match(app,/\.\/data\.js\?v=8\.0-r37/);
  assert.match(module,/\.\/data\.js\?v=8\.0-r37/);
});

test('R24 carries protected audit aggregates through the primary PAPER model',()=>{
  assert.match(data,/deepDive:analytics\?\.deepDive\|\|null/);
  assert.match(data,/executionAudit:analytics\?\.executionAudit\|\|null/);
  assert.match(app,/meridian:v8-paperdata/);
  assert.match(app,/executionAudit:state\.paper\.executionAudit/);
  assert.ok(app.indexOf("root.innerHTML=paperHtml(state.paper)")<app.indexOf("meridian:v8-paperdata"));
});

test('R24 restores audit and cohort synchronously after every PAPER render',()=>{
  assert.match(module,/window\.addEventListener\('meridian:v8-paperdata',e=>accept\(e\.detail\)\)/);
  assert.match(module,/cached=payload/);
  assert.match(module,/render\(payload\.deepDive\)/);
  assert.match(module,/renderExecutionAudit\(payload\.executionAudit,payload\.botHealth\)/);
  assert.doesNotMatch(app,/async function hydratePaper\(\)\{state\.paper=null/);
});

test('R24 clears protected cache on token changes and remains read-only',()=>{
  assert.match(module,/meridian:v8-tokenchange',\(\)=>\{cached=null/);
  const all=app+data+module;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
});
