import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardRows} from '../v11/top100-report.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('original checkpoint structure reconciles into mobile account rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'top100-test-'));
  try {
    const state = {lastSlot:1795640400, cashBenchmarkUsdt:1000, accounts:{
      direct:{initialUsdt:1000, closed:[{net:'-2.50'}], open:{}},
      retest:{initialUsdt:1000, closed:[{net:null}], open:{BTC:{}}}
    }};
    const path = join(directory, 'state.json');
    writeFileSync(path, JSON.stringify(state));
    const result = spawnSync('python3',['scripts/research/top100_dashboard.py',path,'final'],{encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const [direct,retest,cash] = dashboardRows(report);
    assert.equal(direct.equity, 997.5);
    assert.deepEqual([retest.equity,retest.open,retest.pending], [null,1,1]);
    assert.equal(cash.equity, 1000);
    assert.throws(() => dashboardRows({...report, runId:0}));
    report.accounts.retest.pending = 2;
    assert.throws(() => dashboardRows(report));
  } finally {
    rmSync(directory, {recursive:true,force:true});
  }
});
