import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');

test('R14 removes redundant customer-view banner to reclaim mobile space',()=>{
  assert.doesNotMatch(html,/class="mode-banner"/);
  assert.doesNotMatch(html,/MERIDIAN v8 · CUSTOMER VIEW/);
  assert.doesNotMatch(html,/Fünf Views · eine Datenquelle pro Kennzahl · Details nur auf Abruf/);
});

test('R14 preserves production header and five owned views',()=>{
  assert.match(html,/v8\.0 · PROD/);
  for(const id of ['view-center','view-depot','view-trade','view-paper','view-more'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/id="mainNav"/);
});
