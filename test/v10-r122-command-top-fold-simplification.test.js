import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const adapter=fs.readFileSync(new URL('../v10/r122-command-layout.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const build=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8')).terminalBuild;

function block(a,b){const i=js.indexOf(a),j=js.indexOf(b,i+1);assert.ok(i>=0&&j>i,'expected '+a);return js.slice(i,j)}

test('r122 loads adapter after the r122 v10 renderer',()=>{
 const core=index.indexOf('./v10.js?v='+build),layout=index.indexOf('./r122-command-layout.js?v='+build);
 assert.ok(core>=0&&layout>core);assert.match(adapter,/transitional presentation adapter/)
});

test('r122 de-duplicates ATTENTION without hiding authoritative warning sources',()=>{
 assert.match(adapter,/attention-reference/);assert.match(adapter,/tone-safe/);
 const src=block('function commandAttentionHtml()','function commandPaperPresentation');
 for(const x of ['LIQ_RISK','PROTECTION_RISK','RISK_REVIEW','UNVERIFIED','DATA_STALE','MARKET_STALE','PORTFOLIO AUTHORITY','BOT COVERAGE','MARKET COVERAGE'])assert.match(src,new RegExp(x))
});

test('r122 preserves worst-of risk semantics and removes duplicate NEXT header',()=>{
 const health=block('function commandHealthSummary()','function commandOverviewHtml()');
 assert.match(health,/rank=\{danger:4,watch:3,muted:2,safe:1\}/);assert.match(health,/worst=\[portfolio,riskView,data\]/);
 assert.match(adapter,/querySelector\('\.section-title'\)\?\.remove\(\)/);
 assert.match(adapter,/command-open-navigation/)
});

test('r122 browser QA pins final DOM order and moved click bindings',()=>{
 assert.match(adapter,/qaR122/);assert.match(adapter,/r122-qa-report/);
 for(const x of ['next:','risk:','open:','attention:','refs:','openClick','assetClick'])assert.match(adapter,new RegExp(x,'i'));
 assert.match(adapter,/getBoundingClientRect\(\)\.top<innerHeight/);
 assert.match(adapter,/\[data-command-go="bots"\]/);assert.match(adapter,/\[data-command-asset\]/)
});

test('r122 observer is bounded and adapter stays execution-neutral',()=>{
 assert.match(adapter,/MutationObserver\(S\)\.observe\(r,\{childList:true\}\)/);assert.doesNotMatch(adapter,/subtree:true/);
 assert.doesNotMatch(adapter,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|executeTrade|portfolio\.complete\s*=)/i)
});
