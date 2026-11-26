import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHolderReport} from '../v11/holder-comparison.js';

function fixture(evidence, counts) {
  const id = '1:wave:token';
  const allowed = evidence.state === 'high' ? ['C'] : ['C','H'];
  const accounts = {};
  for (const key of ['C','H']) {
    const bought = allowed.includes(key);
    accounts[key] = {policy:'fixed', realizedUsdc:0, closedTrades:0, cashUsdc:bought ? 979.95 : 1000,
      openPositions:bought ? [{positionId:id, qty:100}] : []};
  }
  const status = {
    ledgerVerified:true, startedAt:1, updatedAt:3, lastEvent:'handoff', accounts,
    holderComparison:{reference:'C', filtered:'H', thresholdBps:2000, entryStates:counts,
      skippedReferenceEntries:evidence.state === 'high' ? 1 : 0, realizedDeltaUsdc:0}
  };
  const rows = ['start','entry','handoff'].map((event, i) => ({event, eventId:String(i), at:i+1, fills:[]}));
  Object.assign(rows[1], {arm:'wave', session:1, mint:'token', positionId:id, qty:100,
    inputRaw:20_000_000, holderEvidence:evidence,
    fills:allowed.map(account => ({account, positionId:id, qty:100, usdcRaw:20_000_000, side:'buy'}))});
  return {status, rows, check:() => auditHolderReport(status, rows.map(row => JSON.stringify(row)).join('\n'))};
}

function audit(evidence, counts) {
  return fixture(evidence, counts).check();
}

test('measured holder states match the inclusive threshold and journal counts', () => {
  const evidence = {state:'high', largestOwnerBps:2000, sampledSupplyBps:6000};
  assert.equal(audit(evidence, {high:1}).unknown, 0);
  assert.throws(() => audit({...evidence, largestOwnerBps:1999}, {high:1}), /measurement/);
  assert.throws(() => audit({...evidence, sampledSupplyBps:1999}, {high:1}), /measurement/);
  assert.throws(() => audit(evidence, {belowThreshold:1}), /comparison/);
  assert.equal(audit({...evidence, state:'belowThreshold', largestOwnerBps:1999}, {belowThreshold:1}).unknown, 0);
});

test('stale measurements count only as unknown', () => {
  const report = audit({state:'unknown', reason:'staleOrLate', largestOwnerBps:9000}, {unknown:1});
  assert.equal(report.unknown, 1);
  assert.equal(report.measured, 0);
  assert.equal(report.maxOwnerBps, null);
});

test('measured zero and open purchase cost survive journal reconciliation', () => {
  const report = audit({state:'belowThreshold', largestOwnerBps:0, sampledSupplyBps:100},
    {belowThreshold:1});
  assert.equal(report.measured, 1);
  assert.equal(report.maxOwnerBps, 0);
  for (const row of report.rows) assert.deepEqual(row, {net:0, open:1, closed:0, openCost:20.05});
});

test('an internally balanced account cannot silently skip an eligible entry', () => {
  const {status, rows, check} = fixture({state:'unknown'}, {unknown:1});
  rows[1].fills.pop();
  Object.assign(status.accounts.H, {cashUsdc:1000, openPositions:[]});
  assert.throws(check, /entry admission/);
});

test('cash and quantities must trace back to the entry quote', () => {
  const {status, rows, check} = fixture({state:'unknown'}, {unknown:1});
  rows[1].fills[1].qty++;
  status.accounts.H.openPositions[0].qty++;
  assert.throws(check, /entry fill/);
});

test('a sell must use proceeds from its own exit quote', () => {
  const {rows, check} = fixture({state:'unknown'}, {unknown:1});
  rows.splice(2, 0, {...rows[1], event:'exit', eventId:'exit', usdcRaw:19_000_000,
    fills:rows[1].fills.map(fill => ({...fill, side:'sell', usdcRaw:19_100_000}))});
  assert.throws(check, /exit fill/);
});
