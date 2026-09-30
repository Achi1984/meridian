import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const frame=fs.readFileSync(new URL('../v10/visual-qa-frame.html',import.meta.url),'utf8');

test('visual QA keeps the r92 baseline while granting interaction flows extra settle time',()=>{
  assert.match(qa,/virtualBudget=name\.startsWith\('flow-'\)\?5200:2600/);
  assert.match(qa,/effectiveVirtualBudget=name\.startsWith\('flow-'\)\?8000:virtualBudget/);
  assert.match(qa,/--virtual-time-budget='\+effectiveVirtualBudget/);
});

test('visual QA frame relay outlives the extended flow budget',()=>{
  assert.match(frame,/const maxTries=480/);
  assert.match(frame,/if\(tries<maxTries\)setTimeout\(pump,20\)/);
  assert.ok(480*20>8000);
});
