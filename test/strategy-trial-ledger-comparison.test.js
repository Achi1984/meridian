import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareTrialLedgers } from '../scripts/research/compare-trial-ledgers.mjs';
import { validateTrialLedger } from '../docs/strategy-lab/validate-trial-ledger.mjs';

const source = {
  id: 'source',
  path: 'docs/strategy-lab/matrix.json',
  sha: 'a'.repeat(40),
  commit: 'b'.repeat(40),
};
const proposedCells = [
  ['BASELINE_DEVELOPMENT', 'BASELINE', 'PROPOSED'],
  ['BASELINE_HISTORICAL_HOLDOUT_AUDIT', 'BASELINE', 'PROPOSED'],
  ['D1_COST_30BPS', 'DIAGNOSTIC', 'PROPOSED'],
  ['D2_COST_40BPS', 'DIAGNOSTIC', 'PROPOSED'],
  ['D3_DELAY_1H', 'DIAGNOSTIC', 'UNAVAILABLE'],
  ['D4_DELAY_24H', 'DIAGNOSTIC', 'UNAVAILABLE'],
  ['D5_FEATURE_21D', 'DIAGNOSTIC', 'PROPOSED'],
  ['D6_FEATURE_35D', 'DIAGNOSTIC', 'UNAVAILABLE'],
];
const cliPath = fileURLToPath(new URL('../scripts/research/compare-trial-ledgers.mjs', import.meta.url));

function ledger() {
  const attempt = {
    attemptId: 'attempt-completed',
    strategyIdentity: 'STRATEGY-A',
    stage: 'DEVELOPMENT',
    attemptClass: 'STRATEGY_EVALUATION',
    status: 'COMPLETED',
    runIdentity: { provider: 'github_actions', runId: '101', runAttempt: 'UNKNOWN' },
    resultRecordRef: 'result-1',
    sourceRefs: ['source'],
  };
  const failed = {
    attemptId: 'attempt-failed',
    strategyIdentity: 'STRATEGY-A',
    stage: 'DIAGNOSTIC',
    attemptClass: 'TECHNICAL_EVALUATION',
    status: 'FAILED',
    runIdentity: { provider: 'github_actions', runId: '102', runAttempt: 'UNKNOWN' },
    sourceRefs: ['source'],
  };
  const output = {
    schemaVersion: 'MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1',
    opId: 'SYNTHETIC-TEST-LEDGER',
    sourceMainCommit: 'c'.repeat(40),
    sourceProvenance: 'ASSERTED_SOURCE_REFERENCES_NOT_AUTHENTICATED_EXECUTION',
    status: 'BOUNDED_INVENTORY_INCOMPLETE',
    executionAuthorized: false,
    scope: { historicalInventoryComplete: false, absenceOfRecordMeansZero: false },
    sources: [structuredClone(source)],
    coverage: {
      complete: false,
      nonWorkflowAttempts: { status: 'UNKNOWN_UNRECONCILED', sourceRefs: ['source'] },
      gaps: [{
        id: 'manual-gap',
        gap: 'Manual attempts are not reconciled.',
        blocks: 'Numeric budget.',
        closureSource: 'A sourced manual attempt ledger.',
        blocksNumericBudget: true,
      }],
    },
    attempts: [attempt, failed],
    resultRecords: [{
      resultRecordId: 'result-1',
      resultIdentity: 'workflow:github_actions:101:UNKNOWN:DEVELOPMENT',
      strategyIdentity: 'STRATEGY-A',
      resultKind: 'STRATEGY_PNL_RESULT',
      recordedOutcome: 'RECORDED_FAILURE',
      strategyPnlCalculated: true,
      runIdentity: structuredClone(attempt.runIdentity),
      attemptRef: attempt.attemptId,
      sourceRefs: ['source'],
    }],
    nonEmpiricalRecords: [{
      recordId: 'design-record',
      identity: 'synthetic design',
      recordKind: 'DESIGN_ONLY',
      status: 'NOT_EMPIRICAL',
      sourceRefs: ['source'],
    }],
    proposedProtocol: {
      expectedCounts: { baseline: 2, diagnostics: 6 },
      resourceCeilings: { measured: false },
      cells: proposedCells.map(([cellId, cellKind, availability]) => ({
        cellId,
        cellKind,
        availability,
        executionStatus: 'NOT_EXECUTED',
        countedInExecutedUsage: false,
        sourceRefs: ['source'],
      })),
    },
    budget: {
      status: 'UNKNOWN_UNRECONCILED',
      countingPolicy: {
        status: 'UNKNOWN_UNRECONCILED',
        policyId: 'UNKNOWN',
        includedAttemptClasses: 'UNKNOWN',
        excludedAttemptClasses: 'UNKNOWN',
        includedStatuses: 'UNKNOWN',
        excludedStatuses: 'UNKNOWN',
        sourceRefs: ['source'],
      },
      authorizedCap: 'UNKNOWN',
      consumedAttemptRefs: 'UNKNOWN',
      remaining: 'UNKNOWN',
    },
    reportedCounts: {},
    interpretationLimits: ['Synthetic fixture only.'],
  };
  setCounts(output);
  return output;
}

