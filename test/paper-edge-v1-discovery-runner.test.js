import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDiscoveryStage,fiveWindows,profitFactor,verifyLockedSource,EDGE_V1_DISCOVERY_SOURCE_LOCK} from '../research/paper-edge-v1-discovery-runner.js';
import {EDGE_V1_SOURCE} from '../research/paper-edge-v1-data-contract.js';

test('Discovery stage lock cannot silently enable later stages',()=>assert.equal(assertDiscoveryStage(),true));
test('profit factor is closed-trade net profit over absolute net loss',()=>assert.equal(profitFactor([{netPnlBaseline:2},{netPnlBaseline:1},{netPnlBaseline:-1}]),3));
test('five chronological windows partition timestamps without overlap',()=>assert.deepEqual(fiveWindows([0,1,2,3,4,5,6,7,8,9]),[{from:0,to:1},{from:2,to:3},{from:4,to:5},{from:6,to:7},{from:8,to:9}]));
test('source package must match immutable canonical receipt, not only shape',()=>{
 const t=Date.parse(EDGE_V1_SOURCE.start),bar={openTime:t,closeTime:t+EDGE_V1_SOURCE.intervalMs-1,open:1,high:1,low:1,close:1,volume:1},fund={time:t+2,rate:0};
 const pkg={schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',researchOnly:true,executionImpact:false,provenance:{paginationComplete:true,fundingComplete:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,true]))},barsBySymbol:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,[bar]])),fundingBySymbol:Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>[s,[fund]])),receipt:{digest:EDGE_V1_DISCOVERY_SOURCE_LOCK.receiptDigest}};
 assert.throws(()=>verifyLockedSource(pkg),/EDGE_V1_SOURCE_DIGEST_MISMATCH/);
});
