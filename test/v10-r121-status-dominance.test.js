import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');

function block(startNeedle,endNeedle){
  const a=js.indexOf(startNeedle),b=js.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return js.slice(a,b);
}

test('r121 overall pair status dominates a safe liquidation sub-status',()=>{
  const pair=block('function pairCard(','function criticalPair()');
  assert.match(pair,/overallRiskDominates=st\.tone!=='safe'&&liqDisplay\.tone==='safe'/);
  assert.match(pair,/liqTone=overallRiskDominates\?'muted':liqDisplay\.tone/);
  assert.match(pair,/overallRiskDominates\?'OK · NUR LIQ':'OK'/);
  assert.match(pair,/tone-'\+liqTone/);
  assert.doesNotMatch(pair,/protectionConflict\?'muted':liqDisplay\.tone/);
});

test('r121 keeps real liquidation WATCH and DANGER thresholds unchanged',()=>{
  const liq=block('function liquidationStage(','function criticalLiquidationSnapshot');
  assert.match(liq,/if\(n<10\)return\{label:'DANGER',tone:'danger'\}/);
  assert.match(liq,/if\(n<18\)return\{label:'WATCH',tone:'watch'\}/);
  assert.match(liq,/return\{label:'SAFE',tone:'safe'\}/);
});

test('r121 green LIQ styling is scoped to an overall safe Command card',()=>{
  assert.match(css,/\.command-risk-card\.pair-tone-safe \.command-liq-substatus \.tone-safe\{color:var\(--green\)!important\}/);
  assert.doesNotMatch(css,/(^|\n)\.command-liq-substatus \.tone-safe\{/);
});

test('r121 visual QA fails closed on safe LIQ tone inside a non-safe overall card',()=>{
  const qa=block('function writeLocalVisualQaReport(','function writeLocalVisualQaError');
  assert.match(qa,/commandRiskSubstatusViolations=cfg\.view==='command'/);
  assert.match(qa,/commandRiskSubstatusDominance=commandRiskSubstatusViolations\.length===0/);
  assert.match(qa,/commandRiskSubstatusViolations,navOcclusions/);
  assert.match(qa,/layout\.commandRiskSubstatusDominance/);
});

test('r121 status-dominance presentation does not add execution paths',()=>{
  const pair=block('function pairCard(','function criticalPair()');
  assert.doesNotMatch(pair,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|executeTrade)/i);
});
