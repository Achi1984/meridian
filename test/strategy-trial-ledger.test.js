import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    coverage: {
      complete: false,
      nonWorkflowAttempts: { status: 'UNKNOWN_UNRECONCILED', sourceRefs: ['source'] },
      gaps: [{
        id: 'manual',
        gap: 'Unreconciled historical manual attempts.',
        blocks: 'Numeric budget.',
        closureSource: 'Source-backed manual attempt ledger.',
        blocksNumericBudget: true,
      }],
    },
    attempts: [attempt, failed],
    resultRecords: [{
      resultRecordId: 'result-1',
      resultIdentity: 'workflow:github_actions:101:UNKNOWN:DEVELOPMENT',
      strategyIdentity: 'STRATEGY-A',
      resultKind: 'STRATEGY_PNL_RESULT',
      strategyPnlCalculated: true,
      recordedOutcome: 'RECORDED_FAILURE',
      runIdentity: structuredClone(attempt.runIdentity),
      attemptRef: attempt.attemptId,
      sourceRefs: ['source'],
    }],
    nonEmpiricalRecords: [],
    proposedProtocol: {
      expectedCounts: { baseline: 2, diagnostics: 6 },
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
  };
  setCounts(ledger);
  return ledger;
}

function setCounts(ledger) {
  const runIds = new Set(ledger.attempts.map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}`));
  const knownRunAttemptNumbers = new Set(ledger.attempts
    .filter((row) => Number.isSafeInteger(row.runIdentity.runAttempt))
    .map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`));
  const resultIds = new Set(ledger.resultRecords.map((row) => row.resultIdentity));
  const evaluatorRecords = ledger.attempts
    .filter((row) => ['STRATEGY_EVALUATION', 'FEATURE_EVALUATION', 'TECHNICAL_EVALUATION'].includes(row.attemptClass));
  const exactAttemptCount = ledger.attempts.every((row) => Number.isSafeInteger(row.runIdentity.runAttempt))
    ? new Set(ledger.attempts.map((row) => `${row.runIdentity.provider}:${row.runIdentity.runId}:${row.runIdentity.runAttempt}`)).size
    : 'UNKNOWN';
  ledger.reportedCounts = {
    resultRecords: resultIds.size,
    attemptRecords: ledger.attempts.length,
    documentedWorkflowRunIds: runIds.size,
    knownRunAttemptNumbers: knownRunAttemptNumbers.size,
    exactDistinctAttemptIdentities: exactAttemptCount,
    evaluatorClassifiedAttemptRecords: evaluatorRecords.length,
    nonEmpiricalRecords: ledger.nonEmpiricalRecords.length,
    proposedCells: ledger.proposedProtocol.cells.length,
  };
}

const hasIssue = (validation, code) => validation.issues.some((issue) => issue.code === code);
const resultIdentity = (attempt) => `workflow:${attempt.runIdentity.provider}:${attempt.runIdentity.runId}:${attempt.runIdentity.runAttempt}:${attempt.stage}`;

function setKnownAttemptNumbers(ledger) {
  const nextAttemptNumberByRunId = new Map();
  const assignedBySignature = new Map();
  for (const attempt of ledger.attempts) {
    const runIdKey = `${attempt.runIdentity.provider}:${attempt.runIdentity.runId}`;
    const signature = JSON.stringify([
      attempt.strategyIdentity,
      attempt.stage,
      attempt.attemptClass,
      attempt.status,
      attempt.resultRecordRef ?? null,
    ]);
    const key = `${runIdKey}:${signature}`;
    if (assignedBySignature.has(key)) {
      attempt.runIdentity.runAttempt = assignedBySignature.get(key);
    } else {
      const next = nextAttemptNumberByRunId.get(runIdKey) ?? 1;
      attempt.runIdentity.runAttempt = next;
      assignedBySignature.set(key, next);
      nextAttemptNumberByRunId.set(runIdKey, next + 1);
    }
  }
  for (const record of ledger.resultRecords) {
    const attempt = ledger.attempts.find((row) => row.attemptId === record.attemptRef);
    record.runIdentity = structuredClone(attempt.runIdentity);
    record.resultIdentity = resultIdentity(attempt);
  }
}

