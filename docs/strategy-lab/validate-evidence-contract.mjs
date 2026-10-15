const STAGES = Object.freeze([
  'IDEA',
  'RESEARCH',
  'BACKTEST',
  'OUT_OF_SAMPLE_HOLDOUT',
  'PAPER_BOT',
  'FORWARD_VALIDATION',
  'ROBUSTNESS_REVIEW',
  'LIVE_CANDIDATE'
]);
const AUTHORITY_FLAGS = Object.freeze([
  'canonicalExecutionAuthorized',
  'strategyPnlAuthorized',
  'discoveryAuthorized',
  'validationAuthorized',
  'holdoutAuthorized',
  'paperAuthorized',
  'liveAuthorized'
]);
const METRICS = Object.freeze([
  'NET_EXPECTANCY',
  'PROFIT_FACTOR',
  'DRAWDOWN',
  'SHARPE',
  'SORTINO',
  'TAIL_RISK',
  'COST_SENSITIVITY',
  'REGIME_STABILITY',
  'TIME_STABILITY',
  'ASSET_STABILITY',
  'UNCERTAINTY',
  'SAMPLE_DEPENDENCE',
  'SELECTION_RISK'
]);
const CORE_METRICS = new Set([
  'NET_EXPECTANCY', 'DRAWDOWN', 'TAIL_RISK', 'COST_SENSITIVITY',
  'UNCERTAINTY', 'SAMPLE_DEPENDENCE', 'SELECTION_RISK'
]);
const NEXT_EVIDENCE = Object.freeze({
  IDEA: ['Versioned hypothesis, entry/exit, risk and invalidation policy.'],
  RESEARCH: ['Source and data references with declared assumptions and market conditions.'],
  BACKTEST: ['Frozen rules, a development receipt, sample description and predeclared criteria.'],
  OUT_OF_SAMPLE_HOLDOUT: ['Holdout access history, declared data disjointness, and an untuned outcome or diagnostic record.'],
  PAPER_BOT: ['A frozen Paper setup with a prospective observation window and separate Paper authorization.'],
  FORWARD_VALIDATION: ['Completed forward observations recorded after their data window and availability.'],
  ROBUSTNESS_REVIEW: ['Forward evidence, cost sensitivity, stability, uncertainty and retained trial history.'],
  LIVE_CANDIDATE: ['A separate candidacy review; operational and authority gates remain independent.']
});
const NON_PROMOTABLE_IDS = new Set([
  'baseline-6-2',
  'shadow-v1',
  'regime-v1',
  'elliott-wave-5',
  'breakout-v1',
  'taker-flow-v1',
  'taker-flow-v2',
  'regime-grid-v2',
  'low-volatility-rank-weighted-v2-frozen'
]);
const HASH = /^[a-f\d]{64}$/i;
const COMMIT = /^[a-f\d]{40}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const parsedTimestamp = value => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value))
  ? Date.parse(value) : NaN;
const timestamp = value => Number.isFinite(parsedTimestamp(value));
const hashStatus = value => typeof value === 'string' && HASH.test(value)
  ? 'HASH_FORMAT_VALID_UNAUTHENTICATED'
  : 'MISSING_OR_INVALID';

