import test from 'node:test';
import assert from 'node:assert/strict';
const DAY=86400000;
async function run(x){const {evaluateTrendPullback}=await import('../docs/strategy-lab/trend-pullback.mjs');return evaluateTrendPullback(x);}
function fixture(){const start=Date.UTC(2024,0,1);const bars=Array.from({length:201},(_,i)=>({openTimeMs:start+i*DAY,closeTimeMs:start+(i+1)*DAY,availableAtMs:start+(i+1)*DAY+1000,open:100,high:i>=190?110:101,low:i>=190?90:99,close:i===199?92:i===200?104:100,volume:10}));return {bars,asOfMs:bars[200].availableAtMs,position:null};}
test('crossing creates candidate only after receipt; input unchanged',async()=>{const x=fixture(),before=JSON.stringify(x),r=await run(x);assert.equal(r.action,'ENTER_LONG_CANDIDATE');assert.equal(r.currentR,-30);assert.equal(r.previousR,-90);assert.equal(r.executionAuthorized,false);assert.equal(JSON.stringify(x),before);assert.equal(r.signalAvailableAtMs,x.asOfMs);});
test('jump directly into exit region prevents entry',async()=>{const x=fixture();x.bars[200].close=108;assert.equal((await run(x)).action,'NONE');});
test('existing position exits before any new entry',async()=>{const x=fixture();x.position={entryAtMs:x.bars[199].closeTimeMs+1000};x.bars[200].close=108;assert.equal((await run(x)).action,'EXIT_LONG');});
test('holding period counts closes strictly after fill',async()=>{const x=fixture();x.position={entryAtMs:x.bars[190].closeTimeMs};assert.equal((await run(x)).heldBars,10);assert.ok((await run(x)).reasons.includes('TIME_EXIT'));x.position.entryAtMs=x.bars[191].closeTimeMs;assert.equal((await run(x)).action,'HOLD_LONG');});
test('trend failure exits',async()=>{const x=fixture();x.position={entryAtMs:x.bars[199].closeTimeMs};x.bars[200].close=95;assert.ok((await run(x)).reasons.includes('TREND_EXIT'));});
test('future receipt and incomplete candle rejected',async()=>{const x=fixture();x.asOfMs=x.bars[200].closeTimeMs-1;assert.equal((await run(x)).valid,false);});
test('gaps and duplicates rejected',async()=>{for(const delta of [-DAY,DAY]){const x=fixture();x.bars[100].openTimeMs+=delta;x.bars[100].closeTimeMs+=delta;x.bars[100].availableAtMs+=delta;assert.equal((await run(x)).valid,false);}});
test('stale window rejected at next daily boundary',async()=>{const x=fixture();x.asOfMs=x.bars[200].closeTimeMs+DAY;assert.equal((await run(x)).error,'STALE_WINDOW');});
test('zero range produces no entry',async()=>{const x=fixture();for(const b of x.bars){b.open=b.high=b.low=b.close=100;}assert.equal((await run(x)).action,'NONE');assert.equal((await run(x)).currentR,null);});
test('nonfinite prices and malformed state rejected',async()=>{const x=fixture();x.bars[2].high=Infinity;assert.equal((await run(x)).valid,false);const y=fixture();y.position={entryAtMs:y.asOfMs+1};assert.equal((await run(y)).valid,false);});
test('boundary -80 does not enter',async()=>{const x=fixture();x.bars[200].close=94;assert.equal((await run(x)).action,'NONE');});
test('an extra future bar is not silently sliced away',async()=>{const x=fixture();x.bars.push({...x.bars[200]});assert.equal((await run(x)).valid,false);});

test('fractional constant market does not invent a trend exit',async()=>{const x=fixture();for(const b of x.bars){b.open=b.high=b.low=b.close=100.1;}x.position={entryAtMs:x.bars[199].closeTimeMs};const r=await run(x);assert.equal(r.sma200,100.1);assert.equal(r.action,'HOLD_LONG');});
