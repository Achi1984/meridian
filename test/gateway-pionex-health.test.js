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
