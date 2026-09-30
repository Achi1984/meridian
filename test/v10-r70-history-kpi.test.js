import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function extract(name,nextName){
  const start=v10.indexOf('function '+name);
  const end=v10.indexOf('\nfunction '+nextName,start);
  assert.ok(start>=0&&end>start,'function slice missing: '+name);
  return v10.slice(start,end);
}
const selectHistoryAnchor=new Function(extract('selectHistoryAnchor','historyDelta')+';return selectHistoryAnchor')();

test('r70 release identity is execution-neutral and cache-coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r70');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r70-COMMAND-DEPOT-HISTORY-HARDENED');
  assert.match(root,/10\.0-r70-production/);
  assert.match(html,/10\.0-r70/);
  assert.match(v10,/const BUILD='10\.0-r70'/);
  assert.equal(manifest.start_url,'./v10/?build=r70&fresh=r70');
});

test('r70 accepts the nearest strict history point slightly after the exact 7d boundary',()=>{
  const target=1_000_000;
  const rows=[
    {timestamp:target+2*60_000,totalUsd:101,sourceStatus:{spot:'STRICT_AUTHORITY'}},
    {timestamp:target-8*60_000,totalUsd:99,sourceStatus:{spot:'STRICT_AUTHORITY'}}
  ];
  const picked=selectHistoryAnchor(rows,target);
  assert.equal(picked.timestamp,target+2*60_000);
  assert.equal(picked.totalUsd,101);
});

test('r70 rejects a history anchor beyond the frozen 15 minute tolerance',()=>{
  const target=2_000_000;
  const picked=selectHistoryAnchor([
    {timestamp:target+16*60_000,totalUsd:100,sourceStatus:{spot:'STRICT_AUTHORITY'}}
  ],target);
  assert.equal(picked,null);
});

test('r70 history anchor remains strict-authority only',()=>{
  const target=3_000_000;
  const picked=selectHistoryAnchor([
    {timestamp:target,totalUsd:150,sourceStatus:{spot:'HOLDINGS_PLUS_LIVE_PRICE'}},
    {timestamp:target+4*60_000,totalUsd:140,sourceStatus:{spot:'STRICT_AUTHORITY'}}
  ],target);
  assert.equal(picked.totalUsd,140);
});

test('r70 preserves the five-tab r69 information architecture',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="more"/);
});

test('r70 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
