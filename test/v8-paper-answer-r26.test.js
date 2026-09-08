import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const paper=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-answer-r26.css',import.meta.url),'utf8');

test('R26 loads answer-first PAPER assets coherently',()=>{
  assert.match(html,/paper-answer-r26\.css\?v=8\.0-r27/);
  assert.match(html,/app\.js\?v=8\.0-r27/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r27/);
  assert.match(app,/\.\/data\.js\?v=8\.0-r27/);
  assert.match(paper,/\.\/data\.js\?v=8\.0-r27/);
});

test('R26 exposes the actual risk lock instead of calling inactivity no opportunity',()=>{
  assert.match(data,/getJson\('\/api\/paper'\)\.catch\(\(\)=>null\)/);
  assert.match(data,/lastSignal\?\.gate\?\.reasons/);
  assert.match(data,/riskLocked:baseGate\.some\(x=>x\.startsWith\('MAX_'\)\)/);
  assert.match(data,/riskLocked:challengerGate\.some\(x=>x\.startsWith\('MAX_'\)\)/);
  assert.match(paper,/MAX_DRAWDOWN:'Max Drawdown erreicht'/);
  assert.match(paper,/BOTS PAUSIERT · ANALYSE LÄUFT/);
});

test('R26 shows five merged latest closed trades and a concise verdict',()=>{
  assert.match(data,/recentTrades\(baseline,challenger,challengerV3\)/);
  assert.match(data,/slice\(0,5\)/);
  assert.match(data,/bot:'baseline'/);
  assert.match(data,/bot:'challenger'/);
  assert.match(paper,/LETZTE TRADES/);
  assert.match(paper,/Erst prospektiv bewerten/);
  assert.match(paper,/renderAnswer\(payload\.botHealth\)/);
});

test('R26 moves performance and technical audit behind disclosures',()=>{
  assert.match(app,/<details class="card research-board paper-active-board paper-disclosure">/);
  assert.match(paper,/document\.createElement\('details'\)/);
  assert.match(paper,/<summary><span>TECHNISCHE DIAGNOSE<\/span>/);
  assert.match(css,/paper-r26-bots/);
});

test('R26 preserves drawdown protection and cannot execute',()=>{
  const all=app+data+paper+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|method\s*:\s*['"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
  assert.match(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'),/qualified MAX_DRAWDOWN stop/);
});
