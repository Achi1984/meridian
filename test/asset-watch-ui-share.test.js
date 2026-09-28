import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');

test('Asset Watch share management requires full private read auth',()=>{
  const route=gateway.indexOf('u.pathname==="/api/private/asset-watch-share"');
  assert.ok(route>=0);
  const block=gateway.slice(route,route+800);
  assert.match(block,/if(!authorizedRead(req))return writeJson(res,401/);
  assert.match(block,/createAssetWatchShareToken()/);
  assert.match(block,/rotateAssetWatchShareState/);
  assert.match(block,/revokeAssetWatchShareState/);
});

test('scoped share can read only the sanitized Asset Watch route before generic auth',()=>{
  const scoped=gateway.indexOf('u.pathname==="/api/private/asset-watch"&&await authorizedAssetWatchShare');
  const generic=gateway.indexOf('if(isProtected(u.pathname)&&!authorizedRead(req))');
  const market=gateway.indexOf('u.pathname==="/api/private/market-klines"');
  assert.ok(scoped>=0&&generic>scoped&&market>generic);
  const scopedBlock=gateway.slice(scoped,scoped+500);
  assert.match(scopedBlock,/buildAssetWatchApiSnapshot(data)/);
  assert.doesNotMatch(scopedBlock,//api/private/dashboard/);
});

test('v9 creates and revokes scoped links through authenticated Meridian gateway only',()=>{
  assert.match(v9,/manageAssetWatchShare/);
  assert.match(v9,/postJson('/api/private/asset-watch-share'/);
  assert.match(v9,/authorization:'Bearer '+token()/);
  assert.doesNotMatch(v9,/api.pionex.com.*asset-watch-share/);
});

test('v10 share controls are explicit user actions and never render the token',()=>{
  assert.match(v10,/data-asset-watch-share="rotate"/);
  assert.match(v10,/data-asset-watch-share="copy"/);
  assert.match(v10,/data-asset-watch-share="revoke"/);
  assert.match(v10,/navigator.clipboard.writeText(assetWatchShareUi.shareUrl)/);
  assert.doesNotMatch(v10,/shareUrl+'<|shareUrl+"<|>\s*'\+assetWatchShareUi\.shareUrl/);
});
