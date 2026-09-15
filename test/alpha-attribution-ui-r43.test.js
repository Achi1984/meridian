import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('R43 is wired from scan telemetry through the paper overview',()=>{
  const server=read('server.js');
  const gateway=read('server-gateway.js');
  const data=read('v8-clean/data.js');
  const app=read('v8-clean/app.js');

  assert.match(server,/observeAlphaLabR43\(candidates\)/);
  assert.match(server,/alphaLab:alphaAttributionSummary/);
  assert.match(gateway,/alpha_lab_r43/);
  assert.match(data,/alphaLab:overview\.alphaLab/);
  assert.match(app,/R43 · ALPHA LAB/);
  assert.match(app,/SCANNER-SNAPSHOTS · KEINE AUSFÜHRUNG/);
  assert.match(app,/data-countdown-at/);
  assert.match(app,/NÄCHSTES 24H-ERGEBNIS/);
  assert.match(app,/DATEN FEHLEN/);
  assert.match(app,/HYPOTHESE GEFUNDEN/);
  assert.doesNotMatch(app,/SIGNAL GEFUNDEN/);
  assert.doesNotMatch(app,/ARCHIVIERTE BOTS/);
  assert.doesNotMatch(app,/SHADOW · REGIME · RETIRED/);
});

test('R43 browser cache tag and release metadata move together',()=>{
  const index=read('v8-clean/index.html');
  const app=read('v8-clean/app.js');
  const release=JSON.parse(read('version.json'));

  assert.match(index,/app\.js\?v=8\.0-r45/);
  assert.match(app,/data\.js\?v=8\.0-r45/);
  assert.equal(release.alphaLab,'R43-ALPHA-ATTRIBUTION-V1');
  assert.equal(release.executionImpact,false);
});
