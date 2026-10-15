const UNKNOWN = 'UNKNOWN';
const MAX_TEXT = 4096;
const MAX_DEPTH = 32;
const MAX_NODES = 50000;
const MAX_ROWS = 4096;
const MAX_SOURCES = 128;
const MAX_CELLS = 16;
const MAX_GAPS = 256;
const BUDGET_STATUSES = new Set(['UNKNOWN_UNRECONCILED', 'RECONCILED']);
const PROPOSED_CELLS = new Map([
  ['BASELINE_DEVELOPMENT', ['BASELINE', 'PROPOSED']],
  ['BASELINE_HISTORICAL_HOLDOUT_AUDIT', ['BASELINE', 'PROPOSED']],
  ['D1_COST_30BPS', ['DIAGNOSTIC', 'PROPOSED']],
  ['D2_COST_40BPS', ['DIAGNOSTIC', 'PROPOSED']],
  ['D3_DELAY_1H', ['DIAGNOSTIC', 'UNAVAILABLE']],
  ['D4_DELAY_24H', ['DIAGNOSTIC', 'UNAVAILABLE']],
  ['D5_FEATURE_21D', ['DIAGNOSTIC', 'PROPOSED']],
  ['D6_FEATURE_35D', ['DIAGNOSTIC', 'UNAVAILABLE']],
]);
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
  'MANUAL_ATTEMPT',
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
const isRunIdentity = (value) => isObject(value)
  && isNonEmptyString(value.provider)
  && /^[A-Za-z0-9_.-]+$/.test(value.provider)
  && typeof value.runId === 'string'
  && value.runId.length > 0
  && value.runId.length <= 128
  && /^[A-Za-z0-9_.:-]+$/.test(value.runId)
  && (value.runAttempt === UNKNOWN
    || (Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0));
const runKey = (identity) => `${identity.provider}:${identity.runId}:${identity.runAttempt}`;
const runIdKey = (identity) => `${identity.provider}:${identity.runId}`;
const resultIdentityFor = (identity, stage) => `workflow:${runKey(identity)}:${stage}`;

