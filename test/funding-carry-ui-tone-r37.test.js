import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');

test('R37 separates active lifecycle color from funding carry PnL color',()=>{
  assert.match(app,/fundingStatusTone=fc\.lifecycle==='ACTIVE_PAPER'\?'safe'/);
  assert.match(app,/fundingPnlTone=fb\?Number\(fb\.netPnl\)>0\?'safe':Number\(fb\.netPnl\)<0\?'danger':'muted'/);
  assert.match(app,/tone-\$\{fundingStatusTone\}[^`]+tone-\$\{fundingPnlTone\}/);
});

test('R37 changes presentation only',()=>{
  assert.doesNotMatch(app,/placeOrder|createOrder|submitOrder|method\s*:\s*['"]POST/i);
});
