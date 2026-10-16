import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBinanceDaily} from '../docs/strategy-lab/normalize-binance-daily.mjs';
const day=86400000;
function fixture(unit='ms',start=Date.UTC(2024,0,1)) {const scale=unit==='us'?1000n:1n;const open=BigInt(start)*scale;return{timestampUnit:unit,rows:[[String(open),'10','12','9','11','100',String(open+BigInt(day)*scale-1n),'1100','3','50','500','0']],availableAtMs:[start+day+1000],asOfMs:start+day+2000};}
const reject=x=>{const r=normalizeBinanceDaily(x);assert.equal(r.valid,false);assert.deepEqual(r.bars,[]);assert.ok(r.errors.length);assert.equal(r.executionAuthorized,false);};
test('millisecond archive yields exclusive closed daily bar and explicit receipt',()=>{const x=fixture();const r=normalizeBinanceDaily(x);assert.equal(r.valid,true);assert.equal(r.bars[0].closeTimeMs,Date.UTC(2024,0,2));assert.equal(r.bars[0].availableAtMs,x.availableAtMs[0]);assert.equal(r.bars[0].close,11);assert.equal(r.executionAuthorized,false);});
test('microsecond regime converts without losing inclusive-end precision',()=>{const r=normalizeBinanceDaily(fixture('us',Date.UTC(2025,0,1)));assert.equal(r.valid,true);assert.equal(r.bars[0].closeTimeMs,Date.UTC(2025,0,2));});
test('wrong declared units or wrong regime rejects',()=>{const x=fixture();x.timestampUnit='us';reject(x);reject(fixture('ms',Date.UTC(2025,0,1)));});
test('future or premature availability rejects instead of inventing bar-close receipt',()=>{for(const delta of [-1,3000]){const x=fixture();x.availableAtMs[0]=Date.UTC(2024,0,2)+delta;reject(x);}});
test('duplicate and missing-day sequences reject',()=>{for(const shift of [0,2]){const x=fixture();x.rows.push(fixture('ms',Date.UTC(2024,0,1)+shift*day).rows[0]);x.availableAtMs.push(Date.UTC(2024,0,1)+(shift+1)*day+1000);x.asOfMs=Date.UTC(2024,0,5);reject(x);}});
test('malformed OHLCV and timestamp newline reject',()=>{for(const [index,value] of [[1,'0'],[2,'8'],[3,'13'],[4,'NaN'],[5,'-1'],[0,'1704067200000\n'],[6,'1704153599998']]){const x=fixture();x.rows[0][index]=value;reject(x);}});
test('unknown fields, empty batch and wrong row width reject',()=>{reject({...fixture(),extra:1});reject({...fixture(),rows:[],availableAtMs:[]});const x=fixture();x.rows[0].pop();reject(x);});
test('contiguous two-day series passes without mutating inputs',()=>{const x=fixture();x.rows.push(fixture('ms',Date.UTC(2024,0,2)).rows[0]);x.availableAtMs.push(Date.UTC(2024,0,3)+1000);x.asOfMs=Date.UTC(2024,0,3)+2000;const before=structuredClone(x);const r=normalizeBinanceDaily(x);assert.equal(r.valid,true);assert.equal(r.bars.length,2);assert.deepEqual(x,before);});
