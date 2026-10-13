import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
  assert.ok(v9.includes("fetch(API_BASE+'/api/private/asset-watch-share'"));
  assert.ok(v9.includes("authorization:'Bearer '+access"));
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

// Exercise the real UI functions with synthetic responses; no credentials or network.
function shareHarness(message){
  let calls=0;
  const context=vm.createContext({H:()=>({manageAssetWatchShare:async()=>{calls++;throw new Error(message)}}),esc:x=>String(x),renderBots:()=>{},document:{visibilityState:'visible'},AbortController,navigator:{clipboard:{writeText:async()=>{throw new Error('must not copy')}}}});
  const start=v10.indexOf('function assetWatchShareCard()');
  const end=v10.indexOf('function bindBotOverviewControls',start);
  vm.runInContext("let assetWatchShareGeneration=0,assetWatchShareAbort=null;const assetWatchShareUi={busy:false,shareUrl:'synthetic-old-link',message:'',tone:'safe'};"+v10.slice(start,end)+";globalThis.ui=assetWatchShareUi",context);
  return {context,calls:()=>calls};
}
test('v10 401 reports missing or invalid read access and disables stale link copy',async()=>{
  const {context,calls}=shareHarness('HTTP 401');
  await context.assetWatchShareAction('rotate');
  assert.equal(calls(),1);
  assert.equal(context.ui.shareUrl,null);
  assert.equal(context.ui.busy,false);
  const html=context.assetWatchShareCard();
  assert.ok(html.includes('Lesezugang fehlt oder ist ungültig.'));
  assert.ok(html.includes('AKTION FEHLGESCHLAGEN'));
  assert.ok(!html.includes('>BEREIT<'));
  assert.match(html,/data-asset-watch-share="copy" disabled/);
});
test('v10 failed revoke preserves truthful generic error and clears stale copy',async()=>{
  const {context,calls}=shareHarness('HTTP 503');
  await context.assetWatchShareAction('revoke');
  assert.equal(calls(),1);
  assert.equal(context.ui.shareUrl,null);
  assert.match(context.assetWatchShareCard(),/Asset-Watch-Aktion fehlgeschlagen/);
});
