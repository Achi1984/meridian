import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchAssetWatchMirror,assetWatchDispatchConfigured} from '../asset-watch-runtime-dispatch.js';

test('runtime mirror dispatch fails closed without secret',async()=>{
  assert.equal(assetWatchDispatchConfigured({}),false);
  const r=await dispatchAssetWatchMirror({env:{},fetchImpl:async()=>{throw new Error('must not call')}});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'missing_dispatch_token');
});

test('runtime mirror dispatch uses secret only in Authorization header and never payload',async()=>{
  let seen;
  const env={MERIDIAN_GITHUB_ASSET_WATCH_TOKEN:'super-secret'};
  const r=await dispatchAssetWatchMirror({
    env,now:()=>1000000,minimumIntervalMs:0,
    fetchImpl:async(url,options)=>{seen={url,options};return {status:204}}
  });
  assert.equal(r.ok,true);
  assert.equal(r.dispatched,true);
  assert.match(seen.url,/Achi1984\/meridian\/actions\/workflows\/asset-watch-mirror\.yml\/dispatches$/);
  assert.equal(seen.options.headers.authorization,'Bearer super-secret');
  assert.doesNotMatch(seen.options.body,/super-secret/);
  assert.deepEqual(JSON.parse(seen.options.body),{ref:'main'});
});

test('runtime mirror dispatch reports GitHub rejection without exposing response body',async()=>{
  const r=await dispatchAssetWatchMirror({
    env:{MERIDIAN_GITHUB_ASSET_WATCH_TOKEN:'secret'},
    now:()=>2000000,minimumIntervalMs:0,
    fetchImpl:async()=>({status:403,text:async()=> 'sensitive upstream body'})
  });
  assert.equal(r.ok,false);
  assert.equal(r.reason,'github_dispatch_http_403');
  assert.doesNotMatch(JSON.stringify(r),/sensitive upstream body|secret/);
});
