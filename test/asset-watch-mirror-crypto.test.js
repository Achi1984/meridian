import test from 'node:test';
import assert from 'node:assert/strict';
import {assetWatchMirrorKeyHashFromShareToken,encryptAssetWatchMirror,decryptAssetWatchMirror} from '../asset-watch-mirror-crypto.js';

test('encrypted mirror round-trips with the scoped Asset Watch share token',()=>{
  const token='share-token-example';
  const hash=assetWatchMirrorKeyHashFromShareToken(token);
  const snapshot={schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',readOnly:true,executionImpact:false,bots:[{symbol:'HBAR'}]};
  const envelope=encryptAssetWatchMirror(snapshot,hash,{iv:Buffer.alloc(12,7),now:'2026-09-29T04:30:00Z'});
  assert.equal(envelope.schemaVersion,'MERIDIAN-ASSET-WATCH-MIRROR-V1');
  assert.equal(envelope.alg,'A256GCM');
  assert.doesNotMatch(JSON.stringify(envelope),/HBAR/);
  assert.deepEqual(decryptAssetWatchMirror(envelope,token),snapshot);
});

test('wrong share token cannot decrypt the mirror',()=>{
  const hash=assetWatchMirrorKeyHashFromShareToken('correct');
  const envelope=encryptAssetWatchMirror({secret:'snapshot'},hash,{iv:Buffer.alloc(12,3)});
  assert.throws(()=>decryptAssetWatchMirror(envelope,'wrong'));
});
