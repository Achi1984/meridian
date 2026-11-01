import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {PaperCheckpointSession} from '../scripts/memecoin-paper/checkpoint-session.mjs';
import {analyzeCandidate, filterCandidate} from '../scripts/memecoin-paper/stages.mjs';
import {syntheticCandidate, SYNTHETIC_SMART_WALLET_ALLOWLIST} from '../scripts/memecoin-paper/synthetic-fixtures.mjs';
import {pinClockPolicy, normalizeClockSample, admitClock} from '../scripts/memecoin-paper/clock-policy.mjs';
const START = Date.parse('2026-01-01T19:00:00Z');
const H8 = 8 * 60 * 60 * 1000;
// Named synthetic test limits only, not operating recommendations.
const SYNTHETIC_LIMITS = {maxAnchorUncertaintyMs: 4, maxSkewMs: 10, maxObservationGapMs: H8 + 1};
const policy = (start = START) => ({version: 'anchored-clock-v1', mode: 'synthetic', sourceId: 'synthetic-test', anchorUtcMs: start, anchorMonotonicMs: 100, anchorUncertaintyMs: 1, ...SYNTHETIC_LIMITS});
const sample = (elapsed = 0, skew = 0, start = START) => ({sourceId: 'synthetic-test', mode: 'synthetic', wallUtcMs: start + elapsed + skew, monotonicMs: 100 + elapsed});
function memoryStore() {
  return {bytes: null, hash: null, fail: false, writes: 0,
    async readCheckpoint() { return this.bytes ? {status: 'OK', bytes: this.bytes, hash: this.hash} : {status: 'ABSENT'}; },
    async commitCheckpoint({candidateBytes: bytes}) { this.writes++; if (this.fail) return {status: 'UNKNOWN'};
      this.bytes = Buffer.from(bytes); this.hash = createHash('sha256').update(bytes).digest('hex'); return {status: 'ACK', hash: this.hash}; },
    async close() {}, async reconcilePending() { return {status: 'UNKNOWN'}; }};
}
async function setup(start = START) {
  const store = memoryStore(); let observation = sample(0, 0, start); let reads = 0;
  const clock = {sample() { reads++; return observation; }};
  const clockPolicy = policy(start);
  const session = await PaperCheckpointSession.open({store, runId: 'synthetic-clock-test', startedAt: start, clockPolicy, clock});
  return {store, session, clockPolicy, clock, set: value => observation = value, reads: () => reads};
}
const risk = now => ({now, marks: []});
test('explicit complete policy; no implicit production limits or fixture upgrade', async () => {
  const p = policy();
  for (const key of Object.keys(p)) { const bad = {...p}; delete bad[key]; assert.throws(() => pinClockPolicy(bad, START)); }
  for (const bad of [null, {}, {...p, maxSkewMs: -1}, {...p, anchorUncertaintyMs: 5}, {...p, mode: 'trusted'}, {...p, extra: 1}]) assert.throws(() => pinClockPolicy(bad, START));
  await assert.rejects(PaperCheckpointSession.open({store: memoryStore(), runId: 'x', startedAt: START, clockPolicy: null}));
  await assert.rejects(PaperCheckpointSession.open({store: memoryStore(), runId: 'x', startedAt: START, clockPolicy: p}));
  const store = memoryStore();
  await PaperCheckpointSession.open({store, runId: 'x', startedAt: START});
  await assert.rejects(PaperCheckpointSession.open({store, clockPolicy: p}), {code: 'CHECKPOINT_INCOMPATIBLE'});
});
test('skew boundary both signs, independent observation gap, malformed/regressed samples and overflow', () => {
  const p = pinClockPolicy(policy(), START);
  for (const skew of [-10, 10]) assert.equal(admitClock(p, 100, sample(1000, skew), START + 1000).status, 'ADMIT');
  for (const skew of [-11, 11]) assert.equal(admitClock(p, 100, sample(1000, skew), START + 1000).reason, 'CLOCK_WALL_DIVERGENCE');
  assert.equal(admitClock(p, 100, sample(H8 + 1), START + H8 + 1).status, 'ADMIT');
  assert.equal(admitClock(p, 100, sample(H8 + 2), START + H8 + 2).reason, 'CLOCK_OBSERVATION_GAP');
  assert.equal(admitClock(p, 102, sample(1), START + 1).reason, 'CLOCK_MONOTONIC_REGRESSION');
  for (const bad of [undefined, null, {...sample(), wallUtcMs: NaN}, {...sample(), monotonicMs: 1.5}, {...sample(), extra: true}]) assert.equal(normalizeClockSample(bad), null);
  assert.equal(admitClock(p, 100, {...sample(), mode: 'external'}, START).reason, 'CLOCK_SOURCE_MISMATCH');
  const edge = {...p, anchorUtcMs: 8640000000000000};
  assert.equal(admitClock(edge, 100, sample(1), edge.anchorUtcMs + 1).reason, 'CLOCK_TIME_OVERFLOW');
});
test('caller forward date cannot change financial state; durable latch, replay and cached retries', async () => {
  const f = await setup();
  const first = await f.session.riskSnapshot('first', risk(START));
  const before = f.session.snapshot();
  const result = await f.session.riskSnapshot('false-future', risk(START + H8 + 1));
  assert.equal(result.reason, 'CLOCK_CALLER_TIME_MISMATCH');
  assert.equal(result.financialStateUnchanged, true);
  assert.deepEqual(f.session.snapshot(), before);
  assert.equal(f.session.metadata.sequence, 2);
  assert.equal(f.session.metadata.clockAdmissionBlocked, true);
  const reads = f.reads(), writes = f.store.writes;
  assert.deepEqual(await f.session.riskSnapshot('first', risk(START)), first);
  assert.deepEqual(await f.session.riskSnapshot('false-future', risk(START + H8 + 1)), result);
  assert.equal((await f.session.riskSnapshot('new', risk(START))).reason, 'CLOCK_FAULT_LATCHED');
  assert.equal(f.reads(), reads); assert.equal(f.store.writes, writes);
  const reopened = await PaperCheckpointSession.open({store: f.store, clockPolicy: f.clockPolicy, clock: {sample() { throw Error('must not sample replay'); }}});
  assert.deepEqual(reopened.snapshot(), before);
  assert.deepEqual(await reopened.riskSnapshot('first', risk(START)), first);
  assert.equal((await reopened.riskSnapshot('another', risk(START))).reason, 'CLOCK_FAULT_LATCHED');
});
test('new work after clean reopen records restart fault; no reanchor, replay clock or policy downgrade', async () => {
  const f = await setup(); await f.session.riskSnapshot('first', risk(START));
  const before = f.session.snapshot();
  await assert.rejects(PaperCheckpointSession.open({store: f.store}), {code: 'CHECKPOINT_INCOMPATIBLE'});
  await assert.rejects(PaperCheckpointSession.open({store: f.store, clockPolicy: {...f.clockPolicy, maxSkewMs: 11}}), {code: 'CHECKPOINT_INCOMPATIBLE'});
  const resumed = await PaperCheckpointSession.open({store: f.store, clockPolicy: f.clockPolicy});
  assert.equal((await resumed.riskSnapshot('restart', risk(START))).reason, 'CLOCK_RESTART_BLOCKED');
  assert.deepEqual(resumed.snapshot(), before);
  const again = await PaperCheckpointSession.open({store: f.store, clockPolicy: f.clockPolicy});
  assert.equal((await again.riskSnapshot('new', risk(START))).reason, 'CLOCK_FAULT_LATCHED');
});
test('invalid sampled clock faults before ledger; unknown fault ACK blocks all results', async () => {
  const f = await setup(); const before = f.session.snapshot(); f.set(null);
  assert.equal((await f.session.riskSnapshot('invalid', risk(START))).reason, 'CLOCK_SAMPLE_INVALID');
  assert.deepEqual(f.session.snapshot(), before);
  const g = await setup(); g.set(null); g.store.fail = true;
  assert.equal((await g.session.riskSnapshot('unknown', risk(START))).status, 'UNKNOWN');
  assert.throws(() => g.session.snapshot());
  assert.throws(() => g.session.metadata);
});
test('anchored UTC admits real Vienna midnight and DST fallback; eight-hour boundary remains exact', async () => {
  for (const start of [Date.parse('2026-01-01T22:59:59Z'), Date.parse('2026-10-25T00:59:59Z')]) {
    const f = await setup(start); f.set(sample(2000, 0, start));
    const result = await f.session.riskSnapshot('later', risk(start + 2000));
    assert.notEqual(result.reason, 'CLOCK_CALLER_TIME_MISMATCH');
    assert.equal(f.session.metadata.clockAdmissionBlocked, false);
  }
  const f = await setup(); f.set(sample(H8)); await f.session.riskSnapshot('boundary', risk(START + H8));
  assert.equal(JSON.parse(f.store.bytes).records.at(-1).guard, undefined);
  f.set(sample(H8 + 1)); await f.session.riskSnapshot('expired', risk(START + H8 + 1));
  assert.equal(JSON.parse(f.store.bytes).records.at(-1).guard, 'deadline');
});

