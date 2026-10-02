import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {OKX_ACCOUNT_BALANCE_PATH,normalizeOkxApiBase,signOkxReadRequest,okxReadGet} from '../okx-read-client.js';

test('OKX private GET signature matches documented timestamp+method+path HMAC-SHA256 Base64',()=>{
  const ts='2026-10-02T16:40:00.000Z',secret='secret';
  const expected=crypto.createHmac('sha256',secret).update(ts+'GET'+OKX_ACCOUNT_BALANCE_PATH).digest('base64');
  assert.equal(signOkxReadRequest(ts,'GET',OKX_ACCOUNT_BALANCE_PATH,secret),expected);
});

test('OKX API base is https and restricted to documented regional hosts',()=>{
  assert.equal(normalizeOkxApiBase('https://www.okx.com/'),'https://www.okx.com');
  assert.equal(normalizeOkxApiBase('https://eea.okx.com'),'https://eea.okx.com');
  assert.equal(normalizeOkxApiBase('https://us.okx.com'),'https://us.okx.com');
  assert.throws(()=>normalizeOkxApiBase('http://www.okx.com'),/not_allowed/);
  assert.throws(()=>normalizeOkxApiBase('https://evil.example'),/not_allowed/);
});

test('OKX read client only permits GET account balance and emits required auth headers',async()=>{
  let seen=null;
  const fetchImpl=async(url,opts)=>{
    seen={url,opts};
    return {ok:true,status:200,text:async()=>JSON.stringify({code:'0',msg:'',data:[{totalEq:'123.45',details:[]}]})};
  };
  const now=()=>Date.parse('2026-10-02T16:40:00.000Z');
  const j=await okxReadGet(OKX_ACCOUNT_BALANCE_PATH,{apiKey:'key',apiSecret:'secret',passphrase:'pass',apiBase:'https://eea.okx.com',fetchImpl,now});
  assert.equal(j.code,'0');
  assert.equal(seen.url,'https://eea.okx.com'+OKX_ACCOUNT_BALANCE_PATH);
  assert.equal(seen.opts.method,'GET');
  assert.equal(seen.opts.headers['OK-ACCESS-KEY'],'key');
  assert.equal(seen.opts.headers['OK-ACCESS-PASSPHRASE'],'pass');
  assert.equal(seen.opts.headers['OK-ACCESS-TIMESTAMP'],'2026-10-02T16:40:00.000Z');
  assert.equal(seen.opts.headers['OK-ACCESS-SIGN'],signOkxReadRequest('2026-10-02T16:40:00.000Z','GET',OKX_ACCOUNT_BALANCE_PATH,'secret'));
  await assert.rejects(()=>okxReadGet('/api/v5/trade/order',{apiKey:'k',apiSecret:'s',passphrase:'p',fetchImpl,now}),/endpoint_not_allowed/);
});

test('OKX read client fails closed on API and JSON errors',async()=>{
  const base={apiKey:'k',apiSecret:'s',passphrase:'p',now:()=>0};
  await assert.rejects(()=>okxReadGet(OKX_ACCOUNT_BALANCE_PATH,{...base,fetchImpl:async()=>({ok:true,status:200,text:async()=>'{bad'})}),/invalid_json/);
  await assert.rejects(()=>okxReadGet(OKX_ACCOUNT_BALANCE_PATH,{...base,fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({code:'50102',msg:'Timestamp request expired',data:[]})})}),/okx_read_api_50102/);
});
