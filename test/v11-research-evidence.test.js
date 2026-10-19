import assert from 'node:assert/strict';
import test from 'node:test';
import {B17_EVIDENCE_SNAPSHOT, projectResearchEvidence} from '../v11/research-evidence.js';

const receipt = () => structuredClone(B17_EVIDENCE_SNAPSHOT);
function assertBlocked(result) {
  for (const stage of ['execution', 'paper', 'live']) assert.equal(result[stage].state, 'BLOCKED');
  for (const forbidden of ['netPnl', 'eligible', 'authorized', 'activation', 'winner']) assert.equal(forbidden in result, false);
}

test('dated snapshot separates source review, technical D1 and pending integration', () => {
  const result = projectResearchEvidence(receipt());
  assert.equal(result.asOf, '2026-10-19');
  assert.equal(result.source.state, 'REVIEWED');
  assert.equal(result.d1.state, 'VERIFIED_NOT_FROZEN');
  assert.match(result.source.provenance, /6255139258/);
  assert.match(result.d1.provenance, /6271222342/);
  assert.match(result.d1.provenance, /PR #896: finale Abnahme und Integration zum Belegstand ausstehend/);
  assertBlocked(result);
});

test('missing, malformed and unrelated receipts produce unknown evidence', () => {
  for (const input of [undefined, null, [], true, {}, {...receipt(), schemaVersion: 'OTHER'},
    {...receipt(), subject: 'H7'}, {...receipt(), asOf: '2026-02-30'}, {...receipt(), asOf: true}]) {
    const result = projectResearchEvidence(input);
    assert.equal(result.source.state, 'UNKNOWN');
    assert.equal(result.d1.state, 'UNKNOWN');
    assertBlocked(result);
  }
});

test('source receipt never promotes absent D1 and D1 never promotes absent source review', () => {
  const sourceOnly = receipt(); delete sourceOnly.d1;
  const d1Only = receipt(); delete d1Only.source;
  assert.equal(projectResearchEvidence(sourceOnly).d1.state, 'UNKNOWN');
  assert.equal(projectResearchEvidence(d1Only).source.state, 'UNKNOWN');
  assert.equal(projectResearchEvidence(d1Only).d1.state, 'VERIFIED_NOT_FROZEN');
});

test('inconsistent D1 identities and verification results fail closed without erasing source review', () => {
  const mutations = [
    {rowsPerAsset: 954}, {start: '2024-02-20'}, {end: '2026-10-01'},
    {assets: ['XBTUSD', 'XBTUSD', ...receipt().d1.assets.slice(2)]},
    {assets: [...receipt().d1.assets, 'DOGEUSD']}, {rawHashes: false},
    {selectedSeriesHashes: 'FAIL'}, {schemaAndQuality: 'UNKNOWN'}, {synchronizedDays: 'FAIL'},
    {manifest: 'FROZEN'}, {integration: 'MERGED'}, {state: 'APPROVED'},
    {reviewRef: '<script>alert(1)</script>'}, {pr: 0}, {admitted: true}, {frozen: true}, {status: 'FAIL'}
  ];
  for (const mutation of mutations) {
    const input = receipt(); Object.assign(input.d1, mutation);
    const result = projectResearchEvidence(input);
    assert.equal(result.d1.state, 'UNKNOWN', JSON.stringify(mutation));
    assert.equal(result.source.state, 'REVIEWED');
    assertBlocked(result);
  }
});

test('malformed source references are unknown even when D1 is valid', () => {
  for (const mutation of [{state: true}, {commit: '6f720373'}, {pr: 1.5}, {reviewRef: 'javascript:alert(1)'}, {verdict: 'REVISION_REQUIRED'}, {status: 'FAILED'}]) {
    const input = receipt(); Object.assign(input.source, mutation);
    const result = projectResearchEvidence(input);
    assert.equal(result.source.state, 'UNKNOWN');
    assert.equal(result.d1.state, 'VERIFIED_NOT_FROZEN');
    assertBlocked(result);
  }
});

test('caller-controlled activation booleans and forged downstream states cannot grant anything', () => {
  const input = receipt();
  Object.assign(input, {authorized: true, eligible: true, netPnl: 100, activation: true,
    execution: {state: 'ACTIVE'}, paper: true, live: {state: 'APPROVED'}});
  Object.assign(input.d1, {paperApproved: true, liveApproved: true});
  const before = structuredClone(input);
  const result = projectResearchEvidence(input);
  assertBlocked(result);
  assert.deepEqual(input, before, 'projection must not mutate evidence');
  assert.equal(result.source.state, 'UNKNOWN');
  assert.equal(result.d1.state, 'UNKNOWN');
});


test('D1 cannot be dated before the claimed data period ends', () => {
  const result = projectResearchEvidence({...receipt(), asOf: '2026-09-29'});
  assert.equal(result.d1.state, 'UNKNOWN');
  assertBlocked(result);
});