test('rejected clock preserves an active reservation instead of expiring or refreshing it', async () => {
  const f = await setup();
  const candidate = syntheticCandidate(START);
  const filterResult = filterCandidate(candidate, {now: START, holdUntil: START + H8});
  const scoreResult = analyzeCandidate(candidate, {now: START, filterResult, smartWalletAllowlist: SYNTHETIC_SMART_WALLET_ALLOWLIST});
  assert.equal(filterResult.status, 'PASS'); assert.equal(scoreResult.status, 'PASS');
  f.set(sample(1000));
  const authorization = await f.session.authorizeEntry('reserve', {authorizationId: 'auth-clock', candidate, filterResult, scoreResult, tickId: 'tick-clock', now: START + 1000, marks: []});
  assert.equal(authorization.status, 'AUTHORIZED');
  const before = f.session.snapshot();
  const rejected = await f.session.finishRun('fake-finish', risk(START + H8 + 1));
  assert.equal(rejected.reason, 'CLOCK_CALLER_TIME_MISMATCH');
  assert.deepEqual(f.session.snapshot(), before);
  const restored = await PaperCheckpointSession.open({store: f.store, clockPolicy: f.clockPolicy});
  assert.deepEqual(restored.snapshot(), before);
  assert.deepEqual(await restored.authorizeEntry('reserve', {authorizationId: 'auth-clock', candidate, filterResult, scoreResult, tickId: 'tick-clock', now: START + 1000, marks: []}), authorization);
});
