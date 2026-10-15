const UNKNOWN = 'UNKNOWN';
const MAX_TEXT = 4096;
const MAX_ROWS = 4096;
const MAX_SOURCES = 128;
const MAX_CELLS = 16;
const MAX_GAPS = 256;
const ATTEMPT_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'TECHNICAL_INVALID',
  'CANCELLED',
  'ABORTED',
  'DISCARDED',
]);
const ATTEMPT_CLASSES = new Set([
  'STRATEGY_EVALUATION',
  'FEATURE_EVALUATION',
  'TECHNICAL_EVALUATION',
  'OPERATIONAL_WORKFLOW',
  'PROSPECTIVE_COLLECTION',
]);
const RESULT_KINDS = new Set([
  'STRATEGY_PNL_RESULT',
  'FEATURE_EVIDENCE',
  'DATA_VALIDATION_RESULT',
]);
const COUNTED_ATTEMPT_CLASSES = new Set([
  'STRATEGY_EVALUATION',
  'FEATURE_EVALUATION',
  'TECHNICAL_EVALUATION',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_TEXT
  && value.trim().length > 0;
const runKey = (identity) => `${identity.provider}:${identity.runId}:${identity.runAttempt}`;

function result(issues, counts = {}, ledgerComplete = false, remainingBudget = UNKNOWN) {
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  return {
    valid: !hasErrors,
    status: hasErrors ? 'INVALID' : 'WELL_FORMED_INPUT',
    inputCoverageClaim: ledgerComplete ? 'CLAIMED_COMPLETE' : 'INCOMPLETE',
    completenessCertified: false,
    executionAuthorized: false,
    remainingBudget: !hasErrors ? remainingBudget : UNKNOWN,
    counts,
    issues,
  };
}

export function validateTrialLedger(input) {
  const issues = [];
  const addIssue = (code, path, message, severity = 'error') => {
    issues.push({ code, path, severity, message });
  };
  if (!isObject(input)) {
    addIssue('MALFORMED_INPUT', '$', 'Expected a JSON object.');
    return result(issues);
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  if (!Array.isArray(input.sources)) {
    addIssue('MALFORMED_INPUT', '$.sources', 'Expected an array.');
  }
  const sourceById = new Map();
  if (sources.length > MAX_SOURCES) {
    addIssue('INPUT_LIMIT_EXCEEDED', '$.sources', `At most ${MAX_SOURCES} sources are accepted.`);
  }
  for (const [index, source] of sources.slice(0, MAX_SOURCES).entries()) {
    const path = `$.sources[${index}]`;
    if (!isObject(source) || !isNonEmptyString(source.id)) {
      addIssue('INVALID_SOURCE', path, 'Source requires a non-empty id and source metadata.');
      continue;
    }
    if (sourceById.has(source.id)) {
      addIssue('DUPLICATE_SOURCE_ID', `${path}.id`, 'Source ids must be unique.');
      continue;
    }
    sourceById.set(source.id, source);
    if (!isNonEmptyString(source.path)
      || source.path.length > 1024
      || source.path.startsWith('/')
      || source.path.split('/').includes('..')
      || !/^[a-f0-9]{40}$/i.test(source.sha ?? '')
      || !/^[a-f0-9]{40}$/i.test(source.commit ?? '')) {
      addIssue('INVALID_SOURCE', path, 'Source requires a repository path, exact 40-character SHA, and commit.');
    }
  }

  const getRows = (value, path, max = MAX_ROWS) => {
    if (!Array.isArray(value)) {
      addIssue('MALFORMED_INPUT', path, 'Expected an array.');
      return [];
    }
    if (value.length > max) {
      addIssue('INPUT_LIMIT_EXCEEDED', path, `At most ${max} rows are accepted.`);
    }
    return value.slice(0, max);
  };
  const checkSourceRefs = (row, path) => {
    if (!Array.isArray(row.sourceRefs) || row.sourceRefs.length === 0) {
      addIssue('SOURCE_PROVENANCE_REQUIRED', `${path}.sourceRefs`, 'Every observed record requires source references.');
      return;
    }
    if (row.sourceRefs.length > MAX_SOURCES) {
      addIssue('INPUT_LIMIT_EXCEEDED', `${path}.sourceRefs`, `At most ${MAX_SOURCES} source references are accepted.`);
    }
    for (const [index, sourceId] of row.sourceRefs.slice(0, MAX_SOURCES).entries()) {
      if (!isNonEmptyString(sourceId) || !sourceById.has(sourceId)) {
        addIssue('UNKNOWN_SOURCE_REFERENCE', `${path}.sourceRefs[${index}]`, 'Source reference does not resolve.');
      }
    }
  };

  const attempts = getRows(input.attempts, '$.attempts');
  const attemptById = new Map();
  const attemptByRun = new Map();
  const attemptRunKeys = new Set();
  const countedAttemptKeys = new Set();
  for (const [index, attempt] of attempts.entries()) {
    const path = `$.attempts[${index}]`;
    if (!isObject(attempt) || !isNonEmptyString(attempt.attemptId)
      || !isNonEmptyString(attempt.strategyIdentity)
      || !isNonEmptyString(attempt.stage)
      || !ATTEMPT_CLASSES.has(attempt.attemptClass)
      || !ATTEMPT_STATUSES.has(attempt.status)
      || !isObject(attempt.runIdentity)
      || !isNonEmptyString(attempt.runIdentity.provider)
      || typeof attempt.runIdentity.runId !== 'string'
      || attempt.runIdentity.runId.length > 32
      || !/^\d+$/.test(attempt.runIdentity.runId)
      || !(attempt.runIdentity.runAttempt === UNKNOWN
        || (Number.isInteger(attempt.runIdentity.runAttempt) && attempt.runIdentity.runAttempt > 0))) {
      addIssue('INVALID_ATTEMPT', path, 'Attempt identity, classification, status, or run identity is invalid.');
      continue;
    }
    if (attemptById.has(attempt.attemptId)) {
      addIssue('DUPLICATE_ATTEMPT_ID', `${path}.attemptId`, 'Attempt ids must be unique.');
    } else {
      attemptById.set(attempt.attemptId, attempt);
    }
    checkSourceRefs(attempt, path);
    if (attempt.status !== 'COMPLETED' && attempt.resultRecordRef != null) {
      addIssue('ATTEMPT_RESULT_STATUS_MISMATCH', `${path}.resultRecordRef`, 'A non-completed attempt cannot claim a result record.');
    }
    const key = runKey(attempt.runIdentity);
    const previous = attemptByRun.get(key);
    if (previous) {
      const sameIdentity = previous.strategyIdentity === attempt.strategyIdentity
        && previous.stage === attempt.stage
        && previous.attemptClass === attempt.attemptClass
        && previous.status === attempt.status
        && (previous.resultRecordRef ?? null) === (attempt.resultRecordRef ?? null);
      if (sameIdentity) {
        addIssue('DUPLICATE_ATTEMPT_REFERENCE', path, 'Repeated references to one run attempt are deduplicated.', 'warning');
      } else {
        addIssue('CONFLICTING_ATTEMPT_IDENTITY', path, 'One run-attempt identity has conflicting recorded attributes.');
      }
    } else {
      attemptByRun.set(key, attempt);
    }
    attemptRunKeys.add(key);
    if (COUNTED_ATTEMPT_CLASSES.has(attempt.attemptClass)) countedAttemptKeys.add(key);
  }

  const resultRecords = getRows(input.resultRecords, '$.resultRecords');
  const resultIds = new Set();
  const resultIdentities = new Map();
  for (const [index, record] of resultRecords.entries()) {
    const path = `$.resultRecords[${index}]`;
    if (!isObject(record) || !isNonEmptyString(record.resultRecordId)
      || !isNonEmptyString(record.resultIdentity)
      || !isNonEmptyString(record.strategyIdentity)
      || !RESULT_KINDS.has(record.resultKind)
      || !isNonEmptyString(record.recordedOutcome)
      || typeof record.strategyPnlCalculated !== 'boolean'
      || !isNonEmptyString(record.attemptRef)
      || !isObject(record.runIdentity)) {
      addIssue('INVALID_RESULT_RECORD', path, 'Result record identity, outcome, and linked attempt are required.');
      continue;
    }
    if (record.strategyPnlCalculated !== (record.resultKind === 'STRATEGY_PNL_RESULT')) {
      addIssue('RESULT_KIND_STATUS_MISMATCH', `${path}.strategyPnlCalculated`, 'PnL claim must agree with the result-record kind.');
    }
    if (resultIds.has(record.resultRecordId)) {
      addIssue('DUPLICATE_RESULT_RECORD_ID', `${path}.resultRecordId`, 'Result record ids must be unique.');
    }
    resultIds.add(record.resultRecordId);
    checkSourceRefs(record, path);
    const attempt = attemptById.get(record.attemptRef);
    if (!attempt) {
      addIssue('UNKNOWN_ATTEMPT_REFERENCE', `${path}.attemptRef`, 'Result record must link to a listed attempt.');
    } else if (attempt.status !== 'COMPLETED'
      || runKey(attempt.runIdentity) !== runKey(record.runIdentity)
      || attempt.strategyIdentity !== record.strategyIdentity
      || attempt.resultRecordRef !== record.resultRecordId) {
      addIssue('ATTEMPT_RESULT_STATUS_MISMATCH', `${path}.attemptRef`, 'Result and attempt provenance or status do not agree.');
    }
    const previous = resultIdentities.get(record.resultIdentity);
    if (previous) {
      const sameResult = previous.strategyIdentity === record.strategyIdentity
        && previous.resultKind === record.resultKind
        && previous.recordedOutcome === record.recordedOutcome
        && previous.attemptRef === record.attemptRef;
      addIssue(
        sameResult ? 'DUPLICATE_RESULT_REFERENCE' : 'CONFLICTING_RESULT_IDENTITY',
        path,
        sameResult ? 'Repeated references to one result are deduplicated.' : 'One result identity has conflicting recorded attributes.',
        sameResult ? 'warning' : 'error',
      );
    } else {
      resultIdentities.set(record.resultIdentity, record);
    }
  }
  for (const [index, attempt] of attempts.entries()) {
    if (isObject(attempt) && attempt.resultRecordRef != null && !resultIds.has(attempt.resultRecordRef)) {
      addIssue('UNKNOWN_RESULT_REFERENCE', `$.attempts[${index}].resultRecordRef`, 'Attempt result reference does not resolve.');
    }
  }

  const nonEmpiricalRecords = getRows(input.nonEmpiricalRecords, '$.nonEmpiricalRecords', MAX_ROWS);
  const nonEmpiricalIds = new Set();
  for (const [index, record] of nonEmpiricalRecords.entries()) {
    const path = `$.nonEmpiricalRecords[${index}]`;
    if (!isObject(record) || !isNonEmptyString(record.recordId)
      || !isNonEmptyString(record.identity)
      || !isNonEmptyString(record.recordKind)
      || !isNonEmptyString(record.status)) {
      addIssue('INVALID_NON_EMPIRICAL_RECORD', path, 'Non-empirical record identity, kind, and status are required.');
      continue;
    }
    if (nonEmpiricalIds.has(record.recordId)) {
      addIssue('DUPLICATE_NON_EMPIRICAL_ID', `${path}.recordId`, 'Non-empirical record ids must be unique.');
    }
    nonEmpiricalIds.add(record.recordId);
    checkSourceRefs(record, path);
  }

  const cells = getRows(input.proposedProtocol?.cells, '$.proposedProtocol.cells', MAX_CELLS);
  const cellIds = new Set();
  let baselineCells = 0;
  let diagnosticCells = 0;
  for (const [index, cell] of cells.entries()) {
    const path = `$.proposedProtocol.cells[${index}]`;
    if (!isObject(cell) || !isNonEmptyString(cell.cellId)
      || !['BASELINE', 'DIAGNOSTIC'].includes(cell.cellKind)
      || !['PROPOSED', 'UNAVAILABLE'].includes(cell.availability)
      || cell.executionStatus !== 'NOT_EXECUTED'
      || cell.countedInExecutedUsage !== false) {
      addIssue('INVALID_PROPOSED_CELL', path, 'Proposed cells must remain unexecuted and outside historical usage.');
      continue;
    }
    if (cellIds.has(cell.cellId)) addIssue('DUPLICATE_CELL_ID', `${path}.cellId`, 'Proposed cell ids must be unique.');
    cellIds.add(cell.cellId);
    if (cell.cellKind === 'BASELINE') baselineCells += 1;
    else diagnosticCells += 1;
    checkSourceRefs(cell, path);
  }
  const expectedCells = input.proposedProtocol?.expectedCounts;
  if (!isObject(expectedCells)
    || expectedCells.baseline !== baselineCells
    || expectedCells.diagnostics !== diagnosticCells
    || cells.length !== baselineCells + diagnosticCells) {
    addIssue('PROPOSED_CELL_COUNT_MISMATCH', '$.proposedProtocol.expectedCounts', 'Declared and listed proposed-cell counts must agree.');
  }

  const coverage = input.coverage;
  const complete = isObject(coverage) && coverage.complete === true;
  if (!isObject(coverage) || typeof coverage.complete !== 'boolean' || !Array.isArray(coverage.gaps)) {
    addIssue('INVALID_COVERAGE', '$.coverage', 'Coverage requires a completeness flag and gap list.');
  } else if (coverage.gaps.length > MAX_GAPS) {
    addIssue('INPUT_LIMIT_EXCEEDED', '$.coverage.gaps', `At most ${MAX_GAPS} coverage gaps are accepted.`);
  } else if (!coverage.complete && coverage.gaps.length === 0) {
    addIssue('INCOMPLETE_COVERAGE_WITHOUT_GAPS', '$.coverage.gaps', 'Incomplete coverage must retain explicit gaps.');
  } else if (coverage.complete && coverage.gaps.length > 0) {
    addIssue('COMPLETE_COVERAGE_WITH_GAPS', '$.coverage.gaps', 'Complete coverage cannot retain unresolved gaps.');
  }

  const budget = input.budget;
  let derivedRemaining = UNKNOWN;
  let budgetEligible = false;
  if (!isObject(budget)) {
    addIssue('INVALID_BUDGET', '$.budget', 'Budget status is required.');
  } else {
    const capUnknown = budget.authorizedCap === UNKNOWN;
    const consumedUnknown = budget.consumedAttemptRefs === UNKNOWN;
    if (!isNonEmptyString(budget.status)) {
      addIssue('INVALID_BUDGET', '$.budget.status', 'Budget requires an explicit status.');
    }
    if (!capUnknown && (!isObject(budget.authorizedCap)
      || !Number.isInteger(budget.authorizedCap.value)
      || budget.authorizedCap.value < 0
      || !sourceById.has(budget.authorizedCap.sourceRef))) {
      addIssue('INVALID_AUTHORIZED_CAP', '$.budget.authorizedCap', 'A known cap requires a non-negative integer and provenance.');
    }
    if (!consumedUnknown && !Array.isArray(budget.consumedAttemptRefs)) {
      addIssue('INVALID_CONSUMED_ATTEMPTS', '$.budget.consumedAttemptRefs', 'Consumed attempts must be an explicit list or UNKNOWN.');
    }
    if (Array.isArray(budget.consumedAttemptRefs)) {
      const consumedKeys = new Set();
      for (const [index, attemptId] of budget.consumedAttemptRefs.entries()) {
        const attempt = attemptById.get(attemptId);
        if (!attempt) {
          addIssue('UNKNOWN_CONSUMED_ATTEMPT', `$.budget.consumedAttemptRefs[${index}]`, 'Consumed-attempt reference does not resolve.');
        } else {
          consumedKeys.add(runKey(attempt.runIdentity));
        }
      }
      if (consumedUnknown) addIssue('INVALID_CONSUMED_ATTEMPTS', '$.budget.consumedAttemptRefs', 'Invalid consumed-attempt state.');
      if (!complete && budget.consumedAttemptRefs.length === 0) {
        addIssue('UNKNOWN_USAGE_CANNOT_BE_ZERO', '$.budget.consumedAttemptRefs', 'An incomplete ledger cannot infer zero consumed attempts from an empty list.');
      }
      if (complete && !capUnknown && !issues.some((issue) => issue.severity === 'error')) {
        const remaining = budget.authorizedCap.value - consumedKeys.size;
        if (remaining < 0) {
          addIssue('BUDGET_OVERRUN', '$.budget', 'Reconciled consumed attempts exceed the authorized cap.');
        } else {
          derivedRemaining = remaining;
          budgetEligible = true;
        }
      }
    }
    if ((!complete || capUnknown || consumedUnknown) && budget.remaining !== UNKNOWN) {
      addIssue('UNKNOWN_BUDGET_NOT_PROPAGATED', '$.budget.remaining', 'Remaining budget must remain UNKNOWN without complete reconciled evidence.');
    } else if (budgetEligible && budget.remaining !== derivedRemaining) {
      addIssue('REMAINING_BUDGET_MISMATCH', '$.budget.remaining', 'Remaining budget must equal cap minus distinct consumed attempts.');
    } else if (complete && (!budgetEligible || capUnknown || consumedUnknown) && budget.remaining !== UNKNOWN) {
      addIssue('UNKNOWN_BUDGET_NOT_PROPAGATED', '$.budget.remaining', 'Remaining budget cannot be derived from incomplete prerequisites.');
    }
    if (budget.status === 'UNKNOWN_UNRECONCILED'
      && (!capUnknown || !consumedUnknown || budget.remaining !== UNKNOWN)) {
      addIssue('UNKNOWN_BUDGET_NOT_PROPAGATED', '$.budget.status', 'Unreconciled budget status requires UNKNOWN cap, usage, and remaining value.');
    }
    if (budget.status === 'RECONCILED' && (!complete || !budgetEligible)) {
      addIssue('BUDGET_NOT_RECONCILED', '$.budget.status', 'Reconciled budget requires complete coverage, authorized cap, and resolved usage.');
    }
  }

  const listedCounts = {
    resultRecords: resultIdentities.size,
    attemptRecords: attempts.length,
    distinctAttemptIdentities: attemptRunKeys.size,
    evaluatorAttempts: countedAttemptKeys.size,
    nonEmpiricalRecords: nonEmpiricalRecords.length,
    proposedCells: cells.length,
  };
  if (!isObject(input.reportedCounts)
    || Object.entries(listedCounts).some(([key, value]) => input.reportedCounts[key] !== value)) {
    addIssue('REPORTED_COUNT_MISMATCH', '$.reportedCounts', 'Reported bounded-inventory counts must match deduplicated records.');
  }

  return result(issues, listedCounts, complete, budgetEligible ? derivedRemaining : UNKNOWN);
}
