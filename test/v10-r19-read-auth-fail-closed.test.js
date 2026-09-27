import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');

test('r19 private read auth has no embedded fallback credential hash',()=>{
  assert.doesNotMatch(gateway,/LEGACY_READ_TOKEN_HASH/);
  assert.doesNotMatch(gateway,/LEGACY_FALLBACK/);
  assert.match(gateway,/const READ_TOKEN_HASH=String\(process\.env\.MERIDIAN_READ_TOKEN_SHA256\|\|""\)/);
});

test('r19 missing or invalid read auth fails closed',()=>{
  assert.match(gateway,/READ_AUTH_SOURCE=.*"ENV".*"INVALID_ENV":"MISSING_ENV"/);
  assert.match(gateway,/if\(!token\|\|!\/\^\[a-f0-9\]\{64\}\$\/\.test\(expectedHash\)\)return false/);
  assert.match(gateway,/MISSING_ENV.*protected reads fail closed/);
  assert.match(gateway,/INVALID_ENV.*protected reads fail closed/);
});

test('r19 runtime smoke requires env-backed private read auth',()=>{
  assert.match(smoke,/privateReadConfigured!==true/);
  assert.match(smoke,/privateReadAuthSource\|\|''\)!=='ENV'/);
  assert.match(smoke,/Gateway private read auth must come from ENV/);
});

test('r19 health exposes auth posture but not token material',()=>{
  assert.match(gateway,/privateReadConfigured:/);
  assert.match(gateway,/privateReadAuthSource:READ_AUTH_SOURCE/);
  assert.doesNotMatch(gateway,/privateReadToken|readTokenHash|MERIDIAN_READ_TOKEN_SHA256:/);
});
