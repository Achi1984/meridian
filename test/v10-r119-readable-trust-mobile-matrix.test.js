import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const harness=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const checkpoint=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_LIVE_CHECKPOINT.json',import.meta.url),'utf8'));
const resume=JSON.parse(fs.readFileSync(new URL('../MERIDIAN_RESUME.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10index=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('r119+ release identity stays coherent and execution neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=119);
  const rev=release.terminalBuild.split('-').at(-1);
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(checkpoint.terminalBuild,release.terminalBuild);
  assert.equal(resume.build,release.terminalBuild);
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.match(root,new RegExp(release.terminalBuild.replaceAll('.','\\.')+'-production'));
  assert.match(v10index,new RegExp(release.terminalBuild.replaceAll('.','\\.')));
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r119 lifts only decision and trust typography to a readable floor',()=>{
  const i=css.lastIndexOf('/* v10 r119 · readable decision trust text */');
  assert.ok(i>=0);
  const block=css.slice(i);
  assert.match(block,/\.system-status \.live,[\s\S]*font-size:9px/);
  assert.match(block,/\.v10-mode-banner span,[\s\S]*font-size:9px/);
  assert.match(block,/\.command-source-strip span,[\s\S]*font-size:9px/);
  assert.match(block,/\.command-source-strip b,[\s\S]*font-size:11px/);
  assert.match(block,/\.command-kpi-grid span,[\s\S]*font-size:9px/);
  assert.match(block,/\.attention-row b[\s\S]*font-size:11px/);
  assert.match(block,/\.depot-venue-grid span,[\s\S]*font-size:9px/);
  assert.match(block,/\.depot-integrity-note b\{font-size:10px\}/);
  assert.match(block,/\.asset-toggle-actions button,[\s\S]*min-height:44px;font-size:10px/);
  assert.doesNotMatch(block,/fib-level|fib-current|research-|lab-/);
});

test('r119 extends 375 and 320 visual QA to every first-class view',()=>{
  for(const width of [375,320]){
    for(const [label,view] of [['command','command'],['depot','depot'],['bots','bots'],['forecast','market'],['scanner','research'],['asset-detail','asset-detail'],['paper','paper']]){
      assert.ok(harness.includes("'mobile-"+width+"-"+label+"','"+view+"'"));
    }
  }
  assert.match(js,/smallTrustText/);
  assert.match(js,/smallTrustActions/);
  assert.match(js,/parseFloat\(getComputedStyle\(el\)\.fontSize\)<9/);
  assert.match(js,/getBoundingClientRect\(\)\.height<44/);
  assert.match(js,/!smallTrustText\.length&&!smallTrustActions\.length/);
});

test('r119 stays presentation and QA only',()=>{
  const start=js.indexOf('function writeLocalVisualQaReport'),end=js.indexOf('function writeLocalVisualQaError',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson)/i);
});
