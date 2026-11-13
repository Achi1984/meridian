import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketQuoteAdapter, evaluateCausalQuoteChain} from '../scripts/memecoin-paper/market-quote-adapter.mjs';

const p = (source = 'fixture', receiptTime = '2026-11-13T20:00:00.000Z') => ({source, receiptTime});
const leg = (overrides = {}) => ({
  asset: 'SOL',
  quoteCurrency: 'USD',
  poolId: 'pool-1',
  routeId: 'route-1',
  sourceTime: '2026-11-13T20:00:00.000Z',
  receiptTime: '2026-11-13T20:00:01.000Z',
  grossInput: 100,
  grossOutput: 100,
  fees: {amount: 1, provenance: p('fees')},
  slippage: {amount: 0.5, provenance: p('slippage')},
  impact: {amount: 0.2, provenance: p('impact')},
  network: {amount: 0.01, provenance: p('network')},
  ...overrides
});

test('causal chain computes net quote and USD without double-counting', () => {
  const result = evaluateCausalQuoteChain({
    entry: leg({grossInput: 100}),
    exit: leg({grossOutput: 120, sourceTime: '2026-11-13T20:01:00.000Z', receiptTime: '2026-11-13T20:01:01.000Z'}),
    fx: {rate: 1, pair: 'USD/USD', provenance: p('fx')},
    now: '2026-11-13T20:02:00.000Z'
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.netQuote, 16.58);
  assert.equal(result.netUsd, 16.58);
  assert.equal(result.executionAuthorized, false);
});

test('missing cost provenance is UNKNOWN, including invented zero', () => {
  const result = evaluateCausalQuoteChain({
    entry: leg({fees: {amount: 0}}),
    exit: leg({sourceTime: '2026-11-13T20:01:00.000Z'}),
    fx: {rate: 1, pair: 'USD/USD', provenance: p('fx')},
    now: '2026-11-13T20:02:00.000Z'
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'MISSING_OR_UNPROVEN_FEES');
});

test('stale, future, mixed identity and incomplete FX fail closed', () => {
  const base = {exit: leg({sourceTime: '2026-11-13T20:01:00.000Z'}), fx: {rate: 1, pair: 'USD/USD', provenance: p('fx')}};
  assert.equal(evaluateCausalQuoteChain({entry: leg(), ...base, now: '2026-11-13T20:30:00.000Z'}).reason, 'STALE_QUOTE');
  assert.equal(evaluateCausalQuoteChain({entry: leg(), ...base, now: '2026-11-13T19:59:00.000Z'}).reason, 'FUTURE_SOURCE_TIME');
  assert.equal(evaluateCausalQuoteChain({entry: leg(), exit: leg({poolId: 'pool-2'}), fx: base.fx, now: '2026-11-13T20:02:00.000Z'}).reason, 'MIXED_QUOTE_IDENTITY');
  assert.equal(evaluateCausalQuoteChain({entry: leg(), exit: base.exit, now: '2026-11-13T20:02:00.000Z'}).reason, 'MISSING_OR_UNPROVEN_FX');
});

test('transport is bounded and fixed-origin', async () => {
  let aborted = false;
  const adapter = createMarketQuoteAdapter({
    origin: 'https://quotes.example.test',
    maxDurationMs: 15,
    transport: (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, {once: true});
    })
  });
  const result = await adapter.request({path: '/quote'});
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.reason, 'TIMEOUT');
  assert.equal(aborted, true);
  assert.equal((await adapter.request({path: 'https://evil.example.test/quote'})).reason, 'ORIGIN_MISMATCH');
});

test('adapter never authorizes execution', async () => {
  const adapter = createMarketQuoteAdapter({transport: async () => ({ok: true})});
  const result = await adapter.request({path: '/quote'});
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.evidenceComplete, false);
});
