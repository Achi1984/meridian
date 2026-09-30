import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const workflow=fs.readFileSync(new URL('../.github/workflows/backend-safety.yml',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');

test('r76 release declares the permanent UI regression gate and remains execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r76');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(release.dashboardShell,/UI-REGRESSION-GATE$/);
});

test('r76 enforces one canonical UI regression command in Release Safety',()=>{
  assert.match(workflow,/node --check scripts\/v10-ui-regression-check\.mjs/);
  assert.match(workflow,/- name: V10 UI regression gate\n\s+run: node scripts\/v10-ui-regression-check\.mjs/);
});

test('r76 gate freezes five primary tabs and three secondary surfaces',()=>{
  assert.match(gate,/primary nav must contain exactly five buttons/);
  for(const token of ["route:'command',label:'COMMAND'","route:'depot',label:'DEPOT'","route:'bots',label:'BOTS'","route:'market',label:'FORECAST'","route:'research',label:'SCANNER'"])assert.ok(gate.includes(token),token);
  for(const token of ["'asset-detail'","'paper'","'more'"])assert.ok(gate.includes(token),token);
  assert.match(gate,/must remain secondary/);
});

test('r76 gate freezes build cache mobile and accessibility contracts',()=>{
  for(const token of ['viewport-fit=cover','safe-area-inset-top','safe-area-inset-right','safe-area-inset-bottom','safe-area-inset-left','100dvh','min-height:48px','min-height:44px',':focus-visible','prefers-reduced-motion:reduce',"setAttribute('role','status')"])assert.ok(gate.includes(token),token);
  assert.match(gate,/root redirect cache revision mismatch/);
  assert.match(gate,/v10 runtime build mismatch/);
  assert.match(gate,/v9 engine cache tag mismatch/);
});

test('r76 gate freezes selector and read-only boundaries',()=>{
  assert.match(gate,/single-element selector used as collection/);
  assert.match(gate,/v10 presentation contains execution\/order path/);
  assert.match(gate,/Paper Overview must use protected GET bridge/);
  assert.match(gate,/Paper Overview bridge must not POST/);
});

test('r76 UI regression script passes against the current checked-out release',()=>{
  const run=spawnSync(process.execPath,['scripts/v10-ui-regression-check.mjs'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/V10_UI_REGRESSION_PASS 10\.0-r76/);
});
