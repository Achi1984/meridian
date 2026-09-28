import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalPionexQuery,signPionexReadGet,pionexReadGet} from '../pionex-read-client.js';
import {
  normalizeSpotBalances,normalizeFuturesBalances,normalizeFuturesPositions,
  fetchPionexReadSnapshot,readCredentials,mergePionexAccountState
} from '../pionex-account-read-sync.js';

test('shared Pionex read signer matches canonical GET contract',()=>{
  assert.equal(canonicalPionexQuery({timestamp:1700000000000,status:'running'}),'status=running&timestamp=1700000000000');
  assert.equal(canonicalPionexQuery({pageToken:'a/b=',timestamp:1},false),'pageToken=a/b=&timestamp=1');
  assert.equal(
    signPionexReadGet('/api/v1/bot/orders',{timestamp:1700000000000,status:'running'},'test-secret'),
    'a66fc134b331daa12ffc2f2a4cea1984adcc1729b3e53a8184883cff5f4ac6f2'
  );
});

test('read client sends only signed GET requests',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data:{balances:[]}})};
  };
  await pionexReadGet('/api/v1/account/balances',{},{
    apiKey:'read-key',apiSecret:'read-secret',fetchImpl,now:()=>1700000000000
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
  assert.match(calls[0].url,/\/api\/v1\/account\/balances\?timestamp=1700000000000/);
  assert.equal(calls[0].options.headers['PIONEX-KEY'],'read-key');
  assert.ok(calls[0].options.headers['PIONEX-SIGNATURE']);
});

test('read snapshot normalizes spot, futures balances and active positions without inventing values',async()=>{
  const fetchImpl=async url=>{
    let data={};
    if(url.includes('/api/v1/account/balances'))data={balances:[{coin:'BTC',free:'0.1',frozen:'0'}]};
    else if(url.includes('/uapi/v1/account/balances'))data={balances:[{coin:'USDT',free:'10',frozen:'2',debts:'0'}],isolates:[]};
    else if(url.includes('/uapi/v1/account/positions'))data={positions:[{positionId:'p1',symbol:'BTC_USDT_PERP',positionSide:'LONG',netSize:'0.01',avgPrice:'80000',unrealizedPnL:'12.5',markPrice:'81250',liquidationPrice:'60000',leverage:'5'}]};
    return {ok:true,status:200,text:async()=>JSON.stringify({result:true,data})};
  };
  const snap=await fetchPionexReadSnapshot({
    apiKey:'read-key',apiSecret:'read-secret',fetchImpl,now:()=>1700000000000
  });
  assert.equal(snap.readOnly,true);
  assert.equal(snap.spotBalanceCount,1);
  assert.equal(snap.futuresBalanceCount,1);
  assert.equal(snap.futuresPositionCount,1);
  assert.equal(snap.spotBalances[0].free,0.1);
  assert.equal(snap.futuresPositions[0].side,'LONG');
  assert.equal(snap.futuresPositions[0].liquidationPrice,60000);
});

test('normalizers preserve missing values as null',()=>{
  assert.equal(normalizeSpotBalances({balances:[{coin:'ETH'}]})[0].free,null);
  assert.equal(normalizeFuturesBalances({balances:[{coin:'USDT'}]}).balances[0].debts,null);
  assert.equal(normalizeFuturesPositions({positions:[{symbol:'ETH_USDT_PERP',positionSide:'SHORT'}]})[0].avgPrice,null);
});

test('credential resolver accepts dedicated read credentials and generic read fallback',()=>{
  assert.equal(readCredentials({PIONEX_READ_API_KEY:'k',PIONEX_READ_API_SECRET:'s'}).ok,true);
  assert.equal(readCredentials({PIONEX_API_KEY:'k',PIONEX_API_SECRET:'s'}).ok,true);
  assert.equal(readCredentials({PIONEX_READ_API_KEY:'k'}).ok,false);
});

test('failed account read diagnostics do not refresh the previous snapshot',()=>{
  const current={privateRevision:7,pionexAccount:{updatedAt:'old',futuresPositions:[{positionId:'old'}]},pionexAccountSync:{lastSuccessAt:'old'}};
  const next=mergePionexAccountState(current,{status:'ERROR',error:'boom',attemptAt:'2026-09-28T12:00:00Z',configured:true});
  assert.equal(next.pionexAccount.updatedAt,'old');
  assert.deepEqual(next.pionexAccount.futuresPositions,[{positionId:'old'}]);
  assert.equal(next.pionexAccountSync.status,'ERROR');
  assert.equal(next.privateRevision,8);
});

test('Pionex account runtime contains no mutation HTTP paths',()=>{
  const client=fs.readFileSync(new URL('../pionex-read-client.js',import.meta.url),'utf8');
  const sync=fs.readFileSync(new URL('../pionex-account-read-sync.js',import.meta.url),'utf8');
  assert.match(sync,/\/api\/v1\/account\/balances/);
  assert.match(sync,/\/uapi\/v1\/account\/balances/);
  assert.match(sync,/\/uapi\/v1\/account\/positions/);
  assert.doesNotMatch(client,/method:'POST'|method:'DELETE'|method:'PUT'|method:'PATCH'/);
  assert.doesNotMatch(sync,/trade\/order|assets\/transfer|account\/leverage.*post|isolatedMode.*post/);
});
