import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r62 root and PWA launch use a cache-distinct current terminal URL',()=>{
  assert.equal(release.terminalBuild,'10.0-r62');
  assert.match(root,/meridian-build" content="10\.0-r62-production"/);
  assert.match(root,/p\.set\('build','r62'\)/);
  assert.match(root,/p\.set\('fresh','r62'\)/);
  assert.equal(manifest.start_url,'./v10/?build=r62&fresh=r62');
  assert.equal(manifest.scope,'./');
});

test('r62 v10 shell probes version.json with no-store and self-heals stale builds',()=>{
  assert.match(shell,/const LOCAL_BUILD='10\.0-r62'/);
  assert.match(shell,/fetch\('\.\.\/version\.json\?boot='\+Date\.now\(\),\{cache:'no-store'\}\)/);
  assert.match(shell,/latest===LOCAL_BUILD/);
  assert.match(shell,/u\.searchParams\.set\('build',rev\)/);
  assert.match(shell,/u\.searchParams\.set\('fresh',String\(Date\.now\(\)\)\)/);
  assert.match(shell,/location\.replace\(u\.toString\(\)\)/);
});

test('r62 runtime smoke rejects stale manifest and missing cache-heal',()=>{
  assert.match(smoke,/manifest\.webmanifest\?smoke=/);
  assert.match(smoke,/PWA manifest points to stale terminal build/);
  assert.match(smoke,/v10 shell missing stale-build self-heal/);
  assert.match(smoke,/v10 shell missing no-store version probe/);
});

test('r62 remains display bootstrap only',()=>{
  assert.equal(release.terminalExecutionImpact,false);
});


test('r62 v10 owns navigation after legacy bridge render',()=>{
  assert.match(v9,/goView:\(v\)=>\{if\(render\[v\]\)\{go\(v\);return true\}return false\}/);
  assert.match(v10,/function bindV10NavigationAuthority\(\)/);
  assert.match(v10,/b\.onclick=e=>\{/);
  assert.match(v10,/bridge\(\)\?\.goView\?\.\(v\)/);
  assert.match(v10,/queueMicrotask\(\(\)=>\{/);
  assert.match(v10,/renderActiveView\(v,true\)/);
  assert.match(v10,/V10 VIEW RENDER ERROR/);
});
