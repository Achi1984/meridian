import test from 'node:test';
import assert from 'node:assert/strict';
import {assetWatchMirrorKeyHashFromShareToken,assetWatchMirrorPublicReceipt,validateAssetWatchMirrorEnvelope,encryptAssetWatchMirror,decryptAssetWatchMirror} from '../asset-watch-mirror-crypto.js';

test('encrypted mirror round-trips with the scoped Asset Watch share token',()=>{
  const token='share-token-example';
  const hash=assetWatchMirrorKeyHashFromShareToken(token);
  const snapshot={
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-09-29T04:29:00Z',sourceAgeMs:60000,freshnessLimitMs:900000,
    bots:[{symbol:'HBAR'}]
  };
  const envelope=encryptAssetWatchMirror(snapshot,hash,{iv:Buffer.alloc(12,7),now:'2026-09-29T04:30:00Z'});
  assert.equal(envelope.schemaVersion,'MERIDIAN-ASSET-WATCH-MIRROR-V1');
  assert.equal(envelope.alg,'A256GCM');
  assert.equal(envelope.receipt.schemaVersion,'MERIDIAN-ASSET-WATCH-MIRROR-RECEIPT-V1');
  assert.equal(envelope.receipt.usableForOverwrite,true);
  assert.equal(envelope.receipt.sourceSnapshotAt,'2026-09-29T04:29:00Z');
  assert.doesNotMatch(JSON.stringify(envelope.receipt),/HBAR/);
  assert.doesNotMatch(envelope.ciphertext,/HBAR/);
  assert.deepEqual(decryptAssetWatchMirror(envelope,token),snapshot);
});

test('public receipt exposes strict-live validity without bot details',()=>{
  const receipt=assetWatchMirrorPublicReceipt({
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:false,sourceStatusOk:true,fresh:false,usableForOverwrite:false,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-09-29T04:00:00Z',sourceAgeMs:1800000,freshnessLimitMs:900000,
    bots:[{symbol:'BTCUSDT',botRef:'secret-ref'}]
  });
  assert.deepEqual(receipt,{
    schemaVersion:'MERIDIAN-ASSET-WATCH-MIRROR-RECEIPT-V1',
    bridgeSchemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:false,sourceStatusOk:true,fresh:false,usableForOverwrite:false,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-09-29T04:00:00Z',sourceAgeMs:1800000,freshnessLimitMs:900000
  });
  assert.doesNotMatch(JSON.stringify(receipt),/BTCUSDT|secret-ref/);
});

test('wrong share token cannot decrypt the mirror',()=>{
  const hash=assetWatchMirrorKeyHashFromShareToken('correct');
  const envelope=encryptAssetWatchMirror({secret:'snapshot'},hash,{iv:Buffer.alloc(12,3)});
  assert.throws(()=>decryptAssetWatchMirror(envelope,'wrong'));
});


test('strict-live validator accepts a fresh internally consistent envelope',()=>{
  const hash=assetWatchMirrorKeyHashFromShareToken('validator');
  const envelope=encryptAssetWatchMirror({
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-10-02T07:29:00Z',sourceAgeMs:60000,freshnessLimitMs:900000
  },hash,{iv:Buffer.alloc(12,5),now:'2026-10-02T07:30:00Z'});
  assert.deepEqual(validateAssetWatchMirrorEnvelope(envelope,{nowMs:Date.parse('2026-10-02T07:30:10Z')}),{
    ok:true,ageMs:60000,reportedAgeMs:60000,limitMs:900000,policyMax:900000
  });
});

test('strict-live validator rejects future-dated source snapshots',()=>{
  const hash=assetWatchMirrorKeyHashFromShareToken('validator');
  const envelope=encryptAssetWatchMirror({
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-10-02T07:31:00Z',sourceAgeMs:0,freshnessLimitMs:900000
  },hash,{iv:Buffer.alloc(12,6),now:'2026-10-02T07:30:00Z'});
  assert.equal(validateAssetWatchMirrorEnvelope(envelope,{nowMs:Date.parse('2026-10-02T07:30:10Z')}).reason,'source_timestamp_in_future');
});

test('strict-live validator rejects freshness-policy inflation',()=>{
  const hash=assetWatchMirrorKeyHashFromShareToken('validator');
  const envelope=encryptAssetWatchMirror({
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,executionImpact:false,detailsComplete:true,sourceStatusOk:true,fresh:true,usableForOverwrite:true,
    source:'PIONEX_BOT_API',sourceSnapshotAt:'2026-10-02T07:00:00Z',sourceAgeMs:1800000,freshnessLimitMs:3600000
  },hash,{iv:Buffer.alloc(12,8),now:'2026-10-02T07:30:00Z'});
  assert.equal(validateAssetWatchMirrorEnvelope(envelope,{nowMs:Date.parse('2026-10-02T07:30:10Z')}).reason,'freshness_limit_exceeds_policy');
});
