import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r113 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r113');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-LIVE-RISK-LIQUIDATION-DISTANCE/);
  assert.equal(manifest.start_url,'./v10/?build=r113&fresh=r113');
  assert.ok(js.includes("const BUILD='10.0-r113'"));
});

test('r113 compact Command risk card exposes liquidation price current price buffer and stage',()=>{
  const a=js.indexOf('function liquidationStage(buffer)');
  const b=js.indexOf('function criticalPair()',a);
  const block=js.slice(a,b);
  assert.match(block,/LIQUIDATION PRICE/);
  assert.match(block,/CURRENT PRICE/);
  assert.match(block,/LIQ BUFFER/);
  assert.match(block,/STAGE/);
  assert.match(block,/unavailable/);
  assert.match(block,/smallest verified live buffer/);
});

test('r113 reuses the existing three-step liquidation tone ladder',()=>{
  const a=js.indexOf('function liquidationStage(buffer)');
  const b=js.indexOf('function criticalLiquidationSnapshot',a);
  const block=js.slice(a,b);
  assert.match(block,/n<10.*DANGER.*danger/s);
  assert.match(block,/n<18.*WATCH.*watch/s);
  assert.match(block,/SAFE.*safe/s);
});

test('r113 liquidation display is read-only presentation code',()=>{
  const a=js.indexOf('function liquidationStage(buffer)');
  const b=js.indexOf('function criticalPair()',a);
  const block=js.slice(a,b);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|method:\s*['"]POST)/i);
  assert.match(css,/v10 r113 · COMMAND live-risk liquidation distance/);
});
