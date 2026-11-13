import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLifeMode, LIFE_MODE_SCHEMA, LIFE_UNIT_CENTS } from '../research/paper-arena-life-mode.mjs';

const input = snapshots => ({
  schemaVersion: LIFE_MODE_SCHEMA,
  runId: 'life-mode-fixture-001',
  currency: 'USD',
  monetaryUnit: 'CENTS',
  snapshots
});

test('maps 1000 USD equity to one life and counts gains/losses conservatively', () => {
  const result = evaluateLifeMode(input([
    { at: 1, equityCents: 100_000 },
    { at: 2, equityCents: 210_000 },
    { at: 3, equityCents: 95_000 },
    { at: 4, equityCents: 305_000 }
  ]));
  assert.equal(result.status, 'EVALUATED');
  assert.equal(result.lifeUnitCents, LIFE_UNIT_CENTS);
  assert.equal(result.startingLives, 1);
  assert.equal(result.currentLives, 3);
  assert.equal(result.maxLives, 3);
  assert.equal(result.minLives, 0);
  assert.equal(result.livesGained, 4);
  assert.equal(result.livesLost, 2);
  assert.equal(result.maxDrawdownCents, 115_000);
});

test('does not double-charge costs already reflected in equity', () => {
  const result = evaluateLifeMode(input([
    { at: 1, equityCents: 99_960 },
    { at: 2, equityCents: 100_010 }
  ]));
  assert.equal(result.currentLives, 1);
  assert.equal(result.minimumEquityCents, 99_960);
  assert.equal(result.maxDrawdownCents, 0);
});

test('rejects unordered, duplicate, negative and malformed snapshots', () => {
  for (const snapshots of [
    [{ at: 2, equityCents: 100_000 }, { at: 1, equityCents: 100_000 }],
    [{ at: 1, equityCents: 100_000 }, { at: 1, equityCents: 100_000 }],
    [{ at: 1, equityCents: -1 }],
    [{ at: 1, equityCents: 1.5 }]
  ]) assert.equal(evaluateLifeMode(input(snapshots)).status, 'UNKNOWN');
});

test('keeps arena authority disabled and rejects wrong currency or empty input', () => {
  const wrong = input([{ at: 1, equityCents: 100_000 }]);
  wrong.currency = 'EUR';
  assert.equal(evaluateLifeMode(wrong).status, 'UNKNOWN');
  assert.equal(evaluateLifeMode({ ...input([]), snapshots: [] }).status, 'UNKNOWN');
  const result = evaluateLifeMode(input([{ at: 1, equityCents: 100_000 }]));
  assert.deepEqual(result.authority, { paper: false, live: false, promotion: false });
});
