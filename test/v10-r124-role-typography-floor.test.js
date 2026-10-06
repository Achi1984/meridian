import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/r124-typography-floor.css',import.meta.url),'utf8');
const v10index=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r124 typography floor is a presentation-only sidecar loaded after v10 css',()=>{
  const base=v10index.indexOf('./v10.css?v='+release.terminalBuild);
  const r124=v10index.indexOf('./r124-typography-floor.css?v='+release.terminalBuild);
  assert.ok(base>=0,'v10.css must use the current release identity');
  assert.ok(r124>base,'r124 typography sidecar must load after v10.css');
  assert.match(css,/MERIDIAN R124/);
  assert.doesNotMatch(css,/(?:tone-|pair-tone-|submitOrder|placeOrder|createOrder|cancelOrder|postJson)/i);
});

test('r124 enforces role-based readable floors on Command, Depot, Bots and nav',()=>{
  assert.match(css,/\.command-health-chip>small\{[\s\S]*font-size:9px/);
  assert.match(css,/\.portfolio-hero-primary small,[\s\S]*font-size:9px/);
  assert.match(css,/#view-command \.portfolio-range-switch button,[\s\S]*min-height:44px;[\s\S]*font-size:10px/);

  assert.match(css,/#view-depot \.depot-asset-id small,[\s\S]*font-size:9px/);
  assert.match(css,/#view-depot \.depot-accounting-body\{[\s\S]*font-size:9px/);

  assert.match(css,/#view-bots \.bot-tab-head-compact span,[\s\S]*font-size:9px/);
  assert.match(css,/#view-bots \.pair-status\{font-size:11px\}/);
  assert.match(css,/#view-bots \.bot-filter-actions button\{[\s\S]*min-height:44px;[\s\S]*font-size:10px/);

  assert.match(css,/nav button span\{font-size:9px\}/);
});

test('r124 excludes research, FIB and global typography overrides',()=>{
  assert.doesNotMatch(css,/(?:\.fib-|\.sk-|\.edge-|\.holdout-|\.profit-agent-|\.lab-)/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:html|body|\*)\s*\{[^}]*font-size\s*:/m);
  assert.doesNotMatch(css,/@media[\s\S]*font-size:(?:6(?:\.25|\.5)?|7(?:\.5)?|8)px/);
});

test('r124 release remains execution neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.equal(release.terminalExecutionImpact,false);
});
