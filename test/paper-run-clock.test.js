import test from 'node:test';
import assert from 'node:assert/strict';
import {runClockText} from '../v11/paper-run-clock.js';
test('live, stale, ended, early finish and absent start', () => {
  const timing = {start:10000, observed:13600, end:17200};
  assert.equal(runClockText(timing,13660),'Laufzeit 1 h 01 min · noch 59 min geplant');
  assert.equal(runClockText(timing,15400),'Laufzeit beim letzten Stand 1 h 00 min · noch 30 min geplant');
  assert.match(runClockText(timing,18000),/geplantes Ende erreicht/);
  assert.equal(runClockText({...timing,finished:true},18000),'Laufzeit 1 h 00 min · beendet');
  assert.equal(runClockText({...timing,start:null},13660),'Laufzeit unbekannt');
});
