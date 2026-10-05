import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const prereg=fs.readFileSync(new URL('../research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md',import.meta.url),'utf8');

test('V2 freezes separate funding and mark coverage with a 26h decision reserve',()=>{
  assert.match(prereg,/`fundingCoverageEnd`/);
  assert.match(prereg,/`markCoverageEnd`/);
  assert.match(prereg,/`coverageEnd = min\(fundingCoverageEnd, markCoverageEnd\)`/);
  assert.match(prereg,/`t \+ 26 hours <= coverageEnd`/);
  assert.match(prereg,/entry may occur at the first complete 1h mark OPEN after `t`/);
});

test('V2 freezes the expected funding schedule instead of adapting to provider interval changes',()=>{
  assert.match(prereg,/8-hour settlements at 00:00 \/ 08:00 \/ 16:00 UTC, tolerance ±1 second/);
  assert.match(prereg,/never auto-adapts this grid/);
  assert.match(prereg,/provider interval change.*integrity event/s);
  assert.match(prereg,/does not create a new common decision timestamp/);
});

test('V2 makes any open-position degradation immediately inconclusive',()=>{
  assert.match(prereg,/A \*\*degradation episode\*\* begins/);
  assert.match(prereg,/while a position is open:[\s\S]*affected run\/stage becomes \*\*INCONCLUSIVE immediately for research purposes\*\*/);
  assert.match(prereg,/no exit price, basis realization or post-detection funding path is modeled/);
  assert.match(prereg,/later mark candles[\s\S]*cannot convert the episode back into usable economic evidence/);
});

test('V2 distinguishes open-position degradation from flat degradation without a provisional-exit path',()=>{
  assert.match(prereg,/while no position is open:[\s\S]*entries are blocked until Recovery;[\s\S]*does not make the run INCONCLUSIVE/);
  assert.doesNotMatch(prereg,/provisional model exit/i);
  assert.doesNotMatch(prereg,/provisional exit/i);
});

test('V2 implementation gate preserves the blocking Claude regression requirements',()=>{
  assert.match(prereg,/missing scheduled settlement \+ no later off-grid settlement \+ complete confirmed marks => `INCONCLUSIVE`/);
  assert.match(prereg,/missing scheduled settlement \+ later off-grid settlement in the same degradation episode => `INCONCLUSIVE`/);
  assert.match(prereg,/no implementation path may assign an economically valid exit, basis realization or post-detection funding path/);
  assert.match(prereg,/decision timestamp exactly `coverageEnd - 26h` is admissible/);
  assert.match(prereg,/synthetic provider change to a 4h funding interval causes `DATA_DEGRADED`/);
  assert.match(prereg,/strict numeric parsing rejects null \/ blank \/ boolean source scalars/);
  assert.match(prereg,/collector itself refuses to execute source collection whenever the V2 stage lock does not explicitly authorize `sourceAudit:true`/);
});
