// Retained historical evidence only: no network, new trial, or promotion.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {loadStoredArena} from '../v10/strategy-arena.js';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const root='research/results/strategy-arena-20261016/';

test('retained diagnostic table matches sealed-input replay and pinned headline metrics',async()=>{
  const {result,digest}=await loadStoredArena(async url=>({ok:true,text:async()=>fs.readFileSync(new URL(url),'utf8')}),webcrypto.subtle);
  assert.equal(digest,'decf35415605bda739d08e9ac489951c21f5428d6b5f6362bd6e77abf265c473');
  const expected=[
    ['H1-B',12.61,12.50,12.65,1],['H1-E',12.61,12.50,12.65,1],
    ['H7-B',19.84,19.55,10.70,11],['H7-R',11.88,11.75,8.53,12],
    ['Equal-sleeve buy & hold',20.06,19.97,33.86,0],['Cash',0,0,0,0]
  ];
  const document=read('docs/strategy-lab/PAPER_ARENA_DIAGNOSTIC_20261016.md');
  const table=document.split('\n').filter(line=>line.startsWith('| ')).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
  const models=[...result.candidates.filter(row=>row.id!=='H9'),result.controls.buyAndHold,result.controls.cash];
  for(let i=0;i<expected.length;i++){
    const [name,...values]=expected[i],model=models[i];
    const computed=[model.baseline.netReturnPct,model.stress.netReturnPct,model.baseline.maxDrawdownPct].map(x=>Number(x.toFixed(2)));
    computed.push(model.baseline.closedTrades);
    assert.deepEqual(computed,values,name+' replay regression');
    const rows=table.filter(row=>row[0]===name);assert.equal(rows.length,1,name+' must occur once');
    assert.deepEqual(rows[0].slice(1).map(cell=>Number(cell.replace('%',''))),values,name+' published table is stale');
  }
  const blocked=result.candidates.find(row=>row.id==='H9');
  assert.equal(blocked.status,'BLOCKED_DATA');assert.equal(blocked.baseline,undefined);
  assert.equal(result.validation,'UNPROVEN');assert.equal(result.liveAuthorized,false);
});

test('retained raw USD source hashes and all normalized candles agree without new collection',()=>{
  const manifest=JSON.parse(read(root+'manifest.json')),collection=manifest.inputTemplate.collection;
  assert.equal(hash(read(manifest.receipt.engineFile)),manifest.receipt.engineSha256);
  assert.equal(hash(read(manifest.receipt.protocolFile)),manifest.receipt.protocolSha256);
  assert.equal(hash(collection.instrumentMetadata.body),collection.instrumentMetadata.sha256);
  const metadata=JSON.parse(collection.instrumentMetadata.body);assert.deepEqual(metadata.error,[]);
  const day=86400000,asOf=manifest.inputTemplate.asOf;
  // These establish internal consistency of recorded times, not external timestamp authenticity.
  assert.ok(Date.parse(collection.collectedAt)<=Date.parse(collection.completedAt));
  assert.ok(Date.parse(collection.completedAt)<=Date.parse(manifest.receipt.sealedAt));
  for(const entry of manifest.chunks){
    const text=read(root+entry.path);assert.equal(hash(text),entry.sha256,entry.symbol+' chunk');
    const chunk=JSON.parse(text),raw=chunk.rawResponse,instrument=collection.instruments[entry.symbol];
    assert.equal(hash(raw.body),raw.sha256,entry.symbol+' raw response');
    const pair=metadata.result[instrument.resultKey];assert.equal(pair.quote,'ZUSD');assert.equal(pair.status,'online');
    for(const key of ['base','quote','altname','wsname','status'])assert.equal(pair[key],instrument[key]);
    const body=JSON.parse(raw.body);assert.deepEqual(body.error,[]);
    const rows=body.result[instrument.resultKey];assert.equal(rows.length,raw.returnedRows);
    const closed=rows.filter(row=>Number(row[0])*1000+day-1<asOf),unclosed=rows.filter(row=>Number(row[0])*1000+day-1>=asOf);
    assert.equal(unclosed.length,1);assert.equal(Number(unclosed[0][0])*1000,raw.excludedUnclosed.openTime);
    assert.equal(closed.length-chunk.rows.length,raw.trimmedOlderCount);
    const normalized=closed.slice(-400).map(row=>({openTime:Number(row[0])*1000,closeTime:Number(row[0])*1000+day-1,open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4])}));
    assert.equal(normalized.length,400);assert.deepEqual(normalized,chunk.rows,entry.symbol+' normalization');
    assert.equal(normalized.at(-1).closeTime,collection.eventTimeCutoff);
  }
});
