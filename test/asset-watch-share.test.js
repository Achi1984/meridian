import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashAssetWatchShareToken,createAssetWatchShareToken,verifyAssetWatchShareToken,
  rotateAssetWatchShareState,revokeAssetWatchShareState,assetWatchShareEnabled
} from '../asset-watch-share.js';

test('asset-watch share token is high entropy and stored only as sha256',()=>{
  const bytes=Buffer.alloc(32,7);
  const x=createAssetWatchShareToken(()=>bytes);
  assert.equal(x.token,bytes.toString('base64url'));
  assert.match(x.tokenHash,/^[a-f0-9]{64}$/);
  assert.equal(x.tokenHash,hashAssetWatchShareToken(x.token));
  assert.equal(verifyAssetWatchShareToken(x.token,x.tokenHash),true);
  assert.equal(verifyAssetWatchShareToken(x.token+'x',x.tokenHash),false);
});

test('rotating a share invalidates any previous token hash',()=>{
  const old=createAssetWatchShareToken(()=>Buffer.alloc(32,1));
  const next=createAssetWatchShareToken(()=>Buffer.alloc(32,2));
  const state=rotateAssetWatchShareState(null,{tokenHash:old.tokenHash,at:'2026-09-28T21:00:00.000Z'});
  const rotated=rotateAssetWatchShareState(state,{tokenHash:next.tokenHash,at:'2026-09-28T21:01:00.000Z'});
  assert.equal(assetWatchShareEnabled(rotated),true);
  assert.equal(verifyAssetWatchShareToken(old.token,rotated.tokenHash),false);
  assert.equal(verifyAssetWatchShareToken(next.token,rotated.tokenHash),true);
});

test('revocation fails closed',()=>{
  const x=createAssetWatchShareToken(()=>Buffer.alloc(32,3));
  const active=rotateAssetWatchShareState(null,{tokenHash:x.tokenHash,at:'2026-09-28T21:00:00.000Z'});
  const revoked=revokeAssetWatchShareState(active,{at:'2026-09-28T21:05:00.000Z'});
  assert.equal(assetWatchShareEnabled(revoked),false);
  assert.equal(revoked.tokenHash,null);
  assert.equal(revoked.revokedAt,'2026-09-28T21:05:00.000Z');
});
