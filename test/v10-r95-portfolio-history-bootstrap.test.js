import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r95 portfolio-history bootstrap contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=95,'expected r95 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PORTFOLIO-HISTORY-BOOTSTRAP-UX/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
});

test('r95 distinguishes zero-point and one-point canonical history bootstrap states',()=>{
  assert.match(js,/STARTPUNKT WIRD GESPEICHERT/);
  assert.match(js,/1\. MESSPUNKT GESPEICHERT · KURVE STARTET MIT DEM NÄCHSTEN/);
  assert.match(js,/HISTORIE WARTET AUF PORTFOLIO AUTHORITY/);
  assert.match(js,/storedPoints=strictHistory\.length/);
});

test('r95 bootstrap state explicitly tells the user that history continues automatically',()=>{
  assert.match(js,/Kanonische History läuft automatisch weiter\. Spätestens mit dem nächsten Messpunkt wird die Kurve sichtbar\./);
  assert.match(js,/portfolio-history-progress/);
  assert.match(js,/>1 \/ 2</);
  assert.match(css,/\.portfolio-history-progress/);
});

test('r95 keeps the chart fail-closed and does not fabricate historic values',()=>{
  const start=js.indexOf('function strictPortfolioHistoryPoints()');
  const end=js.indexOf('function bindCommandPortfolioHero',start);
  const block=js.slice(start,end);
  assert.match(block,/sourceStatus\?\.spot\|\|''\)==='STRICT_AUTHORITY'/);
  assert.match(block,/if\(m\.geometry\)/);
  assert.doesNotMatch(block,/synthetic|interpolat|backfill|reconstruct/i);
});
