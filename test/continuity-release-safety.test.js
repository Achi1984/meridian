import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../.github/workflows/backend-safety.yml',import.meta.url),'utf8');

test('Release Safety syntax-checks the continuity audit',()=>{
  assert.match(workflow,/node --check scripts\/continuity-audit\.mjs/);
});

test('Release Safety executes the continuity audit as a named hard gate',()=>{
  assert.match(workflow,/- name: Meridian continuity audit\n\s+run: node scripts\/continuity-audit\.mjs/);
});
