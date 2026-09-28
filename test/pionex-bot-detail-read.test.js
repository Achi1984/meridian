import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIONEX_FUTURES_GRID_DETAIL_PATH,
  PIONEX_SUPPORTED_BOT_TYPES,
  mergePionexOrderDetail,
  hydratePionexBotSummaries
} from '../pionex-bot-detail-read.js';

test('detail helper is explicitly scoped to supported futures-grid reads',()=>{
  assert.equal(PIONEX_FUTURES_GRID_DETAIL_PATH,'/api/v1/bot/orders/futuresGrid/order');
  assert.deepEqual(PIONEX_SUPPORTED_BOT_TYPES,['futures_grid','future_hedge_grid']);
});

test('empty list metadata can be hydrated with the detail payload',async()=>{
  const list=[{
    buOrderType:'futures_grid',
    buOrderId:'bot-1',
    base:'BTC.PERP',
    quote:'BTC',
    status:'running',
    buOrderData:{}
  }];
  const seen=[];
  const result=await hydratePionexBotSummaries(list,{
    delayMs:0,
    loadDetail:async id=>{
      seen.push(id);
      return {
        buOrderId:id,
        status:'running',
        buOrderData:{
          status:'running',trend:'long',leverage:'7',bottom:'55000',top:'100000',
          liquidationPrice:'62001.6',position:'0.03',positionOpenPrice:'85900'
        }
      };
    },
    validateDetail:row=>row.buOrderData?.trend==='long'&&Number(row.buOrderData?.leverage)===7
  });
  assert.deepEqual(seen,['bot-1']);
  assert.equal(result.listRows,1);
  assert.equal(result.supportedRows,1);
  assert.equal(result.detailRows,1);
  assert.equal(result.detailsComplete,true);
  assert.equal(result.orders[0].buOrderType,'futures_grid');
  assert.equal(result.orders[0].base,'BTC.PERP');
  assert.equal(result.orders[0].buOrderData.liquidationPrice,'62001.6');
});

test('direct detail data is merged into buOrderData without losing list identity',()=>{
  const merged=mergePionexOrderDetail(
    {buOrderType:'future_hedge_grid',buOrderId:'hedge-1',base:'ETH.PERP',quote:'ETH',status:'running',buOrderData:{}},
    {status:'running',trend:'short',leverage:'4',bottom:'1500',top:'3500'}
  );
  assert.equal(merged.buOrderId,'hedge-1');
  assert.equal(merged.buOrderType,'future_hedge_grid');
  assert.equal(merged.base,'ETH.PERP');
  assert.equal(merged.buOrderData.trend,'short');
});

test('detail hydration fails closed on missing, duplicate, mismatched or incomplete rows',async()=>{
  await assert.rejects(
    hydratePionexBotSummaries([{buOrderType:'futures_grid',status:'running'}],{delayMs:0,loadDetail:async()=>({})}),
    /pionex_bot_detail_missing_id/
  );

  const dup=[
    {buOrderType:'futures_grid',buOrderId:'same',status:'running'},
    {buOrderType:'futures_grid',buOrderId:'same',status:'running'}
  ];
  await assert.rejects(
    hydratePionexBotSummaries(dup,{delayMs:0,loadDetail:async()=>({status:'running',trend:'long'})}),
    /pionex_bot_detail_duplicate_id/
  );

  assert.throws(
    ()=>mergePionexOrderDetail(
      {buOrderType:'futures_grid',buOrderId:'expected',status:'running'},
      {buOrderId:'other',buOrderData:{status:'running',trend:'long'}}
    ),
    /pionex_bot_detail_id_mismatch/
  );

  await assert.rejects(
    hydratePionexBotSummaries(
      [{buOrderType:'futures_grid',buOrderId:'bot-2',status:'running'}],
      {delayMs:0,loadDetail:async()=>({status:'running'}),validateDetail:()=>false}
    ),
    /pionex_bot_detail_incomplete/
  );
});


test('detail hydration accepts surrounding whitespace on documented type/status enums',async()=>{
  const result=await hydratePionexBotSummaries(
    [{buOrderType:' futures_grid ',buOrderId:'trim-1',base:'BTC.PERP',status:' running '}],
    {delayMs:0,loadDetail:async()=>({status:' running ',trend:' long '}),validateDetail:()=>true}
  );
  assert.equal(result.supportedRows,1);
  assert.equal(result.detailRows,1);
});

test('unsupported bot types are ignored instead of being hydrated',async()=>{
  let calls=0;
  const result=await hydratePionexBotSummaries(
    [{buOrderType:'spot_grid',buOrderId:'spot-1',status:'running'}],
    {delayMs:0,loadDetail:async()=>{calls++;return {}}}
  );
  assert.equal(calls,0);
  assert.equal(result.listRows,1);
  assert.equal(result.supportedRows,0);
  assert.equal(result.detailRows,0);
  assert.equal(result.detailsComplete,true);
});
