import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize, decisionUsdClose, resolvePilotRun} from '../paper-advisor-gateway.js';

function sample(id, execution = 'HOLD', cashEur = 1000, btc = 0) {
  return {pilotAudit:{completedSlots:id}, report:{arms:{model:{cashEur, btc}},
    last:{at:new Date(id*600000).toISOString(), execution}}};
}
test('replayed checkpoints count once and a closed trade uses the change in cash', () => {
  const buy = sample(2, 'PAPER_BUY', 900, 1);
  const sell = sample(3, 'PAPER_SELL', 998.04);
  const rows = [sell, buy, buy, sample(1)];
  const result = summarize(rows);
  assert.deepEqual(result.decisions, [sell.report.last, buy.report.last, rows[3].report.last]);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].netEur.toFixed(2), '-1.96');
  assert.equal(summarize([buy, sell]).trades.length, 0);
  assert.equal(summarize([sample(1), buy, sample(4), sample(5,'PAPER_SELL')]).trades.length, 0);
});
test('history includes at most the last ten distinct decisions, newest first', () => {
  const rows = Array.from({length:14}, (_,i) => sample(i+1));
  assert.deepEqual(summarize(rows).decisions, rows.slice(-10).reverse().map(r => r.report.last));
});

test('USD quote matches the completed Kraken minute at the decision boundary', () => {
  const at = '2026-11-18T19:20:08Z';
  const end = Date.parse('2026-11-18T19:20:00Z') / 1000;
  const row = (time, close) => [time, '1', '1', '1', close];
  const bars = [row(end-120, '98'), row(end-60, '101.25'), row(end, '999')];
  assert.deepEqual(decisionUsdClose(bars, at), {close:101.25, at:new Date(end*1000).toISOString()});
  for (const invalid of [null, bars.slice(0, -1), [bars[0], bars[2]], [row(end-60, '0'), bars[2]]]) {
    assert.equal(decisionUsdClose(invalid, at), null);
  }
});

test('run discovery follows a rollover across pages and ignores finished runs', async () => {
  const run = (n, status = 'RUNNING') => ({
    id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
    status, active: Number(status === 'RUNNING'), concluded: status !== 'RUNNING',
    startedAt: new Date(n * 600000).toISOString()
  });
  let second = [run(2, 'SUCCESS')];
  const request = async url => {
    const next = url.searchParams.has('cursor');
    return {ok: true, json: async () => ({
      data: {runs: next ? second : [run(1)]},
      pagination: next ? {hasNextPage: false} : {hasNextPage: true, cursor: 'next'}
    })};
  };
  assert.equal(await resolvePilotRun('test', run(1).id, request), run(1).id);
  second = [run(3), run(4, 'FAILED')];
  assert.equal(await resolvePilotRun('test', run(1).id, request), run(3).id);
  const denied = async () => ({ok: false});
  assert.equal(await resolvePilotRun('test', run(1).id, denied), run(1).id);
  await assert.rejects(resolvePilotRun('test', undefined, denied));
});

test('after shutdown the newest successful run supersedes a stale configured fallback', async () => {
  const runs = ['SUCCESS', 'SUCCESS', 'FAILED'].map((status, index) => ({
    id: '00000000-0000-4000-8000-00000000000' + index,
    startedAt: new Date(index * 600000).toISOString(), active: 0, concluded: true, status
  }));
  const request = async () => ({ok: true, json: async () => ({
    data: {runs: [...runs].reverse()}, pagination: {hasNextPage: false}
  })});
  assert.equal(await resolvePilotRun('test', runs[0].id, request), runs[1].id);
});
