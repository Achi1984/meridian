import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync('v10/v10.css','utf8');
const version=JSON.parse(readFileSync('version.json','utf8'));
const checkpoint=JSON.parse(readFileSync('MERIDIAN_LIVE_CHECKPOINT.json','utf8'));
const resume=JSON.parse(readFileSync('MERIDIAN_RESUME.json','utf8'));
const index=readFileSync('index.html','utf8');
const v10Index=readFileSync('v10/index.html','utf8');
const v10Js=readFileSync('v10/v10.js','utf8');
const manifest=readFileSync('manifest.webmanifest','utf8');

test('r118 degraded portfolio history uses compact legible typography',()=>{
  assert.match(css,/\/\* v10 r118 · degraded history typography \*\//);
  assert.match(css,/\.portfolio-degraded-history span\{font-size:10px/);
  assert.match(css,/\.portfolio-degraded-history b\{font-size:11px/);
  assert.match(css,/\.portfolio-degraded-history small\{grid-column:1\/-1;font-size:10px/);
  assert.doesNotMatch(css,/\.portfolio-degraded-history (?:span|b|small)\{[^}]*font-size:[789]px/);
});

test('r118 release identity stays coherent and execution neutral',()=>{
  const build=String(version.terminalBuild||'');
  assert.match(build,/^10\.0-r\d+$/);
  assert.ok(Number(build.split('r').at(-1))>=118);
  assert.equal(checkpoint.terminalBuild,build);
  assert.equal(resume.build,build);
  const tag=build.split('-').at(-1);
  assert.ok(index.includes(build));
  assert.equal(JSON.parse(manifest).start_url,'./v10/?build='+tag+'&fresh='+tag);
  assert.ok(v10Index.includes(build));
  assert.ok(v10Js.includes("const BUILD='"+build+"'"));
  assert.equal(version.terminalExecutionImpact,false);
});
