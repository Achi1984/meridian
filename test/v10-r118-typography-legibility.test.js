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
  assert.equal(version.terminalBuild,'10.0-r118');
  assert.equal(checkpoint.terminalBuild,'10.0-r118');
  assert.equal(resume.build,'10.0-r118');
  assert.match(index,/10\.0-r118/);
  assert.match(manifest,/r118/);
  assert.match(v10Index,/10\.0-r118/);
  assert.match(v10Js,/const BUILD='10\.0-r118'/);
  assert.equal(version.terminalExecutionImpact,false);
});
