import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');

test('v10 r13 loads validated v9 engine plus isolated v10 presentation adapter',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(html,/\.\.\/v9\/v9\.js\?v=10\.0-r\d+/);
  assert.match(html,/\.\/v10\.js\?v=10\.0-r\d+/);
  assert.match(html,/window\.MERIDIAN_V10=true/);
});

test('v10 r69 exposes five decision-first primary tabs and keeps Lab secondary',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="more"/);
  assert.match(js,/data-open-lab/);
  assert.match(js,/LAB ÖFFNEN/);
});

test('v10 makes Data Guard and asset-pair risk explicit without changing trading logic',()=>{
  assert.match(js,/DATA GUARD/);
  assert.match(js,/Nur ACTIONABLE = entscheidungsrelevant/);
  assert.match(js,/ASSET RISK MAP/);
  assert.match(js,/Long \+ Short je Asset gemeinsam/);
  assert.match(js,/No trading logic lives here/);
});

test('v10 visually separates live execution surfaces from paper research',()=>{
  assert.match(js,/POSITION LAYER/);
  assert.match(js,/RESEARCH HUB/);
  assert.match(js,/keine automatische Promotion/i);
  assert.match(css,/data-tone="live"/);
  assert.match(css,/data-tone="paper"/);
});
