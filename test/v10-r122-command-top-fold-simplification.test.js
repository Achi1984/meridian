import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapter=fs.readFileSync(new URL('../v10/r122-command-layout.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');

function block(startNeedle,endNeedle){
  const a=js.indexOf(startNeedle),b=js.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return js.slice(a,b);
}

test('r122 loads bounded layout adapter after the validated v10 renderer',()=>{
  const core=index.indexOf('./v10.js?v=10.0-r121');
  const layout=index.indexOf('./r122-command-layout.js?v=10.0-r121');
  assert.ok(core>=0&&layout>core);
  assert.match(adapter,/presentation-only Command layout adapter/);
});

test('r122 removes duplicated ATTENTION references and empty reassurance',()=>{
  assert.match(adapter,/querySelectorAll\('\.attention-reference'\)\.forEach\(x=>x\.remove\(\)\)/);
  assert.match(adapter,/rows\.every\(x=>x\.classList\.contains\('tone-safe'\)\)/);
  assert.doesNotMatch(adapter,/KEIN KRITISCHER PUNKT/);
});

test('r122 orders decision before detail without changing risk derivation',()=>{
  assert.match(adapter,/hub\.insertAdjacentElement\('afterend',risk\)/);
  assert.match(adapter,/risk\.insertAdjacentElement\('afterend',open\)/);
  assert.match(adapter,/open\.insertAdjacentElement\('afterend',remaining\)/);
  assert.match(adapter,/open\.appendChild\(grid\)/);
  const health=block('function commandHealthSummary()','function commandOverviewHtml()');
  assert.match(health,/const rank=\{danger:4,watch:3,muted:2,safe:1\}/);
  assert.match(health,/worst=\[portfolio,riskView,data\]/);
});

test('r122 preserves existing warning sources and moves nodes only',()=>{
  const attention=block('function commandAttentionHtml()','function commandPaperPresentation');
  assert.match(attention,/PORTFOLIO AUTHORITY/);
  assert.match(attention,/BOT COVERAGE/);
  assert.match(attention,/MARKET COVERAGE/);
  assert.match(adapter,/Moves existing DOM nodes only/);
  assert.match(adapter,/new MutationObserver\(schedule\)\.observe\(root,\{childList:true\}\)/);
});

test('r122 presentation adapter cannot execute trades or mutate authority',()=>{
  assert.doesNotMatch(adapter,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|executeTrade|portfolio\.complete\s*=)/i);
});
