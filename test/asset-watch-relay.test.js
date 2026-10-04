import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {timingSafeToken} from '../api/asset-watch-relay.js';

test('relay token uses sha256 and timing-safe comparison semantics',()=>{
  const token='example-token';
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  assert.equal(timingSafeToken(token,hash),true);
  assert.equal(timingSafeToken(token+'x',hash),false);
  assert.equal(timingSafeToken('',hash),false);
  assert.equal(timingSafeToken(token,'not-a-hash'),false);
});

test('encrypted live relay has no plaintext bot sanitizer path',async()=>{
  const source=await import('node:fs').then(fs=>fs.readFileSync(new URL('../api/asset-watch-relay.js',import.meta.url),'utf8'));
  assert.match(source,/validateAssetWatchMirrorEnvelope/);
  assert.match(source,/MERIDIAN_ASSET_WATCH_LIVE_MIRROR_URL/);
  assert.doesNotMatch(source,/sanitizeBot|sanitizeSnapshot|\.bots/);
  assert.match(source,/return json\(res,200,envelope\)/);
});

test('encrypted live relay fails closed on invalid strict-live receipt',async()=>{
  const source=await import('node:fs').then(fs=>fs.readFileSync(new URL('../api/asset-watch-relay.js',import.meta.url),'utf8'));
  assert.match(source,/strict_live_unavailable/);
  assert.match(source,/validation\.reason/);
  assert.match(source,/cache-control','no-store, max-age=0/);
});