function result(issues, counts = {}, inputCoverageClaim = false, remainingBudget = UNKNOWN) {
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  return {
    valid: !hasErrors,
    status: hasErrors ? 'INVALID' : 'WELL_FORMED_INPUT',
    inputCoverageClaim: inputCoverageClaim ? 'CLAIMED_COMPLETE' : 'INCOMPLETE',
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
    addIssue('MALFORMED_INPUT', '$', 'Expected a parsed JSON object.');
    return result(issues);
  }
  if (input.schemaVersion !== 'MERIDIAN_HISTORICAL_TRIAL_LEDGER_V1') {
    addIssue('MALFORMED_INPUT', '$.schemaVersion', 'Unsupported ledger schema version.');
  }
  const visited = new WeakSet();
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_NODES) {
      addIssue('INPUT_LIMIT_EXCEEDED', '$', `At most ${MAX_NODES} JSON values are accepted.`);
      return result(issues);
    }
    if (current.depth > MAX_DEPTH) {
      addIssue('INPUT_LIMIT_EXCEEDED', '$', `JSON nesting is limited to ${MAX_DEPTH} levels.`);
      return result(issues);
    }
    if (typeof current.value === 'string' && current.value.length > MAX_TEXT) {
      addIssue('INPUT_LIMIT_EXCEEDED', '$', `Strings are limited to ${MAX_TEXT} characters.`);
      return result(issues);
    }
    if (current.value === null || typeof current.value !== 'object') continue;
    if (visited.has(current.value)) {
      addIssue('MALFORMED_INPUT', '$', 'Input must be a tree-shaped JSON value.');
      return result(issues);
    }
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      if (nodes + stack.length + current.value.length > MAX_NODES) {
        addIssue('INPUT_LIMIT_EXCEEDED', '$', `At most ${MAX_NODES} JSON values are accepted.`);
        return result(issues);
      }
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else {
      const keys = Object.keys(current.value);
      if (nodes + stack.length + keys.length > MAX_NODES) {
        addIssue('INPUT_LIMIT_EXCEEDED', '$', `At most ${MAX_NODES} JSON values are accepted.`);
        return result(issues);
      }
      for (const key of keys) {
        if (key.length > MAX_TEXT) {
          addIssue('INPUT_LIMIT_EXCEEDED', '$', `Object keys are limited to ${MAX_TEXT} characters.`);
          return result(issues);
        }
        stack.push({ value: current.value[key], depth: current.depth + 1 });
      }
    }
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
      || typeof source.sha !== 'string'
      || !/^[a-f0-9]{40}$/i.test(source.sha)
      || typeof source.commit !== 'string'
      || !/^[a-f0-9]{40}$/i.test(source.commit)) {
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
  let countedAttemptRecordCount = 0;
  for (const [index, attempt] of attempts.entries()) {
    const path = `$.attempts[${index}]`;
    if (!isObject(attempt) || !isNonEmptyString(attempt.attemptId)
      || !isNonEmptyString(attempt.strategyIdentity)
      || !isNonEmptyString(attempt.stage)
      || !ATTEMPT_CLASSES.has(attempt.attemptClass)
      || !ATTEMPT_STATUSES.has(attempt.status)
      || !isRunIdentity(attempt.runIdentity)) {
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
    if (COUNTED_ATTEMPT_CLASSES.has(attempt.attemptClass)) countedAttemptRecordCount += 1;
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
      || !isRunIdentity(record.runIdentity)) {
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
      || record.resultIdentity !== resultIdentityFor(attempt.runIdentity, attempt.stage)
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
    const expectedCell = PROPOSED_CELLS.get(cell.cellId);
    if (!expectedCell || expectedCell[0] !== cell.cellKind || expectedCell[1] !== cell.availability) {
      addIssue('INVALID_PROPOSED_CELL', path, 'Cell identity, kind, and availability must match the bounded reproduction protocol.');
    }
    if (cell.cellKind === 'BASELINE') baselineCells += 1;
    else diagnosticCells += 1;
    checkSourceRefs(cell, path);
  }
  const expectedCells = input.proposedProtocol?.expectedCounts;
  if (!isObject(expectedCells)
    || expectedCells.baseline !== 2
    || expectedCells.diagnostics !== 6
    || expectedCells.baseline !== baselineCells
    || expectedCells.diagnostics !== diagnosticCells
    || cells.length !== 8
    || cells.length !== baselineCells + diagnosticCells
    || PROPOSED_CELLS.size !== cellIds.size
    || [...PROPOSED_CELLS.keys()].some((cellId) => !cellIds.has(cellId))) {
    addIssue('PROPOSED_CELL_COUNT_MISMATCH', '$.proposedProtocol.expectedCounts', 'The protocol requires exactly two baseline and six diagnostic cells with no additions or omissions.');
  }

  const coverage = input.coverage;
  const complete = isObject(coverage) && coverage.complete === true;
  if (!isObject(coverage) || typeof coverage.complete !== 'boolean' || !Array.isArray(coverage.gaps)
    || !isObject(coverage.nonWorkflowAttempts)) {
    addIssue('INVALID_COVERAGE', '$.coverage', 'Coverage requires a completeness flag, gap list, and nonworkflow-attempt reconciliation status.');
  } else if (coverage.gaps.length > MAX_GAPS) {
    addIssue('INPUT_LIMIT_EXCEEDED', '$.coverage.gaps', `At most ${MAX_GAPS} coverage gaps are accepted.`);
  } else {
    const nonWorkflow = coverage.nonWorkflowAttempts;
    if (!BUDGET_STATUSES.has(nonWorkflow.status)
      || !Array.isArray(nonWorkflow.sourceRefs)
      || nonWorkflow.sourceRefs.length === 0
      || nonWorkflow.sourceRefs.length > MAX_SOURCES
      || !nonWorkflow.sourceRefs.every((sourceId) => typeof sourceId === 'string' && sourceById.has(sourceId))) {
      addIssue('INVALID_COVERAGE', '$.coverage.nonWorkflowAttempts', 'Nonworkflow reconciliation requires an explicit status and source references.');
    }
    if (!coverage.complete && coverage.gaps.length === 0) {
      addIssue('INCOMPLETE_COVERAGE_WITHOUT_GAPS', '$.coverage.gaps', 'Incomplete coverage must retain explicit gaps.');
    }
    if (coverage.complete && coverage.gaps.length > 0) {
      addIssue('COMPLETE_COVERAGE_WITH_GAPS', '$.coverage.gaps', 'Complete coverage cannot retain unresolved gaps.');
    }
    const gapIds = new Set();
    for (const [index, gap] of coverage.gaps.entries()) {
      const path = `$.coverage.gaps[${index}]`;
      if (!isObject(gap)
        || !isNonEmptyString(gap.id)
        || !isNonEmptyString(gap.gap)
        || !isNonEmptyString(gap.blocks)
        || !isNonEmptyString(gap.closureSource)
        || typeof gap.blocksNumericBudget !== 'boolean') {
        addIssue('INVALID_COVERAGE_GAP', path, 'Coverage gaps require bounded identity, description, impact, closure source, and budget-blocking flag.');
      } else if (gapIds.has(gap.id)) {
        addIssue('DUPLICATE_COVERAGE_GAP_ID', `${path}.id`, 'Coverage gap ids must be unique.');
      } else {
        gapIds.add(gap.id);
      }
    }
  }

  const budget = input.budget;
  let derivedRemaining = UNKNOWN;
  let budgetEligible = false;
  let policyCountedKeys = new Set();
  const policy = isObject(budget) ? budget.countingPolicy : null;
  let policyReconciled = false;
  if (!isObject(policy)) {
    addIssue('INVALID_COUNTING_POLICY', '$.budget.countingPolicy', 'Sourced counting-policy status is required.');
  } else if (!BUDGET_STATUSES.has(policy.status)) {
    addIssue('INVALID_COUNTING_POLICY', '$.budget.countingPolicy.status', 'Counting policy status must be UNKNOWN_UNRECONCILED or RECONCILED.');
  } else {
    const policyHasSources = Array.isArray(policy.sourceRefs)
      && policy.sourceRefs.length > 0
      && policy.sourceRefs.length <= MAX_SOURCES
      && policy.sourceRefs.every((sourceId) => typeof sourceId === 'string' && sourceById.has(sourceId));
    if (!policyHasSources) {
      addIssue('COUNTING_POLICY_PROVENANCE_REQUIRED', '$.budget.countingPolicy.sourceRefs', 'Counting policy must cite existing sources.');
    }
    if (policy.status === 'UNKNOWN_UNRECONCILED') {
      if (policy.policyId !== UNKNOWN
        || policy.includedAttemptClasses !== UNKNOWN
        || policy.includedStatuses !== UNKNOWN
        || policy.excludedAttemptClasses !== UNKNOWN
        || policy.excludedStatuses !== UNKNOWN) {
        addIssue('INVALID_COUNTING_POLICY', '$.budget.countingPolicy', 'Unknown policy must leave policy identity and inclusion/exclusion rules UNKNOWN.');
      }
    } else {
      const validEnumList = (value, values, allowEmpty = false) => Array.isArray(value)
        && value.length <= MAX_ROWS
        && (allowEmpty || value.length > 0)
        && value.every((entry) => typeof entry === 'string' && values.has(entry))
        && new Set(value).size === value.length;
      const classesValid = validEnumList(policy.includedAttemptClasses, ATTEMPT_CLASSES)
        && validEnumList(policy.excludedAttemptClasses, ATTEMPT_CLASSES, true);
      const statusesValid = validEnumList(policy.includedStatuses, ATTEMPT_STATUSES)
        && validEnumList(policy.excludedStatuses, ATTEMPT_STATUSES, true);
      const classesOverlap = classesValid
        && policy.includedAttemptClasses.some((entry) => policy.excludedAttemptClasses.includes(entry));
      const statusesOverlap = statusesValid
        && policy.includedStatuses.some((entry) => policy.excludedStatuses.includes(entry));
      if (!isNonEmptyString(policy.policyId) || policy.policyId === UNKNOWN
        || !classesValid || !statusesValid || classesOverlap || statusesOverlap || !policyHasSources) {
        addIssue('INVALID_COUNTING_POLICY', '$.budget.countingPolicy', 'Reconciled policy requires an identified, sourced, nonconflicting class/status inclusion and exclusion rule.');
      } else {
        policyReconciled = true;
        for (const attempt of attempts) {
          if (!isObject(attempt) || !isRunIdentity(attempt.runIdentity)) continue;
          if (policy.includedAttemptClasses.includes(attempt.attemptClass)
            && !policy.excludedAttemptClasses.includes(attempt.attemptClass)
            && policy.includedStatuses.includes(attempt.status)
            && !policy.excludedStatuses.includes(attempt.status)) {
            policyCountedKeys.add(runKey(attempt.runIdentity));
          }
        }
      }
    }
  }

  if (!isObject(budget)) {
    addIssue('INVALID_BUDGET', '$.budget', 'Budget status is required.');
  } else {
    const capUnknown = budget.authorizedCap === UNKNOWN;
    const consumedUnknown = budget.consumedAttemptRefs === UNKNOWN;
    const budgetStatusValid = BUDGET_STATUSES.has(budget.status);
    if (!budgetStatusValid) addIssue('INVALID_BUDGET', '$.budget.status', 'Budget status must be UNKNOWN_UNRECONCILED or RECONCILED.');
    const capValid = !capUnknown && isObject(budget.authorizedCap)
      && Number.isSafeInteger(budget.authorizedCap.value)
      && budget.authorizedCap.value >= 0
      && Array.isArray(budget.authorizedCap.sourceRefs)
      && budget.authorizedCap.sourceRefs.length > 0
      && budget.authorizedCap.sourceRefs.length <= MAX_SOURCES
      && budget.authorizedCap.sourceRefs.every((sourceId) => typeof sourceId === 'string' && sourceById.has(sourceId));
    if (!capUnknown && !capValid) {
      addIssue('INVALID_AUTHORIZED_CAP', '$.budget.authorizedCap', 'A known cap requires a safe non-negative integer and source references.');
    }

    let consumedKeys = null;
    let consumedRefsValid = consumedUnknown;
    if (Array.isArray(budget.consumedAttemptRefs)) {
      const consumedRefs = getRows(budget.consumedAttemptRefs, '$.budget.consumedAttemptRefs');
      consumedKeys = new Set();
      consumedRefsValid = true;
      if (consumedRefs.length === 0 && !policyReconciled
        && attempts.some((attempt) => isObject(attempt) && COUNTED_ATTEMPT_CLASSES.has(attempt.attemptClass))) {
        addIssue('UNKNOWN_USAGE_CANNOT_BE_ZERO', '$.budget.consumedAttemptRefs', 'An empty list cannot ignore listed evaluator-class attempt records.');
        consumedRefsValid = false;
      }
      for (const [index, attemptId] of consumedRefs.entries()) {
        if (!isNonEmptyString(attemptId)) {
          addIssue('INVALID_CONSUMED_ATTEMPT_REFERENCE', `$.budget.consumedAttemptRefs[${index}]`, 'Consumed references must be bounded non-empty attempt ids.');
          consumedRefsValid = false;
          continue;
        }
        const attempt = attemptById.get(attemptId);
        if (!attempt || !isRunIdentity(attempt.runIdentity)) {
          addIssue('UNKNOWN_CONSUMED_ATTEMPT', `$.budget.consumedAttemptRefs[${index}]`, 'Consumed-attempt reference does not resolve to a valid run identity.');
          consumedRefsValid = false;
          continue;
        }
        const key = runKey(attempt.runIdentity);
        if (consumedKeys.has(key)) {
          addIssue('DUPLICATE_CONSUMED_ATTEMPT', `$.budget.consumedAttemptRefs[${index}]`, 'Consumed references must not alias the same run attempt.');
          consumedRefsValid = false;
        }
        consumedKeys.add(key);
      }
      if (!policyReconciled) {
        addIssue('COUNTING_POLICY_REQUIRED', '$.budget.consumedAttemptRefs', 'Consumed usage cannot be reconciled without a sourced counting policy.');
        consumedRefsValid = false;
      } else {
        const sameSet = consumedKeys.size === policyCountedKeys.size
          && [...policyCountedKeys].every((key) => consumedKeys.has(key));
        if (!sameSet) {
          addIssue('CONSUMED_ATTEMPTS_MISMATCH', '$.budget.consumedAttemptRefs', 'Consumed references must exactly match all policy-counted observed attempts.');
          consumedRefsValid = false;
        }
      }
    } else if (!consumedUnknown) {
      addIssue('INVALID_CONSUMED_ATTEMPTS', '$.budget.consumedAttemptRefs', 'Consumed attempts must be a bounded list or UNKNOWN.');
    }

    const countedAttemptNumbersKnown = policyReconciled && attempts.every((attempt) => (
      isObject(attempt)
      && isRunIdentity(attempt.runIdentity)
      && (!policy.includedAttemptClasses.includes(attempt.attemptClass)
        || policy.excludedAttemptClasses.includes(attempt.attemptClass)
        || !policy.includedStatuses.includes(attempt.status)
        || policy.excludedStatuses.includes(attempt.status)
        || Number.isSafeInteger(attempt.runIdentity.runAttempt))
    ));
    const blockingCoverageGap = isObject(coverage) && Array.isArray(coverage.gaps)
      && coverage.gaps.some((gap) => isObject(gap) && gap.blocksNumericBudget === true);
    const nonWorkflowReconciled = isObject(coverage?.nonWorkflowAttempts)
      && coverage.nonWorkflowAttempts.status === 'RECONCILED'
      && Array.isArray(coverage.nonWorkflowAttempts.sourceRefs)
      && coverage.nonWorkflowAttempts.sourceRefs.length > 0
      && coverage.nonWorkflowAttempts.sourceRefs.every((sourceId) => typeof sourceId === 'string' && sourceById.has(sourceId));
    const prerequisitesKnown = complete && !blockingCoverageGap && nonWorkflowReconciled && policyReconciled
      && countedAttemptNumbersKnown && capValid && consumedRefsValid && consumedKeys !== null;

    if (budget.status === 'UNKNOWN_UNRECONCILED') {
      if (budget.remaining !== UNKNOWN) {
        addIssue('UNKNOWN_BUDGET_NOT_PROPAGATED', '$.budget.remaining', 'Unreconciled budget must remain UNKNOWN.');
      }
      if (capUnknown && budget.consumedAttemptRefs === UNKNOWN
        && isObject(policy) && policy.status === 'UNKNOWN_UNRECONCILED') {
        if (!policyReconciled) {
          issues.push({
            code: 'BUDGET_PREREQUISITE_UNKNOWN',
            path: '$.budget',
            severity: 'warning',
            message: 'Authorized cap, counting policy, complete coverage, and exact attempt identities are unresolved.',
          });
        }
      } else if (prerequisitesKnown) {
        issues.push({
          code: 'BUDGET_RECONCILIATION_AVAILABLE',
          path: '$.budget.status',
          severity: 'warning',
          message: 'Input supplies reconciled prerequisites but budget status remains UNKNOWN_UNRECONCILED.',
        });
      }
    } else if (!prerequisitesKnown || !budgetStatusValid) {
      addIssue('BUDGET_NOT_RECONCILED', '$.budget.status', 'Numeric budget requires complete workflow and nonworkflow coverage, a sourced RECONCILED policy/cap, exact usage set, and known attempt numbers.');
    } else {
      const remaining = budget.authorizedCap.value - consumedKeys.size;
      if (remaining < 0) {
        addIssue('BUDGET_OVERRUN', '$.budget', 'Reconciled consumed attempts exceed the authorized cap.');
      } else if (!Number.isSafeInteger(budget.remaining) || budget.remaining !== remaining) {
        addIssue('REMAINING_BUDGET_MISMATCH', '$.budget.remaining', 'Remaining budget must equal cap minus distinct consumed attempts.');
      } else {
        derivedRemaining = remaining;
        budgetEligible = true;
      }
    }
    if (budget.status === 'UNKNOWN_UNRECONCILED'
      && (!capUnknown || !consumedUnknown || !isObject(policy) || policy.status !== 'UNKNOWN_UNRECONCILED')
      && !prerequisitesKnown && budget.remaining !== UNKNOWN) {
      addIssue('UNKNOWN_BUDGET_NOT_PROPAGATED', '$.budget.remaining', 'Unknown budget prerequisites require UNKNOWN remaining value.');
    }
  }

  const documentedWorkflowRunIds = new Set(attempts
    .filter((attempt) => isObject(attempt) && isRunIdentity(attempt.runIdentity))
    .map((attempt) => runIdKey(attempt.runIdentity)));
  const knownAttemptNumbers = new Set(attempts
    .filter((attempt) => isObject(attempt) && isRunIdentity(attempt.runIdentity)
      && Number.isSafeInteger(attempt.runIdentity.runAttempt))
    .map((attempt) => runKey(attempt.runIdentity)));
  const hasUnknownAttemptNumber = attempts.some((attempt) => !isObject(attempt)
    || !isRunIdentity(attempt.runIdentity)
    || attempt.runIdentity.runAttempt === UNKNOWN);
  const listedCounts = {
    resultRecords: resultIdentities.size,
    attemptRecords: attempts.length,
    documentedWorkflowRunIds: documentedWorkflowRunIds.size,
    knownRunAttemptNumbers: knownAttemptNumbers.size,
    exactDistinctAttemptIdentities: hasUnknownAttemptNumber ? UNKNOWN : attemptRunKeys.size,
    evaluatorClassifiedAttemptRecords: countedAttemptRecordCount,
    nonEmpiricalRecords: nonEmpiricalRecords.length,
    proposedCells: cells.length,
  };
  if (!isObject(input.reportedCounts)
    || Object.entries(listedCounts).some(([key, value]) => input.reportedCounts[key] !== value)
    || Object.entries(input.reportedCounts).some(([key, value]) => (
      !Object.hasOwn(listedCounts, key) || typeof value !== 'number' && value !== UNKNOWN
    ))
    || Object.values(input.reportedCounts).some((value) => (
      typeof value === 'number' && !Number.isSafeInteger(value)
    ))) {
    addIssue('REPORTED_COUNT_MISMATCH', '$.reportedCounts', 'Reported bounded-inventory counts must match deduplicated records.');
  }

  return result(issues, listedCounts, complete, budgetEligible ? derivedRemaining : UNKNOWN);
}
