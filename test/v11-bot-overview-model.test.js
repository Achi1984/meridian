import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBotOverviewModel} from '../v11/bot-overview-model.js';

const bot = (ref, symbol, side, category, leverage, pnl) => ({
  ref: ref.repeat(20), symbol, side, category,
  metrics: {leverage, pnlUsd: pnl}
});
const snapshot = () => ({status: 'FRESH_SNAPSHOT', readOnly: true, executionAllowed: false,
  source: 'PIONEX_BOT_API', snapshotAt: '2026-10-18T10:00:00Z', bots: [
    bot('a', 'ETHUSDT', 'SHORT', 'linear', 3, -8),
    bot('b', 'BTCUSD', 'LONG', 'inverse', 5, 0),
    bot('c', 'ETHUSDT', 'NEUTRAL', 'linear', null, -2),
    bot('d', 'ADAUSDT', null, null, 10, null)
  ]});

test('overview filters preserve bot identity and distinguish snapshot count from matches', () => {
  const result = buildBotOverviewModel(snapshot(), {query: 'eth', direction: 'short', category: 'linear'});
  assert.equal(result.count, 4);
  assert.equal(result.bots.length, 1);
  assert.equal(result.bots[0].ref, 'a'.repeat(20));
  assert.equal(result.bots[0].direction, 'short');
  assert.deepEqual(buildBotOverviewModel(snapshot(), {query: 'missing'}).bots, []);
  assert.equal(buildBotOverviewModel({...snapshot(), bots: []}).count, 0);
});

test('sorts deterministically with unknown leverage and P/L last and V1 zero unconfirmed', () => {
  const source = snapshot();
  const sortedSymbol = buildBotOverviewModel(source).bots;
  assert.deepEqual(sortedSymbol.map(row => row.ref[0]), ['d', 'b', 'a', 'c']);
  const sortedLeverage = buildBotOverviewModel(source, {sort: 'leverage'}).bots;
  assert.deepEqual(sortedLeverage.map(row => row.ref[0]), ['d', 'b', 'a', 'c']);
  const sortedPnl = buildBotOverviewModel(source, {sort: 'pnl'}).bots;
  assert.deepEqual(sortedPnl.map(row => row.ref[0]), ['a', 'c', 'd', 'b']);
  assert.equal(sortedPnl[2].pnl, null);
  assert.deepEqual(buildBotOverviewModel(source).distribution, {long: 1, short: 1, neutral: 1, unknown: 1});
});

test('Command losses include only confirmed negative source P/L and are capped at three', () => {
  const source = snapshot();
  source.bots.push(bot('e', 'XRPUSDT', 'LONG', 'linear', 2, -1));
  source.bots.push(bot('f', 'SOLUSDT', 'SHORT', 'linear', 4, -12));
  assert.deepEqual(buildBotOverviewModel(source).losses.map(row => row.pnl), [-12, -8, -2]);
});

test('malformed or duplicate bot references fail closed', () => {
  const source = snapshot();
  source.bots[1].ref = source.bots[0].ref;
  assert.deepEqual(buildBotOverviewModel(source), {status: 'unavailable', bots: []});
  assert.deepEqual(buildBotOverviewModel({...snapshot(), readOnly: false}), {status: 'unavailable', bots: []});
});
