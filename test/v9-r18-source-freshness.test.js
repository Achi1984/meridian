import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('r18 distinguishes private snapshots from fresh actionable bot data',()=>{
  assert.match(js,/function botFeedFresh\(\)/);
  assert.match(js,/state\.botFeedTimestampTrusted&&age!=null&&age<=15\*60\*1000/);
  assert.match(js,/SNAPSHOT · STALE/);
  assert.match(js,/FRESH SNAPSHOT/);
  assert.match(js,/PRIVATE SNAPSHOT · STALE/);
  assert.match(js,/Snapshot ≠ Live-API/);
});

test('r18 diagnostics reveal whether the backend or matcher is the bottleneck',()=>{
  assert.match(js,/PRIVATE API ROWS/);
  assert.match(js,/UNMATCHED API/);
  assert.match(js,/Backend liefert aktuell nur/);
  assert.match(js,/private Bot-Rows nicht gematcht/);
  assert.match(js,/state\.unmatchedLive=live\.filter/);
});

test('r18 prevents stale snapshot data from driving risk and exposure actions',()=>{
  assert.match(js,/function critical\(\)\{return botFeedFresh\(\)\?/);
  assert.match(js,/const rows=botFeedFresh\(\)\?state\.bots\.filter/);
  assert.match(js,/confirmed=botFeedFresh\(\)\?state\.bots\.filter/);
  assert.match(js,/if\(!botFeedFresh\(\)\)return\['STALE','muted'\]/);
  assert.match(js,/Keine frischen Bot-Snapshots für Risk Priority/);
});

test('r18 scopes liquidation labels and production version correctly',()=>{
  assert.match(js,/LIQ SAFE/);
  assert.match(js,/LIQ WATCH/);
  assert.match(js,/LIQ MARGIN/);
  assert.match(html,/v9 · r18 · COIN-M COMMAND CENTER/);
  assert.match(html,/9\.0-r18/);
});
