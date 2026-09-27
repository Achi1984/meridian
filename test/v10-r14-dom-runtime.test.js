import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r14 never treats the single-element selector helper as a collection',()=>{
  const bad=/(^|[^$])\$\([^()\n]*\)\.(?:forEach|filter|map|some|every|reduce|find)\s*\(/m;
  assert.doesNotMatch(v10,bad);
  assert.match(v10,/\$\$\('#nav button'\)\.forEach/);
  assert.match(v10,/\$\$\('\.section-title',view\)\.filter/);
  assert.match(v10,/\$\$\(sel,view\)\.forEach/);
});

test('r14 terminal cache identity is canonical across production entry points',()=>{
  assert.equal(release.terminalBuild,'10.0-r14');
  assert.match(html,/content="10\.0-r14"/);
  assert.match(html,/v=10\.0-r14/);
  assert.match(v10,/const BUILD='10\.0-r14'/);
  assert.match(root,/build=r14/);
});

test('r14 adapter remains syntactically valid after DOM hotfix',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});

test('r14 blocks stale market intel from Profit Lock and pair actions',()=>{
  const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
  assert.match(v9,/label:'MARKET · STALE'/);
  assert.match(v9,/if\(!pi\)return\{code:'SYNC'/);
  assert.match(v10,/code:'MARKET_STALE'/);
  assert.match(v10,/\['DATA_STALE','MARKET_STALE','UNVERIFIED'\]/);
});