function setCounts(value) {
  const attempts = value.attempts;
  const results = value.resultRecords;
  const resultIds = new Set(results.filter((row) => row && typeof row.resultIdentity === 'string')
    .map((row) => row.resultIdentity));
  const runIds = new Set(attempts.filter((row) => row?.runIdentity)
    .map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}`));
  const knownNumbers = new Set(attempts.filter((row) => Number.isSafeInteger(row?.runIdentity?.runAttempt))
    .map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`));
  const evaluatorClasses = new Set(['STRATEGY_EVALUATION', 'FEATURE_EVALUATION', 'TECHNICAL_EVALUATION']);
  const exact = attempts.every((row) => Number.isSafeInteger(row?.runIdentity?.runAttempt))
    ? new Set(attempts.map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`)).size
    : 'UNKNOWN';
  value.reportedCounts = {
    resultRecords: resultIds.size,
    attemptRecords: attempts.length,
    documentedWorkflowRunIds: runIds.size,
    knownRunAttemptNumbers: knownNumbers.size,
    exactDistinctAttemptIdentities: exact,
    evaluatorClassifiedAttemptRecords: attempts.filter((row) => evaluatorClasses.has(row?.attemptClass)).length,
    nonEmpiricalRecords: value.nonEmpiricalRecords.length,
    proposedCells: value.proposedProtocol.cells.length,
  };
}

function group(audit, name) {
  return audit.differences[name];
}

test('compares valid full ledgers deterministically without mutating input or validator results', () => {
  const earlier = ledger();
  const later = structuredClone(earlier);
  later.sources.reverse();
  later.attempts.reverse();
  later.resultRecords.reverse();
  later.nonEmpiricalRecords.reverse();
  later.proposedProtocol.cells.reverse();
  later.coverage.gaps.reverse();
  const before = JSON.stringify(earlier);

  const audit = compareTrialLedgers({ earlier, later });
  assert.equal(audit.status, 'COMPARED');
  assert.deepEqual(audit.validation.earlier, validateTrialLedger(earlier));
  assert.deepEqual(audit.validation.later, validateTrialLedger(later));
  assert.deepEqual(group(audit, 'sources').added, []);
  assert.deepEqual(group(audit, 'attempts').changed, []);
  assert.deepEqual(group(audit, 'resultRecords').removed, []);
  assert.equal(audit.differences.proposedProtocol.changed, false);
  assert.equal(audit.differences.coverage.changed, false);
  assert.equal(audit.differences.budget.changed, false);
  assert.deepEqual(audit, compareTrialLedgers({
    earlier,
    later: {
      ...structuredClone(later),
      sources: [...later.sources].reverse(),
      attempts: [...later.attempts].reverse(),
      resultRecords: [...later.resultRecords].reverse(),
      nonEmpiricalRecords: [...later.nonEmpiricalRecords].reverse(),
      proposedProtocol: {
        ...structuredClone(later.proposedProtocol),
        cells: [...later.proposedProtocol.cells].reverse(),
      },
      coverage: {
        ...structuredClone(later.coverage),
        gaps: [...later.coverage.gaps].reverse(),
      },
    },
  }));
  assert.equal(JSON.stringify(earlier), before);
  assert.deepEqual(audit, compareTrialLedgers({ earlier, later }));
  assert.equal(audit.executionAuthorized, false);
  assert.equal(audit.completenessCertified, false);
  assert.equal(audit.provenanceVerified, false);
  assert.equal(audit.autoPromotion, false);
});

test('retains removed failed, invalid, cancelled, aborted, discarded, and manual attempts', () => {
  const earlier = ledger();
  for (const [index, [status, attemptClass]] of [
    ['TECHNICAL_INVALID', 'TECHNICAL_EVALUATION'],
    ['CANCELLED', 'STRATEGY_EVALUATION'],
    ['ABORTED', 'FEATURE_EVALUATION'],
    ['DISCARDED', 'MANUAL_ATTEMPT'],
    ['FAILED', 'OPERATIONAL_WORKFLOW'],
  ].entries()) {
    earlier.attempts.push({
      attemptId: `removed-${index}`,
      strategyIdentity: 'STRATEGY-A',
      stage: 'DIAGNOSTIC',
      attemptClass,
      status,
      runIdentity: { provider: 'github_actions', runId: String(200 + index), runAttempt: 'UNKNOWN' },
      sourceRefs: ['source'],
    });
  }
  setCounts(earlier);
  const later = structuredClone(earlier);
  later.attempts = later.attempts.filter((attempt) => !attempt.attemptId.startsWith('removed-'));
  setCounts(later);

  const removed = group(compareTrialLedgers({ earlier, later }), 'attempts').removed;
  assert.equal(removed.length, 5);
  assert.deepEqual(removed.map(({ record }) => record.record.status).sort(), [
    'ABORTED', 'CANCELLED', 'DISCARDED', 'FAILED', 'TECHNICAL_INVALID',
  ]);
  assert.ok(removed.every(({ record }) => record.record.sourceRefs.includes('source')));
});

test('exposes changed attempt tuples, linked result identities, and outcome fields', () => {
  const earlier = ledger();
  const later = structuredClone(earlier);
  const attempt = later.attempts[0];
  attempt.strategyIdentity = 'STRATEGY-B';
  attempt.stage = 'VALIDATION';
  attempt.runIdentity.runAttempt = 2;
  const result = later.resultRecords[0];
  result.strategyIdentity = attempt.strategyIdentity;
  result.runIdentity = structuredClone(attempt.runIdentity);
  result.resultIdentity = 'workflow:github_actions:101:2:VALIDATION';
  result.recordedOutcome = 'UPDATED_CLAIM';
  const failed = later.attempts[1];
  failed.status = 'DISCARDED';
  setCounts(later);

  const audit = compareTrialLedgers({ earlier, later });
  const changed = new Map(group(audit, 'attempts').changed.map((record) => [record.id, record]));
  const completed = changed.get('attempt-completed');
  assert.equal(completed.changedFields.strategyIdentity.earlier, 'STRATEGY-A');
  assert.equal(completed.changedFields.stage.later, 'VALIDATION');
  assert.deepEqual(completed.changedFields.runIdentity.earlier, {
    provider: 'github_actions', runId: '101', runAttempt: 'UNKNOWN',
  });
  assert.deepEqual(completed.changedFields.linkedResultIdentities, {
    earlier: ['workflow:github_actions:101:UNKNOWN:DEVELOPMENT'],
    later: ['workflow:github_actions:101:2:VALIDATION'],
  });
  assert.equal(completed.suppliedRunIdentityChange.interpretation, 'SUPPLIED_IDENTITY_CHANGE_NOT_EXECUTION_EVIDENCE');
  assert.equal(changed.get('attempt-failed').changedFields.status.later, 'DISCARDED');
  const changedResult = group(audit, 'resultRecords').changed[0];
  assert.equal(changedResult.earlier.recordedOutcome, 'RECORDED_FAILURE');
  assert.equal(changedResult.later.resultIdentity, 'workflow:github_actions:101:2:VALIDATION');
});

test('keeps duplicate ids and run aliases in ambiguous groups with findings', () => {
  const earlier = ledger();
  earlier.attempts.push({
    ...structuredClone(earlier.attempts[0]),
    attemptId: 'attempt-conflicting-alias',
    strategyIdentity: 'CONFLICTING-STRATEGY',
  });
  setCounts(earlier);
  const later = structuredClone(earlier);
  later.attempts.push({ ...structuredClone(later.attempts[0]), status: 'FAILED' });
  setCounts(later);

  const audit = compareTrialLedgers({ earlier, later });
  assert.equal(audit.status, 'INVALID');
  assert.ok(group(audit, 'attempts').ambiguous.some((item) => item.id === 'attempt-completed'));
  assert.ok(audit.findings.some((finding) => finding.code === 'AMBIGUOUS_RUN_IDENTITY'));
  assert.ok(audit.findings.some((finding) => finding.code === 'DUPLICATE_RECORD_IDENTITY'
    && finding.identity === 'attempt-completed'));
  assert.ok(audit.validation.later.issues.some((issue) => issue.path === '$.attempts[3].attemptId'));
  assert.equal(group(audit, 'attempts').ambiguous[0].earlier.length, 1);
});

test('separates results, non-empirical records, proposed cells, and validator count meanings', () => {
  const earlier = ledger();
  const later = structuredClone(earlier);
  later.resultRecords[0].recordedOutcome = 'CLAIM_CHANGED';
  later.nonEmpiricalRecords[0].status = 'REVISED_DESIGN_ONLY';
  later.proposedProtocol.cells[0].availability = 'UNAVAILABLE';
  setCounts(later);
  const audit = compareTrialLedgers({ earlier, later });

  assert.equal(group(audit, 'attempts').added.length, 0);
  assert.equal(group(audit, 'resultRecords').changed[0].later.recordedOutcome, 'CLAIM_CHANGED');
  assert.equal(group(audit, 'nonEmpiricalRecords').changed[0].later.status, 'REVISED_DESIGN_ONLY');
  assert.equal(group(audit, 'proposedCells').changed[0].later.availability, 'UNAVAILABLE');
  assert.deepEqual(Object.keys(audit.validation.earlier.counts), [
    'resultRecords', 'attemptRecords', 'documentedWorkflowRunIds', 'knownRunAttemptNumbers',
    'exactDistinctAttemptIdentities', 'evaluatorClassifiedAttemptRecords', 'nonEmpiricalRecords', 'proposedCells',
  ]);
  assert.equal(audit.status, 'INVALID');
});

test('keeps UNKNOWN claims and reports an UNKNOWN-to-integer tuple only as supplied identity', () => {
  const earlier = ledger();
  const later = structuredClone(earlier);
  later.attempts[0].runIdentity.runAttempt = 1;
  later.resultRecords[0].runIdentity.runAttempt = 1;
  later.resultRecords[0].resultIdentity = 'workflow:github_actions:101:1:DEVELOPMENT';
  setCounts(later);

  const audit = compareTrialLedgers({ earlier, later });
  const change = group(audit, 'attempts').changed.find((item) => item.id === 'attempt-completed');
  assert.equal(change.suppliedRunIdentityChange.interpretation, 'SUPPLIED_IDENTITY_CHANGE_NOT_EXECUTION_EVIDENCE');
  assert.equal(audit.validation.later.remainingBudget, 'UNKNOWN');
  assert.equal(audit.differences.budget.later.submitted.countingPolicy.status, 'UNKNOWN_UNRECONCILED');
  assert.equal(audit.differences.budget.later.submitted.remaining, 'UNKNOWN');
  assert.equal(audit.differences.coverage.later.nonWorkflowAttempts.status, 'UNKNOWN_UNRECONCILED');
  assert.equal(audit.validation.later.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
});

test('retains source provenance, scope, and the complete submitted budget declaration', () => {
  const earlier = ledger();
  const later = structuredClone(earlier);
  later.sourceMainCommit = 'd'.repeat(40);
  later.sourceProvenance = 'A_DIFFERENT_ASSERTION';
  later.scope.absenceOfRecordMeansZero = true;
  later.budget.countingPolicy.policyId = 'UNRECONCILED_NEW_CLAIM';
  later.budget.remaining = 0;

  const audit = compareTrialLedgers({ earlier, later });
  assert.equal(audit.differences.declarations.changed, true);
  assert.equal(audit.differences.declarations.later.sourceMainCommit, 'd'.repeat(40));
  assert.equal(audit.differences.declarations.later.sourceProvenance, 'A_DIFFERENT_ASSERTION');
  assert.equal(audit.differences.declarations.later.scope.absenceOfRecordMeansZero, true);
  assert.equal(audit.differences.budget.later.submitted.countingPolicy.policyId, 'UNRECONCILED_NEW_CLAIM');
  assert.equal(audit.differences.budget.later.submitted.remaining, 0);
  assert.equal(audit.differences.budget.later.validationRemainingBudget, 'UNKNOWN');
  assert.equal(audit.differences.budget.later.arithmeticConsistency, 'UNRESOLVED');
});

test('returns invalid-ledger findings and safe differences for malformed rows and counts', () => {
  const earlier = ledger();
  earlier.attempts.push(null);
  earlier.reportedCounts.attemptRecords = -1;
  const later = ledger();
  const audit = compareTrialLedgers({ earlier, later });

  assert.equal(audit.status, 'INVALID');
  assert.ok(audit.validation.earlier.issues.some((issue) => issue.code === 'INVALID_ATTEMPT'
    && issue.path === '$.attempts[2]'));
  assert.ok(audit.validation.earlier.issues.some((issue) => issue.code === 'REPORTED_COUNT_MISMATCH'
    && issue.path === '$.reportedCounts'));
  assert.ok(group(audit, 'attempts').removed.some(({ id }) => id === null));
  assert.equal(audit.executionAuthorized, false);
});

test('rejects getters, shared/cyclic graphs, nonfinite values, and oversized inputs before validation', () => {
  let invoked = false;
  const accessorLedger = ledger();
  Object.defineProperty(accessorLedger, 'unsafe', {
    enumerable: true,
    get() {
      invoked = true;
      return 'bad';
    },
  });
  assert.throws(() => compareTrialLedgers({ earlier: accessorLedger, later: ledger() }), {
    code: 'ACCESSOR_OR_HIDDEN_PROPERTY',
  });
  assert.equal(invoked, false);

  const shared = ledger();
  assert.throws(() => compareTrialLedgers({ earlier: shared, later: shared }), {
    code: 'UNSAFE_OR_SHARED_JSON_VALUE',
  });
  const cyclic = ledger();
  cyclic.extra = cyclic;
  assert.throws(() => compareTrialLedgers({ earlier: cyclic, later: ledger() }), {
    code: 'UNSAFE_OR_SHARED_JSON_VALUE',
  });
  const nonfinite = ledger();
  nonfinite.extra = Number.NaN;
  assert.throws(() => compareTrialLedgers({ earlier: nonfinite, later: ledger() }), {
    code: 'NONFINITE_NUMBER',
  });
  const oversized = ledger();
  oversized.extra = 'x'.repeat(4097);
  assert.throws(() => compareTrialLedgers({ earlier: oversized, later: ledger() }), {
    code: 'STRING_LIMIT_EXCEEDED',
  });
  assert.equal(compareTrialLedgers({ earlier: null, later: ledger() }).status, 'INVALID');
});

test('CLI emits JSON on success and fails closed for malformed JSON or unsafe envelopes', () => {
  const validEnvelope = JSON.stringify({ earlier: ledger(), later: ledger() });
  const success = spawnSync(process.execPath, [cliPath], { input: validEnvelope, encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).status, 'COMPARED');

  for (const input of [
    '{',
    JSON.stringify({ earlier: ledger(), later: ledger(), extra: true }),
    JSON.stringify({ earlier: null, later: ledger() }),
  ]) {
    const failure = spawnSync(process.execPath, [cliPath], { input, encoding: 'utf8' });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /no audit was produced/);
  }
  const help = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1/);
});
