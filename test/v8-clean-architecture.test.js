import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const arch=fs.readFileSync(new URL('../v8-clean/ARCHITECTURE.md',import.meta.url),'utf8');

test('clean v8 has exactly five real view roots and one five-item nav',()=>{
  for(const key of ['center','depot','trade','paper','more']){
    assert.match(html,new RegExp(`id="view-${key}"`));
    assert.match(html,new RegExp(`data-route="${key}"`));
  }
  assert.equal((html.match(/class="view(?: is-active)?"/g)||[]).length,5);
  assert.equal((html.match(/data-route=/g)||[]).length,5);
});

test('clean v8 does not load legacy compatibility renderer stack',()=>{
  for(const legacy of ['app-v6.06.js','app-v7.32-legacy.js','app-v7.33-hardening.js','app-v8.0-navigation.js']){
    assert.doesNotMatch(html,new RegExp(legacy.replaceAll('.','\\.')));
    assert.doesNotMatch(app,new RegExp(legacy.replaceAll('.','\\.')));
  }
  assert.doesNotMatch(app,/legacy\.click|renderOne|primaryBottomNav|querySelector\([^\n]*data-view/);
});

test('clean CENTER consumes protected dashboard through a dedicated adapter',()=>{
  assert.match(data,/\/api\/private\/dashboard/);
  assert.match(data,/authorization:`Bearer \$\{t\}`/);
  assert.match(data,/meridian\.v8\.readToken/);
  assert.match(data,/source:'PRIVATE_DASHBOARD'/);
});

test('clean v8 remains presentation/read-only',()=>{
  const all=html+app+data+arch;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|liveTrading\s*=\s*true/i);
  assert.match(arch,/Baseline `6\.2\.0 \/ 6\.2-SIGNAL-V1` remains frozen/);
  assert.match(arch,/server\.js` remains untouched/);
});
