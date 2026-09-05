import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const loader=fs.readFileSync(new URL('../app-v6.06.js',import.meta.url),'utf8');
const authority=fs.readFileSync(new URL('../app-release-authority.js',import.meta.url),'utf8');
const version=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const revision=String(version.buildId||'').split('-').at(-1);
const expectedTag=`${version.version}-${revision}`;

test('authority-driven loader derives a fresh build tag before loading modules',()=>{
  assert.match(loader,/version\.json\?bootstrap=/);
  assert.match(loader,/cache:'no-store'/);
  assert.match(loader,/authorityTag/);
  assert.match(loader,/injectLatestLoader/);
  assert.match(loader,/MERIDIAN_LOADER_TAG/);
  assert.ok(loader.includes(`const LOCAL_TAG='${expectedTag}'`),`loader tag must match ${expectedTag}`);
});

test('release authority can replace a stale compatibility loader without changing execution',()=>{
  assert.match(authority,/bootstrapMismatch/);
  assert.match(authority,/app-v6\.06\.js\?v=/);
  assert.match(authority,/MERIDIAN_LOADER_TAG/);
  assert.doesNotMatch(authority,/placeOrder|createOrder|submitOrder|liveTrading\s*=\s*true/i);
});

test('release metadata and manifest identify the same authoritative build',()=>{
  assert.equal(manifest.start_url,`./?build=${version.buildId}`);
  assert.equal(version.v8Bootstrap,'8.0-AUTHORITY-DRIVEN-LOADER-V1');
  assert.equal(version.executionImpact,false);
});
