import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const loader=fs.readFileSync(new URL('../app-v6.06.js',import.meta.url),'utf8');
const authority=fs.readFileSync(new URL('../app-release-authority.js',import.meta.url),'utf8');
const version=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('R9 loader derives a fresh authority tag before loading modules',()=>{
  assert.match(loader,/version\.json\?bootstrap=/);
  assert.match(loader,/cache:'no-store'/);
  assert.match(loader,/authorityTag/);
  assert.match(loader,/injectLatestLoader/);
  assert.match(loader,/MERIDIAN_LOADER_TAG/);
  assert.match(loader,/const LOCAL_TAG='8\.0-R9'/);
});

test('R9 release authority can replace a stale compatibility loader without changing execution',()=>{
  assert.match(authority,/bootstrapMismatch/);
  assert.match(authority,/app-v6\.06\.js\?v=/);
  assert.match(authority,/MERIDIAN_LOADER_TAG/);
  assert.doesNotMatch(authority,/placeOrder|createOrder|submitOrder|liveTrading\s*=\s*true/i);
});

test('R9 metadata and manifest identify the same build',()=>{
  assert.equal(version.buildId,'8.0-20260905-R9');
  assert.equal(version.v8Bootstrap,'8.0-AUTHORITY-DRIVEN-LOADER-V1');
  assert.equal(manifest.start_url,'./?build=8.0-20260905-R9');
  assert.equal(version.executionImpact,false);
});
