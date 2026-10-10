import test from 'node:test';import assert from 'node:assert/strict';import {NEXT_RANGE_V1,nextRangeDecision} from '../research/btc-next-range-v1.js';
test('NEXT RANGE is research only and has staged reload',()=>{assert.equal(NEXT_RANGE_V1.reloadTranches.reduce((a,b)=>a+b,0),1)});
test('insufficient history cannot signal',()=>{assert.equal(nextRangeDecision({h4:[],d1:[]}).status,'NO_DATA')});
