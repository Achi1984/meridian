import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {ARENA_SYMBOLS,ARENA_RULESET} from '../research/strategy-paper-arena.js';
import {arenaHtml,evaluateArenaImport,canonicalArenaInput} from '../v10/strategy-arena.js';
const DAY=86400000;
function input(){
  const start=Date.UTC(2025,0,1), data=Object.fromEntries(ARENA_SYMBOLS.map(symbol=>[symbol,Array.from({length:210},(_,i)=>({openTime:start+i*DAY,closeTime:start+(i+1)*DAY-1,open:100+i,close:100+i+.5,high:101+i,low:99+i}))]));
  return {data,asOf:start+210*DAY,sourceKind:'SYNTHETIC',liquidateAtEnd:true};
}
test('arena has five visible candidates with absent metrics and no fake winner before input',()=>{
  const html=arenaHtml();
  for(const id of ['H1-B','H1-E','H7-B','H7-R','H9'])assert.ok(html.includes(id));
  assert.ok(html.includes('Keine Performance behauptet.'));
  assert.ok(html.includes('Keine automatische Siegerwahl'));
  assert.ok(!html.includes('0 %'));
  assert.ok(html.includes('DATEN FEHLEN'));
});
test('import recomputes forged results and labels synthetic output as non-market evidence',async()=>{
  const data=await evaluateArenaImport(JSON.stringify({input:input(),result:{ruleset:ARENA_RULESET,candidates:[{id:'H1-B',baseline:{netPnl:1e9}}]}}),webcrypto.subtle);
  assert.ok(data.result.candidates[0].baseline.netPnl<1e9);
  const html=arenaHtml(data);
  assert.ok(html.includes('SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ'));
  assert.ok(html.includes('TAGESSCHLUSS'));
  assert.ok(html.includes('VERKAUFSTEILE'));
  assert.ok(html.includes('tone-safe'));
  const red=arenaHtml({result:{...data.result,candidates:[{...data.result.candidates[0],baseline:{...data.result.candidates[0].baseline,netPnl:-1,netReturnPct:-.01}}]}});
  assert.ok(red.includes('tone-danger'));
});
test('receipt and exported-input integrity use the exact sorted JSON newline hash',async()=>{
  const raw=input(), first=await evaluateArenaImport(JSON.stringify(raw),webcrypto.subtle);
  const expected=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalArenaInput(raw)+'\n'))).toString('hex');
  assert.equal(first.digest,expected);
  assert.equal((await evaluateArenaImport(JSON.stringify({input:raw,receipt:{inputSha256:expected}}),webcrypto.subtle)).digest,expected);
  await assert.rejects(evaluateArenaImport(JSON.stringify({input:raw,receipt:{inputSha256:'0'.repeat(64)}}),webcrypto.subtle),/Quellbeleg/);
  await assert.rejects(evaluateArenaImport(JSON.stringify({input:raw,inputSha256:'0'.repeat(64)}),webcrypto.subtle),/Hash/);
});
test('invalid files and rule changes fail closed without reusing a prior result',async()=>{
  await assert.rejects(evaluateArenaImport('x'.repeat(4000001),webcrypto.subtle),/groß/);
  await assert.rejects(evaluateArenaImport('{',webcrypto.subtle));
  await assert.rejects(evaluateArenaImport(JSON.stringify({input:input(),ruleset:'OTHER'}),webcrypto.subtle),/Regelversion/);
  await assert.rejects(evaluateArenaImport(JSON.stringify({input:input(),result:{ruleset:'OTHER'}}),webcrypto.subtle),/Regelversion/);
});
test('all displayed caller error and digest strings are HTML escaped',()=>{
  const html=arenaHtml({error:'<script>alert(1)</script>',digest:'<img src=x onerror=x>'});
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});
