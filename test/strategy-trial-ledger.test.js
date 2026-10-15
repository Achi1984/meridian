import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrialLedger } from '../docs/strategy-lab/validate-trial-ledger.mjs';

const source = {
  id: 'source',
  path: 'docs/strategy-lab/matrix.json',
  sha: 'a'.repeat(40),
  commit: 'b'.repeat(40),
};

function fixture() {
  const attempt = {
    attemptId: 'attempt-1',
    strategyIdentity: 'STRATEGY-A',
    stage: 'DEVELOPMENT',
    attemptClass: 'STRATEGY_EVALUATION',
    status: 'COMPLETED',
    runIdentity: { provider: 'github_actions', runId: '101', runAttempt: 'UNKNOWN' },
    resultRecordRef: 'result-1',
    sourceRefs: ['source'],
  };
  const failed = {
    attemptId: 'attempt-2',
    strategyIdentity: 'STRATEGY-A',
    stage: 'DIAGNOSTIC',
    attemptClass: 'STRATEGY_EVALUATION',
    status: 'FAILED',
    runIdentity: { provider: 'github_actions', runId: '102', runAttempt: 'UNKNOWN' },
    sourceRefs: ['source'],
  };
  const ledger = {
    schemaVersion: 'MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1',
    sources: [source],
    coverage: { complete: false, gaps: ['Unreconciled historical manual attempts.'] },
    attempts: [attempt, failed],
    resultRecords: [{
      resultRecordId: 'result-1',
      resultIdentity: 'run:101:development',
      strategyIdentity: 'STRATEGY-A',
      resultKind: 'STRATEGY_PNL_RESULT',
      strategyPnlCalculated: true,
      recordedOutcome: 'RECORDED_FAILURE',
      runIdentity: attempt.runIdentity,
      attemptRef: attempt.attemptId,
      sourceRefs: ['source'],
    }],
    nonEmpiricalRecords: [],
    proposedProtocol: {
      expectedCounts: { baseline: 1, diagnostics: 2 },
      cells: [
        {
          cellId: 'BASELINE',
          cellKind: 'BASELINE',
          availability: 'PROPOSED',
          executionStatus: 'NOT_EXECUTED',
          countedInExecutedUsage: false,
          sourceRefs: ['source'],
        },
        {
          cellId: 'D3',
          cellKind: 'DIAGNOSTIC',
          availability: 'UNAVAILABLE',
          executionStatus: 'NOT_EXECUTED',
          countedInExecutedUsage: false,
          sourceRefs: ['source'],
        },
        {
          cellId: 'D6',
          cellKind: 'DIAGNOSTIC',
          availability: 'UNAVAILABLE',
          executionStatus: 'NOT_EXECUTED',
          countedInExecutedUsage: false,
          sourceRefs: ['source'],
        },
      ],
    },
    budget: {
      status: 'UNKNOWN_UNRECONCILED',
      authorizedCap: 'UNKNOWN',
      consumedAttemptRefs: 'UNKNOWN',
      remaining: 'UNKNOWN',
    },
    reportedCounts: {},
  };
  setCounts(ledger);
  return ledger;
}

