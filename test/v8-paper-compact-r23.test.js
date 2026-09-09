import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const cohort=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const control=fs.readFileSync(new URL('../v8-clean/research-control-r19.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-compact-r23.css',import.meta.url),'utf8');

test('R23 compact PAPER assets are wired with fresh cache tags',()=>{
  assert.match(html,/paper-compact-r23\.css\?v=8\.0-r23/);
  assert.match(html,/app\.js\?v=8\.0-r36/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r36/);
  assert.match(html,/research-control-r19\.js\?v=8\.0-r23/);
});

test('R23 separates active references from retired ledgers',()=>{
  assert.match(app,/r\.key==='baseline'\|\|r\.key==='challenger'/);
  assert.match(app,/r\.key==='shadow'\|\|r\.key==='regime'/);
  assert.match(app,/PERFORMANCE-DETAILS/);
  assert.match(app,/ARCHIVIERTE BOTS/);
  assert.match(app,/SHADOW · REGIME · RETIRED/);
  assert.match(app,/<details class="card paper-disclosure paper-archive">/);
});

test('R23 keeps the successor answer first and collapses secondary research',()=>{
  assert.match(css,/#view-paper>#paperAnswerR26\{order:2\}/);
  assert.match(css,/#view-paper>#paperExecutionAuditR22\{order:7\}/);
  assert.match(css,/#view-paper>\.paper-active-board\{order:3\}/);
  assert.match(cohort,/document\.createElement\('details'\)/);
  assert.match(control,/document\.createElement\('details'\)/);
  assert.match(app,/paper-diagnostics/);
  assert.doesNotMatch(app,/>BUILDING</);
});

test('R23 shields iPhone safe areas and reduces bottom navigation height',()=>{
  assert.match(css,/body::before/);
  assert.match(css,/height:env\(safe-area-inset-top\)/);
  assert.match(css,/padding-bottom:calc\(70px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/\.main-nav button\{min-height:44px/);
  assert.match(css,/@media\(max-width:390px\)/);
});

test('R23 remains presentation-only and preserves research safety',()=>{
  const all=app+cohort+control+css;
  assert.match(app,/PROMOTION <b class="tone-safe">OFF/);
  assert.match(app,/BASELINE <b>6\.2/);
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
});
