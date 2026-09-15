import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const paper=fs.readFileSync(new URL('../v8-clean/paper-cohort-r18.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/paper-answer-r26.css',import.meta.url),'utf8');

test('R26 loads answer-first PAPER assets coherently',()=>{
  assert.match(html,/paper-answer-r26\.css\?v=8\.0-r45/);
  assert.match(html,/app\.js\?v=8\.0-r45/);
  assert.match(html,/paper-cohort-r18\.js\?v=8\.0-r45/);
  assert.match(app,/\.\/data\.js\?v=8\.0-r45/);
  assert.match(paper,/\.\/data\.js\?v=8\.0-r45/);
});

test('R26 exposes the actual risk lock instead of calling inactivity no opportunity',()=>{
  assert.match(data,/getJson\('\/api\/paper\/overview'\)/);
  assert.match(data,/const \{status,challengerV2:challenger,challengerV3,baseline\}=overview/);
  assert.match(data,/lastSignal\?\.gate\?\.reasons/);
  assert.match(data,/riskLocked:baseGate\.some\(x=>x\.startsWith\('MAX_'\)\)/);
  assert.match(data,/riskLocked:challengerGate\.some\(x=>x\.startsWith\('MAX_'\)\)/);
  assert.match(paper,/MAX_DRAWDOWN:'Max Drawdown erreicht'/);
  assert.match(paper,/BOTS PAUSIERT · ANALYSE LÄUFT/);
});

test('R45 shows only current V3 trades and a concise verdict',()=>{
  assert.match(data,/recentTrades\(challengerV3\)/);
  assert.match(data,/slice\(0,5\)/);
  assert.doesNotMatch(data,/\.\.\.x,bot:'baseline'|\.\.\.x,bot:'challenger'/);
  assert.match(paper,/LETZTE TRADES/);
  assert.match(paper,/paper-r26-trades-disclosure/);
  assert.match(paper,/Erst prospektiv bewerten/);
  assert.match(paper,/renderAnswer\(payload\.botHealth\)/);
});

test('R45 hides discontinued bot cards but never hides their open positions',()=>{
  assert.match(app,/r\.key==='challengerV3'\|\|Number\(r\.openTrades\)>0/);
  assert.match(data,/baseline\?\.positions/);
  assert.match(data,/challenger\?\.openPositions/);
  assert.match(data,/challengerV3\?\.openPositions/);
  assert.match(paper,/OFFEN · \$\{bot\}/);
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
  assert.equal(JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8')).executionImpact,false);
});