function setCounts(ledger) {
  const runKeys = new Set(ledger.attempts.map((row) => (
    `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`
  )));
  const resultIds = new Set(ledger.resultRecords.map((row) => row.resultIdentity));
  const evaluatorRuns = new Set(ledger.attempts
    .filter((row) => ['STRATEGY_EVALUATION', 'FEATURE_EVALUATION', 'TECHNICAL_EVALUATION'].includes(row.attemptClass))
    .map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`));
  ledger.reportedCounts = {
    resultRecords: resultIds.size,
    attemptRecords: ledger.attempts.length,
    distinctAttemptIdentities: runKeys.size,
    evaluatorAttempts: evaluatorRuns.size,
    nonEmpiricalRecords: ledger.nonEmpiricalRecords.length,
    proposedCells: ledger.proposedProtocol.cells.length,
  };
}

const hasIssue = (validation, code) => validation.issues.some((issue) => issue.code === code);

test('accepts a bounded inventory but never authorizes execution or derives unknown budget', () => {
  const validation = validateTrialLedger(fixture());
  assert.equal(validation.valid, true);
  assert.equal(validation.inputCoverageClaim, 'INCOMPLETE');
  assert.equal(validation.completenessCertified, false);
  assert.equal(validation.executionAuthorized, false);
  assert.equal(validation.remainingBudget, 'UNKNOWN');
});

test('deduplicates repeated references to the same workflow attempt', () => {
  const ledger = fixture();
  ledger.attempts.push({ ...ledger.attempts[0], attemptId: 'attempt-1-copy' });
  setCounts(ledger);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.attemptRecords, 3);
  assert.equal(validation.counts.distinctAttemptIdentities, 2);
  assert.equal(validation.counts.evaluatorAttempts, 2);
  assert.equal(hasIssue(validation, 'DUPLICATE_ATTEMPT_REFERENCE'), true);
});

test('fails closed on conflicting records for one attempt identity', () => {
  const ledger = fixture();
  ledger.attempts.push({
    ...ledger.attempts[0],
    attemptId: 'attempt-conflict',
    status: 'CANCELLED',
  });
  setCounts(ledger);

  assert.equal(hasIssue(validateTrialLedger(ledger), 'CONFLICTING_ATTEMPT_IDENTITY'), true);
});

test('keeps distinct workflow attempt numbers distinct', () => {
  const ledger = fixture();
  ledger.attempts.push({
    ...ledger.attempts[0],
    attemptId: 'attempt-1-retry',
    resultRecordRef: undefined,
    runIdentity: { ...ledger.attempts[0].runIdentity, runAttempt: 2 },
  });
  setCounts(ledger);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.distinctAttemptIdentities, 3);
  assert.equal(validation.counts.evaluatorAttempts, 3);
});

test('rejects observed records without source provenance', () => {
  const ledger = fixture();
  ledger.attempts[0].sourceRefs = [];
  assert.equal(hasIssue(validateTrialLedger(ledger), 'SOURCE_PROVENANCE_REQUIRED'), true);
});

test('does not treat an empty consumed-attempt list as zero for an incomplete ledger', () => {
  const ledger = fixture();
  ledger.budget.consumedAttemptRefs = [];
  assert.equal(hasIssue(validateTrialLedger(ledger), 'UNKNOWN_USAGE_CANNOT_BE_ZERO'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('retains unavailable proposed cells without counting them as execution usage', () => {
  const ledger = fixture();
  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.proposedCells, 3);
  assert.equal(validation.counts.distinctAttemptIdentities, 2);
  assert.equal(ledger.proposedProtocol.cells.filter((cell) => cell.availability === 'UNAVAILABLE').length, 2);
});

test('retains failed and cancelled attempts as distinct observed events', () => {
  const ledger = fixture();
  for (const [index, status] of ['CANCELLED', 'ABORTED', 'DISCARDED'].entries()) {
    ledger.attempts.push({
      attemptId: `attempt-retained-${index}`,
      strategyIdentity: 'STRATEGY-A',
      stage: 'DIAGNOSTIC',
      attemptClass: 'STRATEGY_EVALUATION',
      status,
      runIdentity: { provider: 'github_actions', runId: String(103 + index), runAttempt: 'UNKNOWN' },
      sourceRefs: ['source'],
    });
  }
  setCounts(ledger);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.attemptRecords, 5);
  assert.equal(validation.counts.distinctAttemptIdentities, 5);
  assert.equal(validation.counts.evaluatorAttempts, 5);
});

test('rejects a reconciled budget overrun', () => {
  const ledger = fixture();
  ledger.coverage = { complete: true, gaps: [] };
  ledger.budget = {
    status: 'RECONCILED',
    authorizedCap: { value: 1, sourceRef: 'source' },
    consumedAttemptRefs: ['attempt-1', 'attempt-2'],
    remaining: 'UNKNOWN',
  };
  assert.equal(hasIssue(validateTrialLedger(ledger), 'BUDGET_OVERRUN'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('derives arithmetic only from an explicit complete-cap-and-usage input without certifying completeness', () => {
  const ledger = fixture();
  ledger.coverage = { complete: true, gaps: [] };
  ledger.budget = {
    status: 'RECONCILED',
    authorizedCap: { value: 2, sourceRef: 'source' },
    consumedAttemptRefs: ['attempt-1', 'attempt-2'],
    remaining: 0,
  };

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.inputCoverageClaim, 'CLAIMED_COMPLETE');
  assert.equal(validation.completenessCertified, false);
  assert.equal(validation.executionAuthorized, false);
  assert.equal(validation.remainingBudget, 0);
});

test('an incomplete ledger cannot report a numeric remaining budget', () => {
  const ledger = fixture();
  ledger.budget.remaining = 0;
  assert.equal(hasIssue(validateTrialLedger(ledger), 'UNKNOWN_BUDGET_NOT_PROPAGATED'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('rejects inconsistent counts and malformed inputs deterministically without mutation', () => {
  const ledger = fixture();
  ledger.reportedCounts.attemptRecords += 1;
  assert.equal(hasIssue(validateTrialLedger(ledger), 'REPORTED_COUNT_MISMATCH'), true);
  assert.deepEqual(validateTrialLedger(null), validateTrialLedger(null));

  const validLedger = fixture();
  const before = JSON.stringify(validLedger);
  const first = validateTrialLedger(validLedger);
  const second = validateTrialLedger(validLedger);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(validLedger), before);
});
