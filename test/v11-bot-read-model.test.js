import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBotReadModel} from '../v11/bot-read-model.js';
const now = Date.parse('2026-10-12T20:00:00Z');
const fixture = () => ({schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
  source:'PIONEX_WALLET_BOT_DETAIL',sourceSnapshotAt:'2026-10-12T19:59:00Z',
  freshnessLimitMs:900000,readOnly:true,executionImpact:false,detailsComplete:true,
  sourceStatusOk:true,fresh:true,usableForOverwrite:true,botCount:1,
  bots:[{botRef:'a'.repeat(20),symbol:'BTC',side:'SHORT',cateType:'inverse',
    botType:'futures_grid',sideSource:'economic_inverse_asset',apiKey:'SECRET'}]});
test('fresh projection preserves explicit inverse side and drops arbitrary fields',()=>{
  const input=fixture(),before=structuredClone(input),out=buildBotReadModel(input,{now});
  assert.equal(out.status,'FRESH_SNAPSHOT');assert.equal(out.ageMs,60000);
  assert.equal(out.bots[0].side,'SHORT');assert.equal(out.bots[0].category,'inverse');
  assert.equal(out.executionAllowed,false);assert.equal(out.readOnly,true);
  assert.doesNotMatch(JSON.stringify(out),/SECRET|apiKey/);assert.deepEqual(input,before);
});
test('freshness is recomputed and stale rows are withheld despite asserted flags',()=>{
  const input=fixture();input.sourceAgeMs=0;
  const out=buildBotReadModel(input,{now:now+900000});
  assert.equal(out.status,'STALE');assert.deepEqual(out.bots,[]);
  input.sourceSnapshotAt='2026-10-12T20:01:00Z';
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
});
test('invalid envelope, bounds, completeness and duplicates fail closed',()=>{
  for(const [key,value] of [['schemaVersion','bad'],['source','SECRET'],['readOnly',false],
    ['executionImpact',true],['detailsComplete',false],['sourceStatusOk',false],['fresh',false],
    ['usableForOverwrite',false],['freshnessLimitMs',Infinity],['freshnessLimitMs',900001],
    ['freshnessLimitMs',0],['sourceSnapshotAt',null],['botCount',2],['bots',null]]){
    const input=fixture();input[key]=value;
    assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN',key);
  }
  const input=fixture();input.bots.push({...input.bots[0]});input.botCount=2;
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
  input.bots=Array(101).fill(input.bots[0]);input.botCount=101;
  assert.equal(buildBotReadModel(input,{now}).status,'UNKNOWN');
});
test('unsupported provenance remains unknown and cannot infer type from symbol',()=>{
  const input=fixture();Object.assign(input.bots[0],{side:'SECRET',cateType:null,botType:'SECRET',sideSource:{}});
  const out=buildBotReadModel(input,{now});
  assert.equal(out.status,'FRESH_SNAPSHOT');
  for(const key of ['side','category','type','sideSource'])assert.equal(out.bots[0][key],null);
  assert.doesNotMatch(JSON.stringify(out),/SECRET/);
});
test('malformed identities and symbols fail closed without partial rows',()=>{
  for(const [key,value] of [['botRef','SECRET'],['symbol','<script>'],['symbol','A'.repeat(33)]]){
    const input=fixture();input.bots[0][key]=value;
    const out=buildBotReadModel(input,{now});assert.equal(out.status,'UNKNOWN');assert.deepEqual(out.bots,[]);
  }
});
test('calendar normalization cannot make an invalid timestamp fresh',()=>{
  for(const [stamp,clock] of [['2026-02-30T19:59:00Z','2026-03-02T20:00:00Z'],
    ['2026-04-31T19:59:00.000Z','2026-05-01T20:00:00Z'],
    ['2026-10-11T24:00:00Z','2026-10-12T00:01:00Z']]){
    const input=fixture();input.sourceSnapshotAt=stamp;
    assert.equal(buildBotReadModel(input,{now:Date.parse(clock)}).status,'UNKNOWN');
  }
  const input=fixture();input.sourceSnapshotAt='2028-02-29T19:59:00.123Z';
  assert.equal(buildBotReadModel(input,{now:Date.parse('2028-02-29T20:00:00Z')}).status,'FRESH_SNAPSHOT');
});
