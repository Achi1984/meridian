import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');

test('r18 browser requests are bounded by AbortController timeouts',()=>{
  assert.match(v9,/const FETCH_TIMEOUT_MS=10000/);
  assert.match(v9,/async function fetchTimed/);
  assert.match(v9,/new AbortController\(\)/);
  assert.match(v9,/FETCH_TIMEOUT/);
  const raw=(v9.match(/\bfetch\(/g)||[]).length;
  assert.equal(raw,1,'only fetchTimed itself may call raw fetch');
  assert.match(v9,/fetchTimed\(API_BASE\+path/);
  assert.match(v9,/fetchTimed\(u,\{cache:'no-store'\},8000\)/);
});

test('r18 private and market syncs are single-flight',()=>{
  assert.match(v9,/let syncBusy=false/);
  assert.match(v9,/if\(syncBusy\)return false;\s*syncBusy=true/);
  const syncStart=v9.indexOf('async function sync(){');
  assert.ok(syncStart>=0,'sync source missing');
  const syncFinally=v9.indexOf('}finally{',syncStart);
  const syncBusyClear=v9.indexOf('syncBusy=false',syncStart);
  const syncNotify=v9.indexOf('notifyData()',syncBusyClear);
  assert.ok(syncFinally>syncStart,'sync finally missing');
  assert.ok(syncBusyClear>syncFinally,'sync must clear busy in finally');
  assert.ok(syncNotify>syncBusyClear,'sync must notify after clearing busy');
  assert.match(v9,/let syncIntelBusy=false/);
  assert.match(v9,/if\(syncIntelBusy\)return false;syncIntelBusy=true/);
  const intelStart=v9.indexOf('async function syncIntel(){');
  assert.ok(intelStart>=0,'syncIntel source missing');
  const intelFinally=v9.indexOf('}finally{',intelStart);
  const intelBusyClear=v9.indexOf('syncIntelBusy=false',intelFinally);
  assert.ok(intelFinally>intelStart,'syncIntel finally missing');
  assert.ok(intelBusyClear>intelFinally,'syncIntel must clear busy in finally');
});
test('r18+ v10 refresh is event-driven and does not call legacy go(current) inside sync',()=>{
  assert.match(v9,/window\.dispatchEvent\(new CustomEvent\('meridian:data'\)\)/);
  assert.match(v10,/window\.addEventListener\('meridian:data',[\s\S]*schedule\(true\)/);
  assert.match(v10,/activeViewKey\(\)==='command'[\s\S]*refreshCurrentView/);
  const syncBlock=v9.slice(v9.indexOf('async function sync(){'),v9.indexOf('window.MERIDIAN_V10_BRIDGE'));
  assert.doesNotMatch(syncBlock,/go\(current\)/);
});

test('r18+ immediately resyncs sequentially after iOS resume or network reconnect',()=>{
  assert.match(v9,/async function refreshNow\(\)/);
  assert.match(v9,/await sync\(\)/);
  assert.match(v9,/await syncIntel\(\)/);
  assert.match(v9,/visibilitychange/);
  assert.match(v9,/document\.visibilityState==='visible'/);
  assert.match(v9,/window\.addEventListener\('online',\(\)=>\{void refreshNow\(\)\}\)/);
});

test('r18 gateway kills stalled internal proxy requests',()=>{
  assert.match(gateway,/p\.setTimeout\(15000/);
  assert.match(gateway,/upstream_timeout/);
  assert.match(gateway,/timeout\?504:502/);
  assert.match(gateway,/if\(res\.headersSent\)\{res\.destroy\(\);return\}/);
});

test('r18+ gateway reports env-only read-auth source without embedded fallback material',()=>{
  assert.match(gateway,/READ_AUTH_SOURCE/);
  assert.match(gateway,/privateReadAuthSource:READ_AUTH_SOURCE/);
  assert.doesNotMatch(gateway,/LEGACY_FALLBACK/);
  assert.match(gateway,/INVALID_ENV/);
  assert.match(gateway,/MISSING_ENV/);
  assert.match(smoke,/privateReadAuthSource\|\|'UNKNOWN'/);
  assert.match(smoke,/!=='ENV'/);
});

test('r18 v10 browser adapter still parses',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
