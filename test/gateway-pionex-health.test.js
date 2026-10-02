import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');

test('gateway health exposes only a boolean Pionex read-credential flag',()=>{
  assert.match(gateway,/const PIONEX_BOT_READ_CONFIGURED=!!\(/);
  assert.match(gateway,/pionexBotReadConfigured:PIONEX_BOT_READ_CONFIGURED/);
  assert.doesNotMatch(gateway,/pionexBotReadApiKey/);
  assert.doesNotMatch(gateway,/pionexBotReadApiSecret/);
});

test('Asset Watch runtime live channel returns only the encrypted mirror envelope',()=>{
  assert.match(gateway,/u\.pathname==="\/api\/asset-watch\/live-mirror"/);
  const route=gateway.slice(gateway.indexOf('u.pathname==="/api/asset-watch/live-mirror"'),gateway.indexOf('u.pathname==="/api/private/asset-watch/github-oidc-mirror"'));
  assert.match(route,/encryptAssetWatchMirror\(snapshot,shareState\.tokenHash\)/);
  assert.match(route,/writeJson\(res,200,envelope/);
  assert.doesNotMatch(route,/writeJson\(res,200,snapshot/);
  assert.doesNotMatch(route,/\.bots/);
});
