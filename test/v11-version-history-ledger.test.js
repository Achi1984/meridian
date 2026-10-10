import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ledger = readFileSync(new URL('../docs/v11/VERSION_HISTORY.md', import.meta.url), 'utf8');
test('version-history ledger identifies reviewed preview milestones', () => {
  for (const number of [646, 651]) {
    assert.ok(ledger.includes('https://github.com/Achi1984/meridian/pull/' + number));
  }
  assert.match(ledger, /Meridian\s*11/i);
  assert.match(ledger, /preview|Vorschau/i);
  assert.match(ledger, /Meridian\s*10/i);
  assert.match(ledger, /r127/);
});
