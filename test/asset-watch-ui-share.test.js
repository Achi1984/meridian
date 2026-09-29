import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');

test('Asset Watch share management requires full private read auth',()=>{
  const route=gateway.indexOf('u.pathname==="/api/private/asset-watch-share"');
  assert.ok(route>=0);
  const block=gateway.slice(route,route+1200);
  assert.ok(block.includes('if(!authorizedRead(req))return writeJson(res,401'));
  assert.ok(block.includes('createAssetWatchShareToken()'));
  assert.ok(block.includes('rotateAssetWatchShareState'));
  assert.ok(block.includes('revokeAssetWatchShareState'));
});

test('scoped share can read only the sanitized Asset Watch route before generic auth',()=>{
  const scoped=gateway.indexOf('u.pathname==="/api/private/asset-watch"&&await authorizedAssetWatchShare');
  const generic=gateway.indexOf('if(isProtected(u.pathname)&&!authorizedRead(req))');
  const market=gateway.indexOf('u.pathname==="/api/private/market-klines"');
  assert.ok(scoped>=0&&generic>scoped&&market>generic);
  const scopedBlock=gateway.slice(scoped,scoped+600);
  assert.ok(scopedBlock.includes('buildAssetWatchApiSnapshot(data)'));
  assert.equal(scopedBlock.includes('u.pathname==="/api/private/dashboard"'),false);
});

test('v9 creates and revokes scoped links through authenticated Meridian gateway only',()=>{
  assert.ok(v9.includes('manageAssetWatchShare'));
  assert.ok(v9.includes("postJson('/api/private/asset-watch-share'"));
  assert.ok(v9.includes("authorization:'Bearer '+token()"));
  assert.equal(v9.includes('api.pionex.com/api/private/asset-watch-share'),false);
});

test('v10 share controls are explicit user actions and do not render the token into markup',()=>{
  assert.ok(v10.includes('data-asset-watch-share="rotate"'));
  assert.ok(v10.includes('data-asset-watch-share="copy"'));
  assert.ok(v10.includes('data-asset-watch-share="revoke"'));
  assert.ok(v10.includes('navigator.clipboard.writeText(assetWatchShareUi.shareUrl)'));
  assert.equal(v10.includes(">'+assetWatchShareUi.shareUrl"),false);
  assert.equal(v10.includes('>"+assetWatchShareUi.shareUrl'),false);
});
