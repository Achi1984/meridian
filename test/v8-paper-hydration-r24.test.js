import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const module=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');

test('R24 loads one cache-coherent PAPER data module graph',()=>{
  assert.match(html,/app\.js\?v=8\.0-r44/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r44/);
  assert.match(app,/\.\/data\.js\?v=8\.0-r44/);
  assert.match(module,/\.\/data\.js\?v=8\.0-r44/);
});

test('R41 hydrates the primary PAPER board through one protected overview request',()=>{
  assert.match(data,/getJson\('\/api\/paper\/overview'\)/);
  const quick=data.match(/if\(!details\)\{([\s\S]*?)\n  \}/)?.[1]||'';
  assert.equal((quick.match(/getJson\(/g)||[]).length,1);
  assert.doesNotMatch(quick,/\/api\/challenger-v[23]|getJson\('\/api\/paper'\)|getJson\('\/api\/status'\)/);
});

test('R41 overview contract is read-only and covered by PAPER gateway protection',()=>{
  assert.match(server,/req\.method==="GET"&&u\.pathname==="\/api\/paper\/overview"/);
  assert.match(server,/schemaVersion:'8\.0-PAPER-OVERVIEW-V1'/);
  assert.doesNotMatch(server,/req\.method==="POST"&&u\.pathname==="\/api\/paper\/overview"/);
  assert.match(gateway,/const PROTECTED_PREFIXES = \[[\s\S]*"\/api\/paper"/);
  assert.match(gateway,/pathname\.startsWith\(p\.endsWith\("\/"\)\?p:p\+"\/"\)/);
});

test('R24 carries protected audit aggregates through the primary PAPER model',()=>{
  assert.match(data,/deepDive:analytics\?\.deepDive\|\|null/);
  assert.match(data,/executionAudit:analytics\?\.executionAudit\|\|null/);
  assert.match(app,/meridian:v8-paperdata/);
  assert.match(app,/executionAudit:state\.paper\.executionAudit/);
  assert.ok(app.indexOf("root.innerHTML=paperHtml(state.paper)")<app.indexOf("meridian:v8-paperdata"));
});

test('R44 restores active V3 audit synchronously after every PAPER render',()=>{
  assert.match(module,/window\.addEventListener\('meridian:v8-paperdata',e=>accept\(e\.detail\)\)/);
  assert.match(module,/cached=payload/);
  assert.doesNotMatch(module,/render\(payload\.deepDive\)/);
  assert.match(module,/renderExecutionAudit\(payload\.executionAudit,payload\.botHealth\)/);
  assert.doesNotMatch(app,/async function hydratePaper\(\)\{state\.paper=null/);
});

test('R24 clears protected cache on token changes and remains read-only',()=>{
  assert.match(module,/meridian:v8-tokenchange',\(\)=>\{cached=null/);
  const all=app+data+module;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
});