function copyInput(value) {
  const seen = new WeakSet();
  let count = 0;
  let bytes = 0;
  function copy(item, depth) {
    count++;
    if (count > 4096 || depth > 12 || bytes > 65536) throw new Error('INPUT_BOUND');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') {
      bytes += Buffer.byteLength(item, 'utf8');
      if (Buffer.byteLength(item, 'utf8') > 8192 || bytes > 65536) throw new Error('INPUT_BOUND');
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('INPUT_NUMBER');
      return item;
    }
    if (typeof item !== 'object' || seen.has(item)) throw new Error('INPUT_SHAPE');
    seen.add(item);
    if (Array.isArray(item)) {
      const keys = Reflect.ownKeys(item);
      if (item.length > 128 || keys.length !== item.length + 1 ||
        keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) {
        throw new Error('INPUT_BOUND');
      }
      const result = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('INPUT_SHAPE');
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('INPUT_SHAPE');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 64 || keys.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) {
      throw new Error('INPUT_SHAPE');
    }
    const result = {};
    for (const key of keys) {
      bytes += Buffer.byteLength(key, 'utf8');
      if (bytes > 65536) throw new Error('INPUT_BOUND');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('INPUT_SHAPE');
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  return copy(value, 0);
}

function normalizedId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function validateEvidenceContract(input) {
  const issues = [];
  const add = (path, status, reason) => issues.push({path, status, reason});
  let value;
  try {
    value = copyInput(input);
  } catch (error) {
    add('input', 'INVALID', error.message === 'INPUT_NUMBER' ? 'NONFINITE_NUMBER' : 'UNSAFE_OR_UNBOUNDED_SHAPE');
    return result();
  }
  if (!object(value)) {
    add('input', 'INVALID', 'OBJECT_REQUIRED');
    return result();
  }

  function result() {
    const lifecycle = object(value?.lifecycle) ? value.lifecycle : {};
    const receipts = Array.isArray(lifecycle.receipts) ? lifecycle.receipts : [];
    const currentStage = typeof lifecycle.currentStage === 'string' && STAGES.includes(lifecycle.currentStage)
      ? lifecycle.currentStage : null;
    const nextStage = currentStage ? STAGES[STAGES.indexOf(currentStage) + 1] ?? null : null;
    const missing = issues.filter(issue => issue.status === 'MISSING').length;
    const notAssessed = issues.filter(issue => issue.status === 'NOT_ASSESSED').length;
    const failed = issues.filter(issue => issue.status === 'FAILED').length;
    const inconclusive = issues.filter(issue => issue.status === 'INCONCLUSIVE').length;
    const invalid = issues.filter(issue => issue.status === 'INVALID').length;
    const presentAsserted = issues.filter(issue => issue.status === 'PRESENT_ASSERTED').length;
    const checkpointIssues = issues.filter(issue => issue.path.startsWith('checkpoint.') &&
      ['INVALID', 'MISSING'].includes(issue.status));
    const holdout = receipts.find(receipt => object(receipt) && receipt.stage === 'OUT_OF_SAMPLE_HOLDOUT');
    const holdoutIndependence = assessHoldout(holdout, value?.strategy?.frozenAt, value?.asOf);
    const edgeHealth = assessEdgeHealth(value?.edgeHealth);
    const crvAssessment = assessTradePlanPolicy(value?.strategy);
    return {
      lifecycle: {
        claimedStage: currentStage,
        claimedNextStage: nextStage,
        provenance: 'UNVERIFIED_CALLER_SUPPLIED',
        receipts: receipts.filter(object).map(receipt => ({
          stage: receipt.stage ?? null,
          kind: receipt.kind ?? null,
          claimedStatus: receipt.status ?? null,
          receiptRef: receipt.receiptRef ?? null,
          recordedAt: receipt.recordedAt ?? null,
          metrics: Array.isArray(receipt.metrics) ? receipt.metrics.filter(object).map(metric => ({
            name: metric.name ?? null,
            applicability: metric.applicability ?? null,
            value: metric.value ?? null,
            unit: metric.unit ?? null,
            denominator: metric.denominator ?? null,
            reason: metric.reason ?? null
          })) : []
        }))
      },
      evidenceCompleteness: {
        status: invalid ? 'INVALID' : missing ? 'INCOMPLETE' : failed ? 'FAILED' : inconclusive ? 'INCONCLUSIVE' :
          notAssessed ? 'NOT_ASSESSED' : 'ASSERTED_WELL_FORMED',
        counts: {
          required: presentAsserted + missing + notAssessed + failed + inconclusive + invalid,
          presentAsserted, missing, notAssessed, failed, inconclusive, invalid
        },
        issues
      },
      edgeHealth,
      holdoutIndependence,
      tradePlanPolicy: crvAssessment,
      operationalReadiness: 'NOT_ASSESSED',
      checkpointBinding: !value?.checkpoint || checkpointIssues.length ? 'BLOCKED' : 'UNVERIFIED_CALLER_SUPPLIED',
      provenanceVerified: false,
      syntheticFixture: value?.syntheticFixture === true,
      authority: {
        source: 'OFFLINE_ADVISORY',
        executionAuthorized: false,
        autoPromotion: false
      },
      nextRequiredEvidence: nextStage && Object.hasOwn(NEXT_EVIDENCE, nextStage)
        ? NEXT_EVIDENCE[nextStage] : []
    };
  }

  function required(condition, path, reason) {
    if (!condition) add(path, 'MISSING', reason);
    else add(path, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
  }

  function exactShape(item, path, requiredKeys, optionalKeys = []) {
    if (!object(item)) {
      add(path, 'MISSING', 'OBJECT_REQUIRED');
      return false;
    }
    for (const key of requiredKeys) required(Object.hasOwn(item, key), `${path}.${key}`, 'FIELD_REQUIRED');
    for (const key of Object.keys(item)) {
      if (!requiredKeys.includes(key) && !optionalKeys.includes(key)) add(`${path}.${key}`, 'INVALID', 'UNKNOWN_FIELD');
    }
    return true;
  }

  function validText(item, path) {
    if (text(item)) add(path, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
    else add(path, 'MISSING', 'NONEMPTY_TEXT_REQUIRED');
  }

  function validEnum(item, allowed, path) {
    if (allowed.includes(item)) add(path, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
    else add(path, 'INVALID', 'UNKNOWN_ENUM');
  }

  function validId(item, path) {
    if (typeof item === 'string' && IDENTIFIER.test(item)) add(path, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
    else add(path, 'INVALID', 'INVALID_IDENTIFIER');
  }

  if (!exactShape(value, 'input', ['schemaVersion', 'asOf', 'checkpoint', 'strategy', 'lifecycle'],
    ['syntheticFixture', 'edgeHealth', 'migrationAnnotation', 'trialLedger'])) return result();
  if (value.schemaVersion !== 'MERIDIAN_PAPER_FIRST_EVIDENCE_V2') add('schemaVersion', 'INVALID', 'UNSUPPORTED_SCHEMA');
  if (!timestamp(value.asOf)) add('asOf', 'NOT_ASSESSED', 'VALID_AS_OF_REQUIRED');
  if (Object.hasOwn(value, 'syntheticFixture') && typeof value.syntheticFixture !== 'boolean') {
    add('syntheticFixture', 'INVALID', 'BOOLEAN_REQUIRED');
  }
  validateCheckpoint(value.checkpoint);
  validateStrategy(value.strategy);
  validateLifecycle(value.lifecycle);
  validateTrialLedger(value.trialLedger);
  validateMigrationAnnotation(value.migrationAnnotation);
  return result();

  function validateCheckpoint(checkpoint) {
    if (!exactShape(checkpoint, 'checkpoint', ['id', 'mainSha', 'stage', 'sourceOnly', 'flags'])) return;
    if (checkpoint.id !== 'MERIDIAN_LIVE_CHECKPOINT') add('checkpoint.id', 'INVALID', 'UNKNOWN_CHECKPOINT');
    if (typeof checkpoint.mainSha !== 'string' || !COMMIT.test(checkpoint.mainSha)) {
      add('checkpoint.mainSha', 'INVALID', 'INVALID_COMMIT_REFERENCE');
    }
    if (checkpoint.stage !== 'SOURCE_AUDIT') add('checkpoint.stage', 'INVALID', 'CHECKPOINT_NOT_SOURCE_AUDIT');
    if (checkpoint.sourceOnly !== true) add('checkpoint.sourceOnly', 'INVALID', 'SOURCE_ONLY_REQUIRED');
    if (!exactShape(checkpoint.flags, 'checkpoint.flags', AUTHORITY_FLAGS)) return;
    for (const flag of AUTHORITY_FLAGS) {
      if (checkpoint.flags[flag] !== false) add(`checkpoint.flags.${flag}`, 'INVALID', 'AUTHORITY_CONFLICT');
      else add(`checkpoint.flags.${flag}`, 'PRESENT_ASSERTED', 'DENIAL_ASSERTION_UNVERIFIED');
    }
  }

  function validateStrategy(strategy) {
    const strategyKeys = [
      'id', 'version', 'hypothesis', 'entry', 'exit', 'riskPolicy', 'positionSizing',
      'costAssumptions', 'marketConditions', 'telemetry', 'invalidationConditions',
      'frozenAt', 'disposition', 'rulesRef', 'tradePlanPolicy'
    ];
    if (!exactShape(strategy, 'strategy', strategyKeys)) return;
    validId(strategy.id, 'strategy.id');
    validId(strategy.version, 'strategy.version');
    validText(strategy.hypothesis, 'strategy.hypothesis');
    validText(strategy.entry, 'strategy.entry');
    validText(strategy.exit, 'strategy.exit');
    if (!timestamp(strategy.frozenAt)) add('strategy.frozenAt', 'INVALID', 'INVALID_TIMESTAMP');
    validEnum(strategy.disposition, [
      'NEW_HYPOTHESIS', 'EXISTING_RETROSPECTIVE', 'FROZEN_FAILED',
      'FROZEN_REFERENCE', 'UNRESOLVED'
    ], 'strategy.disposition');
    if (typeof strategy.id === 'string' && NON_PROMOTABLE_IDS.has(normalizedId(strategy.id))) {
      add('strategy.id', 'INVALID', 'KNOWN_FROZEN_OR_REFERENCE_ID');
    }
    if (strategy.disposition !== 'NEW_HYPOTHESIS') {
      add('strategy.disposition', 'NOT_ASSESSED', 'HISTORICAL_RECONCILIATION_ONLY');
    }
    if (exactShape(strategy.rulesRef, 'strategy.rulesRef', ['id', 'sha256'])) {
      validId(strategy.rulesRef.id, 'strategy.rulesRef.id');
      const status = hashStatus(strategy.rulesRef.sha256);
      add('strategy.rulesRef.sha256', status === 'MISSING_OR_INVALID' ? 'INVALID' : 'PRESENT_ASSERTED', status);
    }
    validateRisk(strategy.riskPolicy);
    validateSizing(strategy.positionSizing);
    validateCosts(strategy.costAssumptions);
    validateTextList(strategy.marketConditions, 'strategy.marketConditions');
    validateTextList(strategy.telemetry, 'strategy.telemetry');
    validateTextList(strategy.invalidationConditions, 'strategy.invalidationConditions');
    validateTradePlanPolicy(strategy.tradePlanPolicy, strategy.riskPolicy);
  }

  function validateRisk(risk) {
    if (!exactShape(risk, 'strategy.riskPolicy', [
      'type', 'policy', 'stopDefinition', 'justification', 'maxLossBound', 'source'
    ])) return;
    validEnum(risk.type, ['STOP_BASED', 'PORTFOLIO_LEVEL_NO_STOP'], 'strategy.riskPolicy.type');
    validText(risk.policy, 'strategy.riskPolicy.policy');
    if (risk.type === 'STOP_BASED') {
      validText(risk.stopDefinition, 'strategy.riskPolicy.stopDefinition');
      validText(risk.justification, 'strategy.riskPolicy.justification');
      required(text(risk.maxLossBound), 'strategy.riskPolicy.maxLossBound', 'EXPLICIT_RISK_BOUND_REQUIRED');
      validText(risk.source, 'strategy.riskPolicy.source');
    } else if (risk.type === 'PORTFOLIO_LEVEL_NO_STOP') {
      if (risk.stopDefinition !== null) add('strategy.riskPolicy.stopDefinition', 'INVALID', 'NO_STOP_POLICY_MUST_NOT_INVENT_STOP');
      validText(risk.justification, 'strategy.riskPolicy.justification');
      validText(risk.maxLossBound, 'strategy.riskPolicy.maxLossBound');
      validText(risk.source, 'strategy.riskPolicy.source');
    }
  }

  function validateSizing(sizing) {
    if (!exactShape(sizing, 'strategy.positionSizing', ['method', 'unit', 'policy', 'source'])) return;
    for (const key of ['method', 'unit', 'policy', 'source']) validText(sizing[key], `strategy.positionSizing.${key}`);
  }

  function validateCosts(costs) {
    const keys = ['fee', 'spread', 'slippage', 'funding', 'borrow'];
    if (!exactShape(costs, 'strategy.costAssumptions', keys)) return;
    for (const key of keys) {
      const cost = costs[key];
      const path = `strategy.costAssumptions.${key}`;
      if (!exactShape(cost, path, ['status', 'value', 'unit', 'source', 'reason'])) continue;
      validEnum(cost.status, ['ASSUMED', 'NOT_APPLICABLE', 'UNKNOWN'], `${path}.status`);
      if (cost.status === 'ASSUMED') {
        if (typeof cost.value !== 'number' || !Number.isFinite(cost.value)) add(`${path}.value`, 'INVALID', 'FINITE_ASSERTED_ASSUMPTION_REQUIRED');
        validText(cost.unit, `${path}.unit`);
        validText(cost.source, `${path}.source`);
        if (cost.reason !== null) add(`${path}.reason`, 'INVALID', 'REASON_MUST_BE_NULL_FOR_ASSUMPTION');
      } else {
        if (cost.value !== null || cost.unit !== null || cost.source !== null) add(path, 'INVALID', 'UNKNOWN_OR_NOT_APPLICABLE_SHAPE');
        validText(cost.reason, `${path}.reason`);
      }
    }
  }

  function validateTextList(list, path) {
    if (!Array.isArray(list) || list.length === 0 || list.length > 16) {
      add(path, 'MISSING', 'NONEMPTY_TEXT_LIST_REQUIRED');
      return;
    }
    list.forEach((item, index) => validText(item, `${path}[${index}]`));
  }

  function validateTradePlanPolicy(policy, risk) {
    if (!exactShape(policy, 'strategy.tradePlanPolicy', ['policyId', 'source', 'applicability', 'status', 'reason'])) return;
    if (policy.policyId !== 'PLANNED_NET_CRV_MIN_3_V1') add('strategy.tradePlanPolicy.policyId', 'INVALID', 'UNKNOWN_POLICY_ID');
    if (policy.source !== 'docs/strategy-lab/TRADE_PLAN_CRV.md') add('strategy.tradePlanPolicy.source', 'INVALID', 'UNKNOWN_POLICY_SOURCE');
    validEnum(policy.applicability, [
      'APPLICABLE_FINITE_TRADE_PAYOFF',
      'NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF',
      'UNRESOLVED_POLICY_APPLICABILITY'
    ], 'strategy.tradePlanPolicy.applicability');
    validEnum(policy.status, ['ASSERTED_UNVERIFIED', 'NOT_ASSESSED'], 'strategy.tradePlanPolicy.status');
    if (policy.applicability === 'APPLICABLE_FINITE_TRADE_PAYOFF' && risk?.type !== 'STOP_BASED') {
      add('strategy.tradePlanPolicy.applicability', 'INVALID', 'FINITE_PAYOFF_RISK_MISMATCH');
    }
    if (policy.applicability === 'NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF' && risk?.type !== 'PORTFOLIO_LEVEL_NO_STOP') {
      add('strategy.tradePlanPolicy.applicability', 'INVALID', 'NO_STOP_POLICY_MISMATCH');
    }
    if (policy.applicability !== 'APPLICABLE_FINITE_TRADE_PAYOFF') validText(policy.reason, 'strategy.tradePlanPolicy.reason');
    else if (policy.reason !== null) add('strategy.tradePlanPolicy.reason', 'INVALID', 'REASON_MUST_BE_NULL_FOR_APPLICABLE_POLICY');
  }

  function validateLifecycle(lifecycle) {
    if (!exactShape(lifecycle, 'lifecycle', ['currentStage', 'receipts'])) return;
    validEnum(lifecycle.currentStage, STAGES, 'lifecycle.currentStage');
    const currentIndex = STAGES.indexOf(lifecycle.currentStage);
    if (!Array.isArray(lifecycle.receipts) || lifecycle.receipts.length > STAGES.length) {
      add('lifecycle.receipts', 'INVALID', 'INVALID_RECEIPT_LIST');
      return;
    }
    if (currentIndex >= 0 && lifecycle.receipts.length !== currentIndex + 1) {
      add('lifecycle.receipts', 'MISSING', 'CONTIGUOUS_STAGE_RECEIPTS_REQUIRED');
    }
    const ids = new Set();
    let previousRecordedAt = -Infinity;
    let developmentRef = null;
    let holdoutRef = null;
    let forwardEnd = -Infinity;
    const dataReferenceIdentities = new Map();
    const datasetDigests = new Map();
    const stageKeys = [
      'stage', 'kind', 'status', 'receiptRef', 'recordedAt', 'strategyId',
      'strategyVersion', 'rulesRef',
      'dataRef', 'dataWindow', 'plannedWindow', 'preregistration', 'sample',
      'metrics', 'holdoutAccess', 'resultReason'
    ];
    for (let index = 0; index < lifecycle.receipts.length; index++) {
      const receipt = lifecycle.receipts[index];
      const path = `lifecycle.receipts[${index}]`;
      if (!exactShape(receipt, path, stageKeys)) continue;
      const stage = STAGES[index];
      if (receipt.stage !== stage) add(`${path}.stage`, 'INVALID', 'STAGE_ORDER_OR_SKIP');
      validEnum(receipt.stage, STAGES, `${path}.stage`);
      validId(receipt.receiptRef, `${path}.receiptRef`);
      if (ids.has(receipt.receiptRef)) add(`${path}.receiptRef`, 'INVALID', 'DUPLICATE_RECEIPT_REFERENCE');
      ids.add(receipt.receiptRef);
      if (receipt.strategyId !== value.strategy?.id || receipt.strategyVersion !== value.strategy?.version) {
        add(`${path}.strategyVersion`, 'INVALID', 'STRATEGY_IDENTITY_MISMATCH');
      }
      if (!timestamp(receipt.recordedAt)) {
        add(`${path}.recordedAt`, 'INVALID', 'INVALID_TIMESTAMP');
      } else {
        const recorded = parsedTimestamp(receipt.recordedAt);
        if (recorded > parsedTimestamp(value.asOf)) add(`${path}.recordedAt`, 'INVALID', 'FUTURE_RECORDING');
        if (recorded < previousRecordedAt) add(`${path}.recordedAt`, 'INVALID', 'NON_MONOTONIC_STAGE_TIME');
        previousRecordedAt = recorded;
      }
      validateRulesRef(receipt.rulesRef, `${path}.rulesRef`);
      if (object(receipt.dataRef) && text(receipt.dataRef.id) && text(receipt.dataRef.datasetId) &&
        hashStatus(receipt.dataRef.sha256) !== 'MISSING_OR_INVALID') {
        const digest = receipt.dataRef.sha256.toLowerCase();
        const identity = `${receipt.dataRef.datasetId}\0${digest}`;
        const priorIdentity = dataReferenceIdentities.get(receipt.dataRef.id);
        if (priorIdentity && priorIdentity !== identity) {
          add(`${path}.dataRef.id`, 'INVALID', 'DATA_REFERENCE_IDENTITY_CONFLICT');
        } else dataReferenceIdentities.set(receipt.dataRef.id, identity);
        const priorDigest = datasetDigests.get(receipt.dataRef.datasetId);
        if (priorDigest && priorDigest !== digest) {
          add(`${path}.dataRef.datasetId`, 'INVALID', 'DATASET_DIGEST_CONFLICT');
        } else datasetDigests.set(receipt.dataRef.datasetId, digest);
      }
      if (receipt.status === 'FAILED') add(`${path}.status`, 'FAILED', 'CLAIMED_EVIDENCE_FAILED');
      else if (receipt.status === 'INCONCLUSIVE') add(`${path}.status`, 'INCONCLUSIVE', 'CLAIMED_EVIDENCE_INCONCLUSIVE');
      else if (receipt.status === 'NOT_ASSESSED') add(`${path}.status`, 'NOT_ASSESSED', 'OUTCOME_NOT_ASSESSED');
      else if (['PRESENT_ASSERTED', 'SETUP_RECORDED'].includes(receipt.status)) add(`${path}.status`, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
      else add(`${path}.status`, 'INVALID', 'UNKNOWN_EVIDENCE_STATUS');
      validText(receipt.resultReason, `${path}.resultReason`);

      if (stage === 'PAPER_BOT') {
        validatePaperSetup(receipt, path);
      } else if (['BACKTEST', 'OUT_OF_SAMPLE_HOLDOUT', 'FORWARD_VALIDATION', 'ROBUSTNESS_REVIEW'].includes(stage)) {
        validateOutcome(receipt, path, stage);
      } else {
        if (receipt.kind !== 'DESIGN' && receipt.kind !== 'CANDIDACY') {
          add(`${path}.kind`, 'INVALID', 'STAGE_RECEIPT_KIND_MISMATCH');
        }
        requireAbsent(receipt.dataRef, `${path}.dataRef`);
        requireAbsent(receipt.dataWindow, `${path}.dataWindow`);
        requireAbsent(receipt.plannedWindow, `${path}.plannedWindow`);
        requireAbsent(receipt.preregistration, `${path}.preregistration`);
        requireAbsent(receipt.sample, `${path}.sample`);
        requireAbsent(receipt.metrics, `${path}.metrics`);
        requireAbsent(receipt.holdoutAccess, `${path}.holdoutAccess`);
      }

      if (stage === 'BACKTEST' && object(receipt.dataRef)) developmentRef = receipt.dataRef;
      if (stage === 'OUT_OF_SAMPLE_HOLDOUT' && object(receipt.dataRef)) {
        holdoutRef = receipt.dataRef;
        validateHoldout(receipt, path, developmentRef);
        const development = lifecycle.receipts.find(row => object(row) && row.stage === 'BACKTEST');
        if (object(development?.dataWindow) && timestamp(development.dataWindow.start) &&
          timestamp(development.dataWindow.end) && object(receipt.dataWindow) &&
          timestamp(receipt.dataWindow.start) && timestamp(receipt.dataWindow.end) &&
          parsedTimestamp(receipt.dataWindow.start) <= parsedTimestamp(development.dataWindow.end) &&
          parsedTimestamp(receipt.dataWindow.end) >= parsedTimestamp(development.dataWindow.start)) {
          add(`${path}.dataWindow`, 'INVALID', 'HOLDOUT_WINDOW_OVERLAP');
        }
      }
      if (stage === 'FORWARD_VALIDATION' && object(receipt.dataRef) && object(holdoutRef)) {
        if (receipt.dataRef.datasetId === holdoutRef.datasetId) {
          add(`${path}.dataRef.datasetId`, 'INVALID', 'FORWARD_DATASET_REUSED');
        }
        if (!Array.isArray(receipt.dataRef.disjointFrom) ||
          !receipt.dataRef.disjointFrom.includes(holdoutRef.datasetId)) {
          add(`${path}.dataRef.disjointFrom`, 'NOT_ASSESSED', 'HOLDOUT_FORWARD_DISJOINTNESS_NOT_DECLARED');
        }
        const holdoutReceipt = lifecycle.receipts.find(row =>
          object(row) && row.stage === 'OUT_OF_SAMPLE_HOLDOUT');
        if (timestamp(holdoutReceipt?.dataWindow?.end) &&
          timestamp(receipt.dataWindow?.start) &&
          parsedTimestamp(receipt.dataWindow.start) <= parsedTimestamp(holdoutReceipt.dataWindow.end)) {
          add(`${path}.dataWindow.start`, 'INVALID', 'FORWARD_WINDOW_PRECEDES_HOLDOUT_END');
        }
      }
      if (stage === 'FORWARD_VALIDATION' && object(receipt.dataWindow) && timestamp(receipt.dataWindow.end)) {
        const start = parsedTimestamp(receipt.dataWindow.start);
        const end = parsedTimestamp(receipt.dataWindow.end);
        if (start <= forwardEnd) add(`${path}.dataWindow.start`, 'INVALID', 'FORWARD_WINDOWS_NOT_MONOTONIC');
        forwardEnd = end;
      }
    }
    if (lifecycle.currentStage === 'PAPER_BOT' && lifecycle.receipts.at(-1)?.kind !== 'PAPER_SETUP') {
      add('lifecycle.currentStage', 'NOT_ASSESSED', 'PAPER_SETUP_REQUIRED');
    }
    if (lifecycle.currentStage === 'FORWARD_VALIDATION' && !holdoutRef) {
      add('lifecycle.OUT_OF_SAMPLE_HOLDOUT', 'NOT_ASSESSED', 'HOLDOUT_OUTCOME_OR_DIAGNOSTIC_REQUIRED');
    }
  }

  function validateRulesRef(reference, path) {
    if (!exactShape(reference, path, ['id', 'sha256'])) return;
    validId(reference.id, `${path}.id`);
    const status = hashStatus(reference.sha256);
    if (status === 'MISSING_OR_INVALID') add(`${path}.sha256`, 'INVALID', 'INVALID_ASSERTED_HASH');
    else add(`${path}.sha256`, 'PRESENT_ASSERTED', status);
    if (reference.id !== value.strategy?.rulesRef?.id || reference.sha256 !== value.strategy?.rulesRef?.sha256) {
      add(path, 'INVALID', 'STRATEGY_RULES_IDENTITY_MISMATCH');
    }
  }

  function requireAbsent(item, path) {
    if (item !== null) add(path, 'INVALID', 'FIELD_NOT_APPLICABLE_TO_STAGE');
  }

  function validatePaperSetup(receipt, path) {
    if (receipt.kind !== 'PAPER_SETUP') add(`${path}.kind`, 'INVALID', 'PAPER_SETUP_REQUIRED');
    if (receipt.status !== 'SETUP_RECORDED' && receipt.status !== 'NOT_ASSESSED') {
      add(`${path}.status`, 'INVALID', 'PAPER_SETUP_IS_NOT_AN_OUTCOME');
    }
    requireAbsent(receipt.dataRef, `${path}.dataRef`);
    requireAbsent(receipt.dataWindow, `${path}.dataWindow`);
    requireAbsent(receipt.preregistration, `${path}.preregistration`);
    requireAbsent(receipt.sample, `${path}.sample`);
    requireAbsent(receipt.metrics, `${path}.metrics`);
    requireAbsent(receipt.holdoutAccess, `${path}.holdoutAccess`);
    if (exactShape(receipt.plannedWindow, `${path}.plannedWindow`, ['start', 'end'])) {
      if (![receipt.plannedWindow.start, receipt.plannedWindow.end].every(timestamp)) {
        add(`${path}.plannedWindow`, 'INVALID', 'INVALID_PLANNED_WINDOW');
      } else {
        if (!timestamp(receipt.recordedAt) ||
          parsedTimestamp(receipt.recordedAt) < parsedTimestamp(value.strategy?.frozenAt)) {
          add(`${path}.recordedAt`, 'INVALID', 'PAPER_SETUP_PRECEDES_RULES_FREEZE');
        }
        if (parsedTimestamp(receipt.plannedWindow.start) < parsedTimestamp(value.strategy?.frozenAt)) {
          add(`${path}.plannedWindow.start`, 'INVALID', 'PAPER_WINDOW_BEFORE_RULES_FREEZE');
        }
        if (parsedTimestamp(receipt.plannedWindow.start) > parsedTimestamp(receipt.plannedWindow.end)) {
          add(`${path}.plannedWindow`, 'INVALID', 'INVALID_PLANNED_WINDOW');
        }
      }
    }
  }

  function validateOutcome(receipt, path, stage) {
    if (receipt.kind !== 'OUTCOME' && receipt.kind !== 'DIAGNOSTIC') {
      add(`${path}.kind`, 'INVALID', 'OUTCOME_RECEIPT_REQUIRED');
    }
    requireAbsent(receipt.plannedWindow, `${path}.plannedWindow`);
    validateDataReference(receipt.dataRef, `${path}.dataRef`, stage);
    if (exactShape(receipt.dataWindow, `${path}.dataWindow`, ['start', 'end', 'availableAt'])) {
      const times = [receipt.dataWindow.start, receipt.dataWindow.end, receipt.dataWindow.availableAt];
      if (!times.every(timestamp)) add(`${path}.dataWindow`, 'INVALID', 'INVALID_DATA_TIMESTAMP');
      else {
        const start = parsedTimestamp(receipt.dataWindow.start);
        const end = parsedTimestamp(receipt.dataWindow.end);
        const available = parsedTimestamp(receipt.dataWindow.availableAt);
        const recorded = parsedTimestamp(receipt.recordedAt);
        const assessed = parsedTimestamp(value.asOf);
        if (start > end) {
          add(`${path}.dataWindow`, 'INVALID', 'INVALID_DATA_WINDOW');
        }
        if (['FORWARD_VALIDATION', 'ROBUSTNESS_REVIEW'].includes(stage) &&
          start < parsedTimestamp(value.strategy?.frozenAt)) {
          add(`${path}.dataWindow`, 'INVALID', 'PROSPECTIVE_WINDOW_PRECEDES_RULES_FREEZE');
        }
        if (timestamp(value.strategy?.frozenAt) && timestamp(receipt.recordedAt) &&
          parsedTimestamp(receipt.recordedAt) < parsedTimestamp(value.strategy.frozenAt)) {
          add(`${path}.recordedAt`, 'INVALID', 'OUTCOME_PRECEDES_RULES_FREEZE');
        }
        if (end > recorded || available < end || available > assessed || recorded > assessed) {
          add(`${path}.dataWindow`, 'INVALID', 'OUTCOME_NOT_AVAILABLE_AT_RECORDING');
        }
        if (timestamp(receipt.dataRef?.asKnownAt) &&
          (parsedTimestamp(receipt.dataRef.asKnownAt) < available || parsedTimestamp(receipt.dataRef.asKnownAt) > recorded)) {
          add(`${path}.dataRef.asKnownAt`, 'INVALID', 'DATA_KNOWN_TIME_MISMATCH');
        }
      }
    }
    if (exactShape(receipt.preregistration, `${path}.preregistration`, ['id', 'sha256', 'declaredAt', 'declaredBy', 'source'])) {
      validId(receipt.preregistration.id, `${path}.preregistration.id`);
      if (hashStatus(receipt.preregistration.sha256) === 'MISSING_OR_INVALID') {
        add(`${path}.preregistration.sha256`, 'INVALID', 'INVALID_ASSERTED_HASH');
      } else add(`${path}.preregistration.sha256`, 'PRESENT_ASSERTED', 'HASH_FORMAT_VALID_UNAUTHENTICATED');
      validText(receipt.preregistration.declaredBy, `${path}.preregistration.declaredBy`);
      validText(receipt.preregistration.source, `${path}.preregistration.source`);
      const declared = parsedTimestamp(receipt.preregistration.declaredAt);
      const frozen = parsedTimestamp(value.strategy?.frozenAt);
      const recorded = parsedTimestamp(receipt.recordedAt);
      if (!Number.isFinite(declared) || !Number.isFinite(recorded) ||
        !Number.isFinite(frozen) || declared < frozen || declared >= recorded) {
        add(`${path}.preregistration.declaredAt`, 'INVALID', 'CRITERIA_NOT_PREDECLARED');
      }
      if (['FORWARD_VALIDATION', 'ROBUSTNESS_REVIEW'].includes(stage) &&
        timestamp(receipt.dataWindow?.start) && declared >= parsedTimestamp(receipt.dataWindow.start)) {
        add(`${path}.preregistration.declaredAt`, 'INVALID', 'CRITERIA_NOT_PREDECLARED');
      }
      if (stage === 'OUT_OF_SAMPLE_HOLDOUT') {
        const firstExposure = receipt.holdoutAccess?.exposures?.find(item =>
          object(item) && item.role === 'FIRST_EXPOSURE');
        if (timestamp(firstExposure?.at) && declared >= parsedTimestamp(firstExposure.at)) {
          add(`${path}.preregistration.declaredAt`, 'INVALID', 'CRITERIA_NOT_PREDECLARED');
        }
      }
    }
    validateSample(receipt.sample, `${path}.sample`);
    validateMetrics(receipt.metrics, `${path}.metrics`, stage, receipt);
  }

  function validateDataReference(reference, path, stage) {
    const expectedRole = {
      BACKTEST: 'DEVELOPMENT',
      OUT_OF_SAMPLE_HOLDOUT: 'HOLDOUT',
      FORWARD_VALIDATION: 'FORWARD',
      ROBUSTNESS_REVIEW: 'ROBUSTNESS'
    }[stage];
    if (!exactShape(reference, path, ['id', 'datasetId', 'sha256', 'role', 'disjointFrom', 'asKnownAt'])) return;
    validId(reference.id, `${path}.id`);
    validId(reference.datasetId, `${path}.datasetId`);
    if (hashStatus(reference.sha256) === 'MISSING_OR_INVALID') add(`${path}.sha256`, 'INVALID', 'INVALID_ASSERTED_HASH');
    else add(`${path}.sha256`, 'PRESENT_ASSERTED', 'HASH_FORMAT_VALID_UNAUTHENTICATED');
    if (reference.role !== expectedRole) add(`${path}.role`, 'INVALID', 'DATA_REFERENCE_WRONG_STAGE');
    if (!Array.isArray(reference.disjointFrom) || reference.disjointFrom.length > 16 ||
      reference.disjointFrom.some(item => !text(item))) {
      add(`${path}.disjointFrom`, 'NOT_ASSESSED', 'DATA_DISJOINTNESS_NOT_DECLARED');
    }
    if (!timestamp(reference.asKnownAt) || !timestamp(value.asOf) ||
      parsedTimestamp(reference.asKnownAt) > parsedTimestamp(value.asOf)) {
      add(`${path}.asKnownAt`, 'INVALID', 'DATA_AVAILABILITY_NOT_ESTABLISHED');
    }
  }

  function validateSample(sample, path) {
    if (!exactShape(sample, path, ['n', 'unit', 'dependenceApproach', 'uncertaintyApproach'])) return;
    if (!Number.isInteger(sample.n) || sample.n < 0) add(`${path}.n`, 'INVALID', 'NONNEGATIVE_INTEGER_SAMPLE_REQUIRED');
    validText(sample.unit, `${path}.unit`);
    validText(sample.dependenceApproach, `${path}.dependenceApproach`);
    validText(sample.uncertaintyApproach, `${path}.uncertaintyApproach`);
  }

  function validateMetrics(metrics, path, stage, receipt) {
    if (!Array.isArray(metrics) || metrics.length !== METRICS.length) {
      add(path, 'MISSING', 'COMPLETE_METRIC_DECLARATIONS_REQUIRED');
      return;
    }
    const seen = new Set();
    for (let index = 0; index < metrics.length; index++) {
      const metric = metrics[index];
      const metricPath = `${path}[${index}]`;
      if (!exactShape(metric, metricPath, [
        'name', 'applicability', 'value', 'unit', 'denominator', 'reason', 'threshold'
      ])) continue;
      validEnum(metric.name, METRICS, `${metricPath}.name`);
      if (seen.has(metric.name)) add(`${metricPath}.name`, 'INVALID', 'DUPLICATE_METRIC');
      seen.add(metric.name);
      validEnum(metric.applicability, ['APPLICABLE', 'NOT_APPLICABLE', 'UNDEFINED'], `${metricPath}.applicability`);
      if (CORE_METRICS.has(metric.name) && metric.applicability !== 'APPLICABLE') {
        add(`${metricPath}.applicability`, 'NOT_ASSESSED', 'CORE_EVIDENCE_NOT_ESTABLISHED');
      }
      if (metric.applicability !== 'APPLICABLE') add(`${metricPath}.applicability`, 'NOT_ASSESSED', 'METRIC_NOT_ASSESSED');
      if (metric.applicability === 'APPLICABLE') {
        if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
          add(`${metricPath}.value`, 'INVALID', 'FINITE_ASSERTED_METRIC_REQUIRED');
        } else add(`${metricPath}.value`, 'PRESENT_ASSERTED', 'ASSERTED_UNVERIFIED');
        validText(metric.unit, `${metricPath}.unit`);
        if (exactShape(metric.denominator, `${metricPath}.denominator`, ['value', 'unit'])) {
          if (!(typeof metric.denominator.value === 'number' && Number.isFinite(metric.denominator.value) &&
            metric.denominator.value > 0)) add(`${metricPath}.denominator.value`, 'INVALID', 'POSITIVE_FINITE_DENOMINATOR_REQUIRED');
          validText(metric.denominator.unit, `${metricPath}.denominator.unit`);
        }
        if (metric.reason !== null) add(`${metricPath}.reason`, 'INVALID', 'REASON_MUST_BE_NULL_FOR_APPLICABLE_METRIC');
      } else {
        if (metric.value !== null || metric.unit !== null || metric.denominator !== null) {
          add(metricPath, 'INVALID', 'UNDEFINED_METRIC_MUST_USE_EXPLICIT_NULLS');
        }
        validText(metric.reason, `${metricPath}.reason`);
      }
      if (metric.threshold !== null) validateThreshold(metric.threshold, `${metricPath}.threshold`, metric, receipt);
    }
    for (const name of METRICS) if (!seen.has(name)) add(`${path}.${name}`, 'MISSING', 'METRIC_DECLARATION_REQUIRED');
  }

  function validateThreshold(threshold, path, metric, receipt) {
    if (!exactShape(threshold, path, ['operator', 'value', 'unit', 'declaredAt', 'declaredBy', 'source'])) return;
    validEnum(threshold.operator, ['GT', 'GTE', 'LT', 'LTE'], `${path}.operator`);
    if (typeof threshold.value !== 'number' || !Number.isFinite(threshold.value)) add(`${path}.value`, 'INVALID', 'FINITE_THRESHOLD_REQUIRED');
    if (threshold.unit !== metric.unit) add(`${path}.unit`, 'INVALID', 'THRESHOLD_UNIT_MISMATCH');
    const declared = parsedTimestamp(threshold.declaredAt);
    const frozen = parsedTimestamp(value.strategy?.frozenAt);
    const recorded = parsedTimestamp(receipt.recordedAt);
    if (!Number.isFinite(declared) || !Number.isFinite(frozen) ||
      !Number.isFinite(recorded) || declared < frozen || declared >= recorded) {
      add(`${path}.declaredAt`, 'INVALID', 'THRESHOLD_NOT_PREDECLARED');
    }
    if (['FORWARD_VALIDATION', 'ROBUSTNESS_REVIEW'].includes(receipt.stage) &&
      timestamp(receipt.dataWindow?.start) && declared >= parsedTimestamp(receipt.dataWindow.start)) {
      add(`${path}.declaredAt`, 'INVALID', 'THRESHOLD_NOT_PREDECLARED');
    }
    if (receipt.stage === 'OUT_OF_SAMPLE_HOLDOUT') {
      const firstExposure = receipt.holdoutAccess?.exposures?.find(item =>
        object(item) && item.role === 'FIRST_EXPOSURE');
      if (timestamp(firstExposure?.at) && declared >= parsedTimestamp(firstExposure.at)) {
        add(`${path}.declaredAt`, 'INVALID', 'THRESHOLD_NOT_PREDECLARED');
      }
    }
    validText(threshold.declaredBy, `${path}.declaredBy`);
    validText(threshold.source, `${path}.source`);
  }

  function validateHoldout(receipt, path, developmentRef) {
    if (!developmentRef) {
      add(`${path}.dataRef`, 'NOT_ASSESSED', 'DEVELOPMENT_REFERENCE_REQUIRED');
      return;
    }
    if (!object(receipt.dataRef)) return;
    const holdoutRef = receipt.dataRef;
    if (holdoutRef.datasetId === developmentRef.datasetId) {
      add(`${path}.dataRef.datasetId`, 'INVALID', 'HOLDOUT_DATASET_REUSED');
    }
    if (!Array.isArray(holdoutRef.disjointFrom) || !holdoutRef.disjointFrom.includes(developmentRef.datasetId)) {
      add(`${path}.dataRef.disjointFrom`, 'NOT_ASSESSED', 'DEVELOPMENT_HOLDOUT_DISJOINTNESS_NOT_DECLARED');
    }
    const access = receipt.holdoutAccess;
    if (!exactShape(access, `${path}.holdoutAccess`, ['history', 'exposures'])) return;
    validEnum(access.history, ['KNOWN', 'UNKNOWN'], `${path}.holdoutAccess.history`);
    if (access.history === 'UNKNOWN') {
      add(`${path}.holdoutAccess.history`, 'NOT_ASSESSED', 'HOLDOUT_ACCESS_HISTORY_UNKNOWN');
    }
    if (!Array.isArray(access.exposures) || access.exposures.length > 32) {
      add(`${path}.holdoutAccess.exposures`, 'INVALID', 'INVALID_EXPOSURE_LIST');
      return;
    }
    const firstExposures = access.exposures.filter(exposure =>
      object(exposure) && exposure.role === 'FIRST_EXPOSURE');
    if (access.history === 'KNOWN' && firstExposures.length !== 1) {
      add(`${path}.holdoutAccess.exposures`, firstExposures.length
        ? 'INVALID' : 'NOT_ASSESSED', 'HOLDOUT_FIRST_EXPOSURE_REQUIRED');
    }
    const firstAt = firstExposures.length === 1 ? parsedTimestamp(firstExposures[0].at) : NaN;
    const recordedAt = parsedTimestamp(receipt.recordedAt);
    const availableAt = parsedTimestamp(receipt.dataWindow?.availableAt);
    const frozenAt = parsedTimestamp(value.strategy?.frozenAt);
    const roles = new Set([
      'FIRST_EXPOSURE', 'SELECTION_OR_TUNING', 'EXACT_REPRODUCTION',
      'AUDIT', 'HASH_INSPECTION', 'REUSED_FOR_NEW_HYPOTHESIS'
    ]);
    for (let index = 0; index < access.exposures.length; index++) {
      const exposure = access.exposures[index];
      const exposurePath = `${path}.holdoutAccess.exposures[${index}]`;
      if (!exactShape(exposure, exposurePath, ['role', 'at', 'purpose'])) continue;
      validEnum(exposure.role, [...roles], `${exposurePath}.role`);
      if (!timestamp(exposure.at) || !timestamp(value.asOf) ||
        parsedTimestamp(exposure.at) > parsedTimestamp(value.asOf)) {
        add(`${exposurePath}.at`, 'INVALID', 'INVALID_EXPOSURE_TIME');
      }
      if (timestamp(exposure.at)) {
        const at = parsedTimestamp(exposure.at);
        if (Number.isFinite(firstAt) && at < firstAt) {
          add(`${exposurePath}.at`, 'INVALID', 'HOLDOUT_ACCESS_PRECEDES_FIRST_EXPOSURE');
        }
        if (exposure.role === 'FIRST_EXPOSURE') {
          if (Number.isFinite(frozenAt) && at < frozenAt) {
            add(`${exposurePath}.at`, 'INVALID', 'HOLDOUT_EXPOSURE_PRECEDES_RULES_FREEZE');
          }
          if (Number.isFinite(availableAt) && at < availableAt) {
            add(`${exposurePath}.at`, 'INVALID', 'HOLDOUT_EXPOSURE_PRECEDES_DATA_AVAILABILITY');
          }
          if (Number.isFinite(recordedAt) && at > recordedAt) {
            add(`${exposurePath}.at`, 'INVALID', 'HOLDOUT_FIRST_EXPOSURE_AFTER_RESULT');
          }
        }
      }
      validText(exposure.purpose, `${exposurePath}.purpose`);
      if (['SELECTION_OR_TUNING', 'REUSED_FOR_NEW_HYPOTHESIS'].includes(exposure.role)) {
        add(`${exposurePath}.role`, 'FAILED', 'HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION');
      }
    }
    if (access.history === 'KNOWN' && access.exposures.length === 0) {
      add(`${path}.holdoutAccess.exposures`, 'NOT_ASSESSED', 'HOLDOUT_EXPOSURE_ROLES_REQUIRED');
    }
  }

  function validateTrialLedger(ledger) {
    if (ledger === undefined) {
      add('trialLedger', 'NOT_ASSESSED', 'TRIAL_HISTORY_NOT_RECONCILED');
      return;
    }
    if (!exactShape(ledger, 'trialLedger', ['declaredTrials', 'reportedTrials', 'source'])) return;
    if (!Number.isInteger(ledger.declaredTrials) || ledger.declaredTrials < 0 ||
      !Number.isInteger(ledger.reportedTrials) || ledger.reportedTrials < 0) {
      add('trialLedger', 'INVALID', 'NONNEGATIVE_TRIAL_COUNTS_REQUIRED');
    } else if (ledger.declaredTrials !== ledger.reportedTrials) {
      add('trialLedger', 'INCONCLUSIVE', 'TRIAL_HISTORY_MISMATCH');
    } else add('trialLedger', 'PRESENT_ASSERTED', 'TRIAL_HISTORY_UNVERIFIED');
    validText(ledger.source, 'trialLedger.source');
  }

  function validateMigrationAnnotation(annotation) {
    if (annotation === undefined) return;
    if (!exactShape(annotation, 'migrationAnnotation', ['kind', 'strategyId', 'reconciledStages', 'gaps', 'source'])) return;
    if (annotation.kind !== 'RETROSPECTIVE_RECONCILIATION') add('migrationAnnotation.kind', 'INVALID', 'UNKNOWN_ANNOTATION_KIND');
    if (annotation.strategyId !== value.strategy?.id) add('migrationAnnotation.strategyId', 'INVALID', 'STRATEGY_IDENTITY_MISMATCH');
    if (!Array.isArray(annotation.reconciledStages) || annotation.reconciledStages.length > STAGES.length ||
      annotation.reconciledStages.some(stage => !STAGES.includes(stage))) {
      add('migrationAnnotation.reconciledStages', 'INVALID', 'INVALID_HISTORICAL_STAGE_LIST');
    }
    if (!Array.isArray(annotation.gaps) || annotation.gaps.length === 0 || annotation.gaps.length > STAGES.length ||
      annotation.gaps.some(gap => !text(gap))) {
      add('migrationAnnotation.gaps', 'MISSING', 'HISTORICAL_GAPS_MUST_REMAIN_EXPLICIT');
    }
    validText(annotation.source, 'migrationAnnotation.source');
  }
}

function assessHoldout(receipt, frozenAt, asOf) {
  if (!object(receipt) || !object(receipt.holdoutAccess)) return {
    status: 'UNKNOWN',
    freshConfirmation: 'NOT_ASSESSED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
  const access = receipt.holdoutAccess;
  if (access.history !== 'KNOWN' || !Array.isArray(access.exposures)) return {
    status: 'UNKNOWN',
    freshConfirmation: 'NOT_ASSESSED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
  const firstExposures = access.exposures.filter(exposure =>
    object(exposure) && exposure.role === 'FIRST_EXPOSURE');
  const first = firstExposures[0];
  const available = parsedTimestamp(receipt.dataWindow?.availableAt);
  const firstAt = parsedTimestamp(first?.at);
  const recordedAt = parsedTimestamp(receipt.recordedAt);
  const frozen = parsedTimestamp(frozenAt);
  const assessed = parsedTimestamp(asOf);
  if (firstExposures.length !== 1 || !timestamp(first?.at) ||
    !timestamp(receipt.recordedAt) || !timestamp(receipt.dataWindow?.availableAt) ||
    !timestamp(frozenAt) || !timestamp(asOf) ||
    firstAt < frozen || firstAt < available || firstAt > recordedAt ||
    access.exposures.some(exposure => !object(exposure) || !timestamp(exposure.at) ||
      parsedTimestamp(exposure.at) < firstAt || parsedTimestamp(exposure.at) > assessed)) {
    return {
      status: 'UNKNOWN',
      freshConfirmation: 'NOT_ASSESSED',
      provenance: 'ASSERTED_UNVERIFIED'
    };
  }
  if (access.exposures.some(exposure => object(exposure) &&
    ['SELECTION_OR_TUNING', 'REUSED_FOR_NEW_HYPOTHESIS'].includes(exposure.role))) return {
    status: 'CONTAMINATED_FOR_CONFIRMATION',
    freshConfirmation: 'NOT_ASSESSED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
  if (access.exposures.some(exposure => object(exposure) &&
    ['EXACT_REPRODUCTION', 'AUDIT', 'HASH_INSPECTION'].includes(exposure.role))) return {
    status: 'DIAGNOSTIC_ONLY',
    freshConfirmation: 'NOT_ASSESSED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
  if (!access.exposures.some(exposure => object(exposure) && exposure.role === 'FIRST_EXPOSURE')) return {
    status: 'UNKNOWN',
    freshConfirmation: 'NOT_ASSESSED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
  return {
    status: 'FIRST_EXPOSURE_ASSERTED',
    freshConfirmation: 'ASSERTED_UNVERIFIED',
    provenance: 'ASSERTED_UNVERIFIED'
  };
}

function assessEdgeHealth(claim) {
  const statuses = ['ACTIVE', 'WEAKENING', 'INVALID', 'UNRESOLVED', 'EXPERIMENTAL'];
  if (!object(claim) || !statuses.includes(claim.classification) ||
    !text(claim.source) || !timestamp(claim.measuredAt) || !text(claim.metricRef)) {
    return {classification: 'UNKNOWN', provenance: 'NOT_ASSESSED'};
  }
  return {
    classification: claim.classification,
    source: claim.source,
    measuredAt: claim.measuredAt,
    metricRef: claim.metricRef,
    provenance: 'ASSERTED_UNVERIFIED'
  };
}

function assessTradePlanPolicy(strategy) {
  const riskType = strategy?.riskPolicy?.type;
  const policy = strategy?.tradePlanPolicy;
  if (riskType === 'PORTFOLIO_LEVEL_NO_STOP') {
    return {
      policyId: 'PLANNED_NET_CRV_MIN_3_V1',
      applicability: 'NOT_APPLICABLE_NO_FINITE_TRADE_PAYOFF',
      status: 'NOT_ASSESSED',
      source: 'docs/strategy-lab/TRADE_PLAN_CRV.md',
      researchOnly: true,
      provenance: 'ASSERTED_UNVERIFIED'
    };
  }
  if (!object(policy)) return {
    policyId: 'PLANNED_NET_CRV_MIN_3_V1',
    applicability: 'UNRESOLVED_POLICY_APPLICABILITY',
    status: 'NOT_ASSESSED',
    source: 'docs/strategy-lab/TRADE_PLAN_CRV.md',
    researchOnly: true,
    provenance: 'ASSERTED_UNVERIFIED'
  };
  return {
    policyId: policy.policyId,
    applicability: policy.applicability,
    status: 'NOT_ASSESSED',
    source: policy.source,
    researchOnly: policy.applicability !== 'APPLICABLE_FINITE_TRADE_PAYOFF',
    provenance: 'ASSERTED_UNVERIFIED'
  };
}