function setReconciledBudget(ledger, cap = 10) {
  setKnownAttemptNumbers(ledger);
  ledger.coverage = {
    complete: true,
    nonWorkflowAttempts: { status: 'RECONCILED', sourceRefs: ['source'] },
    gaps: [],
  };
  ledger.budget.countingPolicy = {
    status: 'RECONCILED',
    policyId: 'TEST-COUNTING-POLICY-V1',
    includedAttemptClasses: ['STRATEGY_EVALUATION', 'FEATURE_EVALUATION', 'TECHNICAL_EVALUATION'],
    excludedAttemptClasses: ['OPERATIONAL_WORKFLOW', 'PROSPECTIVE_COLLECTION', 'MANUAL_ATTEMPT'],
    includedStatuses: ['COMPLETED', 'FAILED', 'TECHNICAL_INVALID', 'CANCELLED', 'ABORTED', 'DISCARDED'],
    excludedStatuses: [],
    sourceRefs: ['source'],
  };
  ledger.budget.authorizedCap = { value: cap, sourceRefs: ['source'] };
  ledger.budget.consumedAttemptRefs = ledger.attempts
    .filter((attempt) => ledger.budget.countingPolicy.includedAttemptClasses.includes(attempt.attemptClass)
      && ledger.budget.countingPolicy.includedStatuses.includes(attempt.status))
    .map((attempt) => attempt.attemptId);
  ledger.budget.status = 'RECONCILED';
  ledger.budget.remaining = cap - ledger.budget.consumedAttemptRefs.length;
  setCounts(ledger);
}

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
  ledger.attempts.push({ ...structuredClone(ledger.attempts[0]), attemptId: 'attempt-1-copy' });
  setCounts(ledger);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.attemptRecords, 3);
  assert.equal(validation.counts.documentedWorkflowRunIds, 2);
  assert.equal(validation.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
  assert.equal(validation.counts.evaluatorClassifiedAttemptRecords, 3);
  assert.equal(hasIssue(validation, 'DUPLICATE_ATTEMPT_REFERENCE'), true);
});

test('fails closed on conflicting records for one attempt identity', () => {
  const ledger = fixture();
  ledger.attempts.push({
    ...structuredClone(ledger.attempts[0]),
    attemptId: 'attempt-conflict',
    status: 'CANCELLED',
  });
  setCounts(ledger);

  assert.equal(hasIssue(validateTrialLedger(ledger), 'CONFLICTING_ATTEMPT_IDENTITY'), true);
});

