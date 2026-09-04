import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRuntimePrices } from '../portfolio-history-runtime.js';

test('runtime prices normalize wrapped asset exposure without mutating quantities',()=>{
  const data={livePrices:{},portfolio:{holdings:[{symbol:'OKSOL',quantity:3,venue:'OKX'},{symbol:'BETH',quantity:2,venue:'OKX'},{symbol:'BTC',quantity:1,venue:'Ledger'}]}};
  const out=mergeRuntimePrices(data,{SOL:20,ETH:30,BTC:100});
  assert.equal(out.livePrices.OKSOL.price,20);
  assert.equal(out.livePrices.BETH.price,30);
  assert.equal(out.livePrices.BTC.price,100);
  assert.equal(data.livePrices.OKSOL,undefined);
});
