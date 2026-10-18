import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import {ARENA_SYMBOLS,ARENA_RULESET} from '../research/strategy-paper-arena.js';
import {arenaHtml,evaluateArenaImport,canonicalArenaInput,loadStoredArena,adaptArenaProvenance,loadStoredArenaProvenance} from '../v10/strategy-arena.js';
const DAY=86400000;
const manifest=()=>JSON.parse(fs.readFileSync(new URL('../research/results/strategy-arena-20261016/manifest.json',import.meta.url),'utf8'));
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
test('stored diagnostic assembles the sealed eight-asset USD input and recomputes it',async()=>{
  let requests=0;
  const result=await loadStoredArena(async url=>{requests++;return {ok:true,text:async()=>fs.readFileSync(new URL(url),'utf8')};},webcrypto.subtle);
  assert.equal(requests,9);
  assert.equal(result.digest,'decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473');
  assert.equal(result.result.currency,'USD');assert.equal(result.result.window.bars,200);
  assert.equal(result.result.validation,'UNPROVEN');
  assert.equal(result.result.liveAuthorized,false);
  const html=arenaHtml(result);assert.ok(html.includes('10.000 USD'));assert.ok(!html.includes('10.000 USDT'));
});
test('stored diagnostic rejects altered chunks and unexpected file references',async()=>{
  const source=async(url,alter)=>({ok:true,text:async()=>alter(fs.readFileSync(new URL(url),'utf8'),url)});
  await assert.rejects(loadStoredArena(url=>source(url,(text,path)=>path.endsWith('/BTC.json')?text+' ':text),webcrypto.subtle),/Hash/);
  await assert.rejects(loadStoredArena(url=>source(url,(text,path)=>{if(!path.endsWith('/manifest.json'))return text;const m=JSON.parse(text);m.chunks[0].path='../../elsewhere.json';return JSON.stringify(m);}),webcrypto.subtle),/Dateiverweis/);
});
test('retrospective provenance is candidate-bound source metadata with explicit unknown hashes',()=>{
  const data=adaptArenaProvenance(manifest());
  for(const id of ['H1-B','H1-E','H7-B','H7-R']){
    assert.equal(data[id].blocked,false);
    assert.match(data[id].fields.market.value,/Kraken Spot · USD \(nicht USDT\)/);
    assert.equal(data[id].fields.market.status,'PRESENT_UNVERIFIED');
    assert.match(data[id].fields.universe.value,/8 Werte:/);
    assert.match(data[id].fields.coverage.value,/11\.09\.2025 – 15\.10\.2026/);
    assert.match(data[id].fields.warmup.value,/11\.09\.2025 – 29\.03\.2026 UTC · 200 Tage/);
    assert.match(data[id].fields.scored.value,/30\.03\.2026 – 15\.10\.2026 UTC · 200 Tage/);
    assert.equal(data[id].receipt.status,'PRESENT_UNVERIFIED');
    assert.equal(data[id].associationStatus,'PRESENT_UNVERIFIED');
    assert.equal(data[id].hashes.inputSha256.value,'decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473');
    assert.equal(data[id].hashes.rawInputSha256.status,'UNKNOWN');
    assert.equal(data[id].hashes.rulesSha256.status,'UNKNOWN');
  }
  assert.equal(data.H9.blocked,true);
  assert.equal(data.H9.receipt.status,'UNKNOWN');
  assert.equal(data.H9.hashes.inputSha256.status,'UNKNOWN');
  const html=arenaHtml({provenance:data});
  assert.ok(html.includes('Kraken-USD-Daten werden nicht zugeordnet'));
  assert.ok(html.includes('CRV ungeklärt'));
  assert.ok(html.includes('<summary>Technische Belegdetails und vollständige Hashes</summary>'));
  assert.ok(html.includes('vorhanden · nicht bestätigt'));
  assert.ok(html.includes('Unbekannt'));
  assert.ok(html.includes('keine Zukunftsdaten'));
  assert.ok(html.replace(/<details>[\s\S]*?<\/details>/g,'').includes('KRAKEN_SPOT_PUBLIC_OHLC')===false);
  assert.ok(html.includes('KRAKEN_SPOT_PUBLIC_OHLC'));
});
test('provenance distinguishes absent values from malformed schema, dates and hashes',()=>{
  const missing=manifest();
  delete missing.receipt.inputSha256;
  missing.summary.window.warmupStart=undefined;
  const missingData=adaptArenaProvenance(missing);
  assert.equal(missingData['H1-B'].hashes.inputSha256.status,'UNKNOWN');
  assert.equal(missingData['H1-B'].fields.coverage.status,'UNKNOWN');
  const malformed=manifest();
  malformed.receipt.engineSha256='not-a-hash';
  malformed.summary.window.firstExecution='2026-03-30';
  const malformedData=adaptArenaProvenance(malformed);
  assert.equal(malformedData['H1-B'].hashes.engineSha256.status,'INVALID');
  assert.equal(malformedData['H1-B'].fields.scored.status,'INVALID');
  malformed.schemaVersion='UNEXPECTED';
  malformed.ruleset='UNEXPECTED';
  const invalidSchema=adaptArenaProvenance(malformed);
  assert.equal(invalidSchema['H1-B'].fields.market.status,'INVALID');
  assert.equal(invalidSchema['H1-B'].hashes.inputSha256.status,'INVALID');
  assert.equal(invalidSchema['H1-B'].ruleset.status,'INVALID');
  assert.equal(invalidSchema.H9.receipt.status,'UNKNOWN');
});
test('receipt attribution requires the complete unique candidate set and consistent rulesets',()=>{
  const missing=manifest();
  missing.summary.candidates=missing.summary.candidates.filter(candidate=>candidate.id!=='H1-B');
  assert.equal(adaptArenaProvenance(missing)['H1-B'].associationStatus,'UNKNOWN');
  assert.equal(adaptArenaProvenance(missing)['H1-E'].receipt.status,'UNKNOWN');
  const duplicate=manifest();
  duplicate.summary.candidates[1].id='H1-B';
  assert.equal(adaptArenaProvenance(duplicate)['H1-B'].associationStatus,'INVALID');
  assert.equal(adaptArenaProvenance(duplicate)['H1-E'].receipt.status,'UNKNOWN');
  const unexpected=manifest();
  unexpected.summary.candidates[0].id='H1-X';
  assert.equal(adaptArenaProvenance(unexpected)['H1-B'].associationStatus,'INVALID');
  const mismatched=manifest();
  mismatched.summary.ruleset='OTHER_RULESET';
  assert.equal(adaptArenaProvenance(mismatched)['H1-B'].associationStatus,'INVALID');
  assert.equal(adaptArenaProvenance(mismatched)['H1-B'].receipt.status,'UNKNOWN');
  const candidateRule=manifest();
  candidateRule.summary.candidates[0].ruleset='OTHER_RULESET';
  assert.equal(adaptArenaProvenance(candidateRule)['H1-B'].associationStatus,'INVALID');
  const h9=manifest();
  h9.summary.candidates.find(candidate=>candidate.id==='H9').status='AVAILABLE';
  assert.equal(adaptArenaProvenance(h9).H9.blocked,true);
  assert.equal(adaptArenaProvenance(h9)['H1-B'].associationStatus,'INVALID');
});
test('receipt dates and declared day counts must be strict and chronologically consistent',()=>{
  const invalidSeal=manifest();
  invalidSeal.receipt.sealedAt='2026-02-30T20:56:33.176Z';
  const sealData=adaptArenaProvenance(invalidSeal);
  assert.equal(sealData['H1-B'].associationStatus,'INVALID');
  assert.equal(sealData['H1-B'].receipt.status,'UNKNOWN');
  const badOrder=manifest();
  badOrder.summary.window.firstExecution+=DAY;
  assert.equal(adaptArenaProvenance(badOrder)['H1-B'].associationStatus,'INVALID');
  const badScoredCount=manifest();
  badScoredCount.summary.window.bars--;
  assert.equal(adaptArenaProvenance(badScoredCount)['H1-B'].fields.scored.status,'INVALID');
  assert.equal(adaptArenaProvenance(badScoredCount)['H1-B'].associationStatus,'INVALID');
  const badWarmupCount=manifest();
  badWarmupCount.summary.model.warmupBars--;
  assert.equal(adaptArenaProvenance(badWarmupCount)['H1-B'].fields.warmup.status,'INVALID');
  const badDecision=manifest();
  badDecision.summary.window.firstDecision++;
  assert.equal(adaptArenaProvenance(badDecision)['H1-B'].associationStatus,'INVALID');
  const badCollectionOrder=manifest();
  badCollectionOrder.inputTemplate.collection.completedAt='2026-10-16T20:56:20.000Z';
  assert.equal(adaptArenaProvenance(badCollectionOrder)['H1-B'].associationStatus,'INVALID');
});
test('metadata loader fetches only the local manifest and caller text is escaped',async()=>{
  const source=manifest();
  source.receipt.collectorProvider='<img src=x onerror=alert(1)>';
  const html=arenaHtml({provenance:adaptArenaProvenance(source)});
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(arenaHtml({error:'<script>alert(1)</script>'}).includes('&lt;script&gt;'));
  let requests=0;
  const loaded=await loadStoredArenaProvenance(async url=>{
    requests++;
    assert.ok(url.endsWith('/research/results/strategy-arena-20261016/manifest.json'));
    return {ok:true,text:async()=>JSON.stringify(manifest())};
  });
  assert.equal(requests,1);
  assert.equal(loaded['H1-B'].hashes.protocolSha256.status,'PRESENT_UNVERIFIED');
});
