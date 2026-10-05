import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r17 unmatched private API rows pre-empt HOLD unless a higher safety risk exists',()=>{
  const block=v10.slice(v10.indexOf('function criticalPair'),v10.indexOf('function nextAction'));
  assert.match(block,/candidates=symbols\(\)\.map/);
  assert.match(block,/unmatched=s\.unmatchedLive\|\|\[\]/);
  assert.match(block,/candidates\.push\(\{symbol:'API'/);
  assert.match(block,/rank:90/);
  assert.match(block,/candidates\.sort\(\(a,b\)=>b\.status\.rank-a\.status\.rank\)/);
});

test('r17+ Data Guard and header distinguish partial live coverage from complete readiness',()=>{
  assert.match(v10,/PARTIAL READY/);
  assert.match(v10,/decisionComplete=matched>0&&coverageComplete&&decisionReady===matched/);
  assert.match(v10,/label=g\.decisionComplete\?'DECISION READY':g\.decisionReady>0\?'PARTIAL READY'/);
  assert.match(v10,/function marketReadiness\(m\)/);
  assert.match(v10,/function botReadiness\(g\)/);
  assert.match(v10,/label:'PARTIAL'/);
});

test('r17 SK V2 batch fails closed when any frozen-universe asset is missing',()=>{
  const block=v10.slice(v10.indexOf('function runSkV2Batch'),v10.indexOf('function bindSkV2'));
  assert.match(block,/const runs=\[\],failures=\[\]/);
  assert.match(block,/V2 DATA GATE/);
  assert.match(block,/runs\.length!==SK_RESEARCH_V2_ASSETS\.length/);
  assert.doesNotMatch(block,/if\(runs\.length<3\)/);
});

test('r17 documented edge batch requires the complete frozen asset source set',()=>{
  const block=v10.slice(v10.indexOf('function runDocumentedEdgeBatch'),v10.indexOf('function bindDocumentedEdge'));
  assert.match(block,/const data=\{\},failures=\[\]/);
  assert.match(block,/EDGE DATA GATE/);
  assert.match(block,/Object\.keys\(data\)\.length!==DOCUMENTED_EDGE_ASSETS\.length/);
  assert.doesNotMatch(block,/Object\.keys\(data\)\.length<3/);
});

test('r17 holdout source loading fails closed before statistical evaluation',()=>{
  const block=v10.slice(v10.indexOf('function runTsmomHoldout'),v10.indexOf('function bindTsmomHoldout'));
  assert.match(block,/h1Failures=\[\],h2Failures=\[\]/);
  assert.match(block,/H1 SOURCE GATE/);
  assert.match(block,/H2 SOURCE GATE/);
  assert.match(block,/Object\.keys\(legacyData\)\.length!==DOCUMENTED_EDGE_ASSETS\.length/);
  assert.match(block,/Object\.keys\(transferData\)\.length!==TSMOM_TRANSFER_ASSETS\.length/);
});

test('r17 Fib auto swing uses closed 4h anchors but retains a live current-price path',()=>{
  const block=v10.slice(v10.indexOf('async function updateFibMap'),v10.indexOf('function bindFibMap'));
  assert.match(block,/Math\.min\(300,Math\.max\(180,windowSize\+5\)\)/);
  assert.match(block,/const swingRows=.*closeTime.*Date\.now\(\)-1000/s);
  assert.match(block,/detectSwing\(swingRows,windowSize\)/);
  assert.match(block,/detectOpposingChildSwing\(swingRows,parent,windowSize\)/);
  assert.match(block,/let current=rows\?\.length\?Number\(rows\.at\(-1\)\?\.close\):null/);
  assert.match(block,/×4h CLOSED/);
});

test('r17 LAB escapes external error messages before DOM insertion',()=>{
  for(const expr of ['esc(skLabUi.error)','esc(skV2Ui.error)','esc(edgeUi.error)','esc(holdoutUi.error)']) assert.ok(v10.includes(expr),expr);
});

test('r17 release identity remains canonical and adapter parses',()=>{
  const build=String(release.terminalBuild||'');
  assert.match(build,/^10\.0-r\d+$/);
  assert.ok(shell.includes(build));
  assert.ok(v10.includes("const BUILD='"+build+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
