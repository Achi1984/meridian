import assert from 'node:assert/strict';
import test from 'node:test';
import {displayedPositionSize} from '../v11/depot-read-bootstrap.js';
import {createLedgerManualClient} from '../v11/ledger-manual-client.js';

test('selects one-way or hedge size and supports earlier snapshots',()=>{
  assert.equal(displayedPositionSize({side:'LONG',sizeLong:2,netSize:0}),2);
  assert.equal(displayedPositionSize({side:'SHORT',positionSide:'BOTH',sizeShort:0,netSize:-3}),3);
  assert.equal(displayedPositionSize({side:'SHORT',positionSide:'SHORT',sizeShort:2,netSize:0}),2);
});

test('renews visible Ledger prices twice and cancels the timer on lock',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.UTC(2026,10,28)});
  let reads=0;
  const snapshot={source:'USER_MANUAL_SNAPSHOT',observedAt:new Date().toISOString(),holdings:[{symbol:'BTC',quantity:'1'}]};
  const payload={private:true,data:{privateRevision:1,portfolio:{ledgerManualSnapshot:snapshot}}};
  const client=createLedgerManualClient({getToken:()=>'test',shouldRenew:()=>true,
    fetchImpl:async url=>new Response(JSON.stringify(url.includes('ticker/price')?
      [{symbol:'BTCUSDT',price:String(++reads)}]:payload))});
  try{
    await client.load(payload);
    assert.equal(reads,1);
    for(const expected of [2,3]){
      t.mock.timers.tick(180001);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(reads,expected);
    }
    client.lock();
    t.mock.timers.tick(180001);
    assert.equal(reads,3);
  }finally{client.dispose();}
});
