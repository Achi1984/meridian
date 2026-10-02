import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');

function body(startMarker,endMarker){
  const start=server.indexOf(startMarker),end=server.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,startMarker+' definition missing');
  return server.slice(start,end);
}

test('booked-fee Paper ledgers preserve last unrealized value on missing or stale quotes',()=>{
  const routes=[
    ['async function cycleUnlocked()','function cycle()'],
    ['async function shadowV1Cycle(m)','async function shadowV1Status()'],
    ['async function challengerV2Cycle(m)','async function challengerV2Status()'],
    ['async function regimeV1Cycle(m)','async function regimeV1Status()'],
  ];
  for(const [start,end] of routes){
    const src=body(start,end);
    assert.match(src,/if\(!q\|\|Date\.now\(\)-q\.ts>config\.marketStaleMs\)\{unreal\+=Number\(p\.unrealized\|\|0\);next\.push\(p\);continue;\}/);
  }
});

test('Challenger V3 keeps its existing stricter quote validation and unrealized preservation',()=>{
  const src=body('async function challengerV3CycleUnlocked','async function challengerV3Status');
  assert.match(src,/!Number\.isFinite\(q\.price\)/);
  assert.match(src,/q\.price<=0/);
  assert.match(src,/unrealized\+=p\.unrealized\|\|0/);
  assert.doesNotMatch(src,/unreal\+=Number\(p\.unrealized\|\|0\)/);
});