test('keeps distinct workflow attempt numbers distinct', () => {
  const ledger = fixture();
  ledger.attempts[0].runIdentity.runAttempt = 1;
  ledger.resultRecords[0].runIdentity = structuredClone(ledger.attempts[0].runIdentity);
  ledger.resultRecords[0].resultIdentity = resultIdentity(ledger.attempts[0]);
  ledger.attempts.push({
    ...structuredClone(ledger.attempts[0]),
    attemptId: 'attempt-1-retry',
    resultRecordRef: undefined,
    runIdentity: { ...ledger.attempts[0].runIdentity, runAttempt: 2 },
  });
  setCounts(ledger);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.documentedWorkflowRunIds, 2);
  assert.equal(validation.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
  assert.equal(validation.counts.knownRunAttemptNumbers, 2);
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
  assert.equal(validation.counts.proposedCells, 8);
  assert.equal(validation.counts.documentedWorkflowRunIds, 2);
  assert.equal(validation.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
  assert.equal(ledger.proposedProtocol.cells.filter((cell) => cell.availability === 'UNAVAILABLE').length, 3);
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
  assert.equal(validation.counts.documentedWorkflowRunIds, 5);
  assert.equal(validation.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
  assert.equal(validation.counts.evaluatorClassifiedAttemptRecords, 5);
});

test('rejects a reconciled budget overrun', () => {
  const ledger = fixture();
  setReconciledBudget(ledger, 1);
  assert.equal(hasIssue(validateTrialLedger(ledger), 'BUDGET_OVERRUN'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('rejects a partial consumed set even when the cap and policy are otherwise reconciled', () => {
  const ledger = fixture();
  setReconciledBudget(ledger);
  ledger.budget.consumedAttemptRefs.pop();
  assert.equal(hasIssue(validateTrialLedger(ledger), 'CONSUMED_ATTEMPTS_MISMATCH'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('derives arithmetic only from an explicit complete-cap-and-usage input without certifying completeness', () => {
  const ledger = fixture();
  setReconciledBudget(ledger, 2);

  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, true);
  assert.equal(validation.inputCoverageClaim, 'CLAIMED_COMPLETE');
  assert.equal(validation.completenessCertified, false);
  assert.equal(validation.executionAuthorized, false);
  assert.equal(validation.remainingBudget, 0);
});

test('allows a genuinely complete empty consumed set only with a sourced policy and cap', () => {
  const ledger = fixture();
  ledger.attempts = [];
  ledger.resultRecords = [];
  ledger.nonEmpiricalRecords = [];
  setReconciledBudget(ledger, 0);
  assert.deepEqual(ledger.budget.consumedAttemptRefs, []);
  assert.equal(validateTrialLedger(ledger).valid, true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 0);
});

test('unknown runAttempt numbers prevent numeric remaining budget despite complete input claims', () => {
  const ledger = fixture();
  setReconciledBudget(ledger);
  ledger.attempts[0].runIdentity.runAttempt = 'UNKNOWN';
  const result = ledger.resultRecords[0];
  result.runIdentity = structuredClone(ledger.attempts[0].runIdentity);
  result.resultIdentity = resultIdentity(ledger.attempts[0]);

  const validation = validateTrialLedger(ledger);
  assert.equal(hasIssue(validation, 'BUDGET_NOT_RECONCILED'), true);
  assert.equal(validation.remainingBudget, 'UNKNOWN');
});

test('counting policy exclusions are explicit and invalid statuses fail closed', () => {
  const ledger = fixture();
  setReconciledBudget(ledger, 1);
  ledger.budget.countingPolicy.includedStatuses = ['COMPLETED'];
  ledger.budget.countingPolicy.excludedStatuses = ['FAILED', 'TECHNICAL_INVALID', 'CANCELLED', 'ABORTED', 'DISCARDED'];
  ledger.budget.consumedAttemptRefs = ['attempt-1'];
  ledger.budget.remaining = 0;
  assert.equal(validateTrialLedger(ledger).remainingBudget, 0);

  ledger.budget.countingPolicy.includedStatuses = ['RUNNING'];
  assert.equal(hasIssue(validateTrialLedger(ledger), 'INVALID_COUNTING_POLICY'), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');
});

test('reconciled policy consumes listed technical-invalid and discarded attempts when included', () => {
  const ledger = fixture();
  for (const [index, status] of ['TECHNICAL_INVALID', 'DISCARDED'].entries()) {
    ledger.attempts.push({
      attemptId: `attempt-counted-${index}`,
      strategyIdentity: 'STRATEGY-A',
      stage: 'DIAGNOSTIC',
      attemptClass: 'TECHNICAL_EVALUATION',
      status,
      runIdentity: { provider: 'github_actions', runId: String(103 + index), runAttempt: 'UNKNOWN' },
      sourceRefs: ['source'],
    });
  }
  setReconciledBudget(ledger, 4);
  assert.deepEqual(ledger.budget.consumedAttemptRefs, [
    'attempt-1',
    'attempt-2',
    'attempt-counted-0',
    'attempt-counted-1',
  ]);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 0);
});

test('deduplicated aliases cannot be double-counted in the reconciled consumed set', () => {
  const ledger = fixture();
  const alias = { ...structuredClone(ledger.attempts[0]), attemptId: 'attempt-1-alias' };
  ledger.attempts.push(alias);
  setReconciledBudget(ledger, 2);
  assert.equal(hasIssue(validateTrialLedger(ledger), 'DUPLICATE_ATTEMPT_REFERENCE'), true);
  ledger.budget.consumedAttemptRefs.push('attempt-1-alias');
  ledger.budget.remaining = 0;
  assert.equal(hasIssue(validateTrialLedger(ledger), 'DUPLICATE_CONSUMED_ATTEMPT'), true);
});

test('manual attempt categories explicitly block numeric budget when identities are unrepresented', () => {
  const ledger = fixture();
  assert.equal(ledger.coverage.gaps.some((gap) => gap.id === 'manual' && gap.blocksNumericBudget), true);
  assert.equal(validateTrialLedger(ledger).remainingBudget, 'UNKNOWN');

  setReconciledBudget(ledger);
  ledger.coverage.nonWorkflowAttempts.status = 'UNKNOWN_UNRECONCILED';
  const validation = validateTrialLedger(ledger);
  assert.equal(hasIssue(validation, 'BUDGET_NOT_RECONCILED'), true);
  assert.equal(validation.remainingBudget, 'UNKNOWN');
});

test('rejects malformed nested identities with shadowed toString properties without throwing', () => {
  const ledger = fixture();
  const shadowedToString = JSON.parse('{"toString":"bad"}');
  ledger.sources[0].sha = structuredClone(shadowedToString);
  ledger.sources[0].commit = structuredClone(shadowedToString);
  ledger.resultRecords[0].runIdentity.provider = structuredClone(shadowedToString);
  ledger.resultRecords[0].runIdentity.runId = structuredClone(shadowedToString);
  ledger.resultRecords[0].runIdentity.runAttempt = structuredClone(shadowedToString);
  const validation = validateTrialLedger(ledger);
  assert.equal(validation.valid, false);
  assert.equal(hasIssue(validation, 'INVALID_SOURCE'), true);
  assert.equal(hasIssue(validation, 'INVALID_RESULT_RECORD'), true);
});

test('bounds oversized consumed lists and excessive nested input before deeper traversal', () => {
  const ledger = fixture();
  ledger.budget.consumedAttemptRefs = Array(5000).fill('missing-attempt');
  assert.equal(hasIssue(validateTrialLedger(ledger), 'INPUT_LIMIT_EXCEEDED'), true);

  const deeplyNested = fixture();
  let nested = {};
  for (let index = 0; index < 40; index += 1) nested = { value: nested };
  deeplyNested.extra = nested;
  assert.equal(hasIssue(validateTrialLedger(deeplyNested), 'INPUT_LIMIT_EXCEEDED'), true);

  const longString = fixture();
  longString.extra = 'x'.repeat(4097);
  assert.equal(hasIssue(validateTrialLedger(longString), 'INPUT_LIMIT_EXCEEDED'), true);
});

test('requires canonical result identity to agree with its linked attempt', () => {
  const ledger = fixture();
  ledger.resultRecords[0].resultIdentity = 'workflow:github_actions:999:UNKNOWN:DEVELOPMENT';
  assert.equal(hasIssue(validateTrialLedger(ledger), 'ATTEMPT_RESULT_STATUS_MISMATCH'), true);
});

test('validates the committed bounded inventory separately from its source claims', () => {
  const ledger = JSON.parse(readFileSync(new URL('../docs/strategy-lab/historical-trial-ledger-20261015.json', import.meta.url), 'utf8'));
  const validation = validateTrialLedger(ledger);

  assert.equal(validation.valid, true);
  assert.equal(validation.counts.resultRecords, 12);
  assert.equal(validation.counts.attemptRecords, 20);
  assert.equal(validation.counts.documentedWorkflowRunIds, 20);
  assert.equal(validation.counts.knownRunAttemptNumbers, 0);
  assert.equal(validation.counts.exactDistinctAttemptIdentities, 'UNKNOWN');
  assert.equal(validation.counts.evaluatorClassifiedAttemptRecords, 14);
  assert.equal(validation.counts.nonEmpiricalRecords, 7);
  assert.equal(validation.counts.proposedCells, 8);
  assert.equal(validation.inputCoverageClaim, 'INCOMPLETE');
  assert.equal(validation.completenessCertified, false);
  assert.equal(validation.executionAuthorized, false);
  assert.equal(validation.remainingBudget, 'UNKNOWN');
  assert.equal(ledger.sourceProvenance, 'ASSERTED_SOURCE_REFERENCES_NOT_AUTHENTICATED_EXECUTION');
  assert.equal(ledger.budget.countingPolicy.status, 'UNKNOWN_UNRECONCILED');
  assert.equal(ledger.coverage.gaps.some((gap) => gap.id === 'manual-nonworkflow-identities' && gap.blocksNumericBudget), true);
  assert.equal(ledger.nonEmpiricalRecords.some((record) => record.identity.includes('38636260048')), true);
  assert.equal(ledger.attempts.some((attempt) => attempt.runIdentity.runId === '38636260048'), false);
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
