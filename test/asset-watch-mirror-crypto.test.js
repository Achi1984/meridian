import test from 'node:test';
import assert from 'node:assert/strict';
import {assetWatchMirrorKeyHashFromShareToken,assetWatchMirrorPublicReceipt,encryptAssetWatchMirror,decryptAssetWatchMirror} from '../asset-watch-mirror-crypto.js';

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
