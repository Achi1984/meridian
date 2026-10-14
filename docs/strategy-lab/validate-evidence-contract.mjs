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
  'OOS_HOLDOUT',
  'UNCERTAINTY',
  'SAMPLE_DEPENDENCE',
  'SELECTION_RISK'
]);
const NEXT_EVIDENCE = Object.freeze({
  IDEA: ['Versioned hypothesis, entry/exit, risk and invalidation policy.'],
  RESEARCH: ['Source and data receipts; documented assumptions and market conditions.'],
  BACKTEST: ['Frozen rules, complete cost assumptions, risk sizing and stage-specific preregistration.'],
  OUT_OF_SAMPLE_HOLDOUT: ['Untouched holdout receipt, predeclared thresholds and confirmation that holdout was not tuned.'],
  PAPER_BOT: ['Completed holdout evidence and separately authorized prospective Paper operation.'],
  FORWARD_VALIDATION: ['Immutable Paper identity, forward-only observations, risk sizing and telemetry.'],
  ROBUSTNESS_REVIEW: ['Forward-validation evidence, cost/slippage sensitivity, stability and uncertainty review.'],
  LIVE_CANDIDATE: ['Robustness evidence and an independent, separately authorized candidacy review.'],
  COMPLETE: []
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
const timestamp = value => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));

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
  const missing = [];
  const invalid = [];
  const addMissing = (path, reason) => missing.push({path, reason});
  const addInvalid = (path, reason) => invalid.push({path, reason});
  let value;
  try {
    value = copyInput(input);
  } catch (error) {
    addInvalid('input', error.message === 'INPUT_NUMBER' ? 'NONFINITE_NUMBER' : 'UNSAFE_OR_UNBOUNDED_SHAPE');
    return result();
  }

  function result() {
    const completeness = invalid.length ? 'INVALID' : missing.length ? 'INCOMPLETE' : 'COMPLETE';
    const receipts = object(value?.lifecycle) && Array.isArray(value.lifecycle.receipts) ? value.lifecycle.receipts : [];
    const evidenceStatuses = receipts.filter(object).map(receipt => receipt.status);
    const notAssessed = evidenceStatuses.includes('NOT_ASSESSED') ||
      Boolean(receipts.at(-1) && Array.isArray(receipts.at(-1).metrics) &&
        receipts.at(-1).metrics.some(metric => object(metric) && metric.status === 'NOT_ASSESSED'));
    const blocked = completeness !== 'COMPLETE' || invalid.length > 0 ||
      evidenceStatuses.some(status => ['FAILED', 'INCONCLUSIVE'].includes(status));
    const next = object(value?.lifecycle) ? value.lifecycle.proposedNextStage : null;
    const terminal = value?.lifecycle?.currentStage === 'LIVE_CANDIDATE' && next === null;
    const readiness = blocked ? 'BLOCKED' : notAssessed ? 'NOT_ASSESSED' :
      value?.strategy?.disposition !== 'NEW_HYPOTHESIS' ? 'BLOCKED' :
        terminal ? 'NO_NEXT_STAGE' : 'READY_UNVERIFIED';
    const nextRequiredEvidence = typeof next === 'string' && Object.hasOwn(NEXT_EVIDENCE, next) ? NEXT_EVIDENCE[next] : [];
    return {
      evidenceCompleteness: completeness,
      missing,
      invalid,
      proposedNextStageReadiness: readiness,
      nextRequiredEvidence,
      provenance: 'ASSERTED_UNVERIFIED',
      operationalReadiness: 'NOT_ASSESSED',
      authorityStatus: 'NOT_GRANTED',
      executionAuthorized: false,
      autoPromotion: false
    };
  }

  function shape(item, path, required) {
    if (!object(item)) {
      addMissing(path, 'OBJECT_REQUIRED');
      return false;
    }
    for (const key of required) if (!Object.hasOwn(item, key)) addMissing(`${path}.${key}`, 'FIELD_REQUIRED');
    for (const key of Object.keys(item)) if (!required.includes(key)) addInvalid(`${path}.${key}`, 'UNKNOWN_FIELD');
    return true;
  }

  function requireText(item, path) {
    if (!text(item)) addMissing(path, 'NONEMPTY_TEXT_REQUIRED');
  }

  function exactEnum(item, values, path) {
    if (!values.includes(item)) addInvalid(path, 'UNKNOWN_ENUM');
  }

  function validId(item, path) {
    if (typeof item !== 'string' || !IDENTIFIER.test(item)) addInvalid(path, 'INVALID_IDENTIFIER');
  }

  if (!shape(value, 'input', ['schemaVersion', 'assessmentAt', 'checkpoint', 'strategy', 'lifecycle'])) return result();
  if (value.schemaVersion !== 'MERIDIAN_PAPER_FIRST_EVIDENCE_V1') addInvalid('schemaVersion', 'UNSUPPORTED_SCHEMA');
  if (!timestamp(value.assessmentAt)) addInvalid('assessmentAt', 'INVALID_TIMESTAMP');

  if (!Object.hasOwn(value, 'checkpoint')) addMissing('checkpoint', 'CURRENT_CHECKPOINT_REQUIRED');
  if (shape(value.checkpoint, 'checkpoint', ['id', 'mainSha', 'stage', 'flags', 'sourceOnly'])) {
    if (value.checkpoint.id !== 'MERIDIAN_LIVE_CHECKPOINT') addInvalid('checkpoint.id', 'UNKNOWN_CHECKPOINT');
    if (typeof value.checkpoint.mainSha !== 'string' || !COMMIT.test(value.checkpoint.mainSha)) {
      addInvalid('checkpoint.mainSha', 'INVALID_COMMIT_REFERENCE');
    }
    if (value.checkpoint.stage !== 'SOURCE_AUDIT') addInvalid('checkpoint.stage', 'CHECKPOINT_NOT_SOURCE_AUDIT');
    if (value.checkpoint.sourceOnly !== true) addInvalid('checkpoint.sourceOnly', 'SOURCE_ONLY_REQUIRED');
    if (shape(value.checkpoint.flags, 'checkpoint.flags', AUTHORITY_FLAGS)) {
      for (const flag of AUTHORITY_FLAGS) {
        if (value.checkpoint.flags[flag] !== false) addInvalid(`checkpoint.flags.${flag}`, 'AUTHORITY_CONFLICT');
      }
    }
  }

  const strategyKeys = [
    'id', 'version', 'hypothesis', 'entry', 'exit', 'risk', 'positionSizing',
    'costAssumptions', 'marketConditions', 'telemetry', 'invalidationConditions',
    'frozenAt', 'disposition'
  ];
  if (!Object.hasOwn(value, 'strategy')) addMissing('strategy', 'STRATEGY_REQUIRED');
  if (shape(value.strategy, 'strategy', strategyKeys)) {
    const strategy = value.strategy;
    validId(strategy.id, 'strategy.id');
    validId(strategy.version, 'strategy.version');
    requireText(strategy.hypothesis, 'strategy.hypothesis');
    requireText(strategy.entry, 'strategy.entry');
    requireText(strategy.exit, 'strategy.exit');
    if (!timestamp(strategy.frozenAt)) addInvalid('strategy.frozenAt', 'INVALID_TIMESTAMP');
    exactEnum(strategy.disposition, [
      'NEW_HYPOTHESIS', 'MIGRATION_RECONCILIATION_REQUIRED', 'FROZEN_FAILED',
      'FROZEN_REFERENCE', 'UNRESOLVED'
    ], 'strategy.disposition');
    if (typeof strategy.id === 'string' && NON_PROMOTABLE_IDS.has(normalizedId(strategy.id))) {
      addInvalid('strategy.id', 'KNOWN_FROZEN_OR_REFERENCE_ID');
    }
    if (strategy.disposition !== 'NEW_HYPOTHESIS') {
      addInvalid('strategy.disposition', 'MIGRATION_OR_FROZEN_EVIDENCE_REQUIRED');
    }
    if (shape(strategy.risk, 'strategy.risk', ['type', 'policy', 'stopDefinition', 'justification'])) {
      exactEnum(strategy.risk.type, ['STOP_BASED', 'PORTFOLIO_NON_STOP'], 'strategy.risk.type');
      requireText(strategy.risk.policy, 'strategy.risk.policy');
      requireText(strategy.risk.justification, 'strategy.risk.justification');
      if (strategy.risk.type === 'STOP_BASED') requireText(strategy.risk.stopDefinition, 'strategy.risk.stopDefinition');
      if (strategy.risk.type === 'PORTFOLIO_NON_STOP' && strategy.risk.stopDefinition !== null) {
        addInvalid('strategy.risk.stopDefinition', 'NON_STOP_POLICY_MUST_NOT_INVENT_STOP');
      }
    }
    if (shape(strategy.positionSizing, 'strategy.positionSizing', ['method', 'unit', 'policy'])) {
      requireText(strategy.positionSizing.method, 'strategy.positionSizing.method');
      requireText(strategy.positionSizing.unit, 'strategy.positionSizing.unit');
      requireText(strategy.positionSizing.policy, 'strategy.positionSizing.policy');
    }
    const costKeys = ['fee', 'spread', 'slippage', 'funding', 'borrow'];
    if (shape(strategy.costAssumptions, 'strategy.costAssumptions', costKeys)) {
      for (const key of costKeys) {
        const cost = strategy.costAssumptions[key];
        if (shape(cost, `strategy.costAssumptions.${key}`, ['status', 'value', 'unit', 'source', 'reason'])) {
          exactEnum(cost.status, ['ASSUMED', 'NOT_APPLICABLE'], `strategy.costAssumptions.${key}.status`);
          if (cost.status === 'ASSUMED') {
            if (typeof cost.value !== 'number' || !Number.isFinite(cost.value)) addInvalid(`strategy.costAssumptions.${key}.value`, 'FINITE_ASSUMPTION_REQUIRED');
            requireText(cost.unit, `strategy.costAssumptions.${key}.unit`);
            requireText(cost.source, `strategy.costAssumptions.${key}.source`);
            if (cost.reason !== null) addInvalid(`strategy.costAssumptions.${key}.reason`, 'REASON_MUST_BE_NULL_FOR_ASSUMPTION');
          } else {
            if (cost.value !== null || cost.unit !== null || cost.source !== null) {
              addInvalid(`strategy.costAssumptions.${key}`, 'NOT_APPLICABLE_SHAPE');
            }
            requireText(cost.reason, `strategy.costAssumptions.${key}.reason`);
          }
        }
      }
    }
    for (const key of ['marketConditions', 'telemetry', 'invalidationConditions']) {
      const list = strategy[key];
      if (!Array.isArray(list) || list.length === 0 || list.length > 16 || list.some(item => !text(item))) {
        addMissing(`strategy.${key}`, 'NONEMPTY_TEXT_LIST_REQUIRED');
      }
    }
  }

  if (!Object.hasOwn(value, 'lifecycle')) addMissing('lifecycle', 'LIFECYCLE_REQUIRED');
  if (!shape(value.lifecycle, 'lifecycle', ['currentStage', 'proposedNextStage', 'receipts'])) return result();
  const lifecycle = value.lifecycle;
  exactEnum(lifecycle.currentStage, STAGES, 'lifecycle.currentStage');
  const currentIndex = STAGES.indexOf(lifecycle.currentStage);
  if (!Array.isArray(lifecycle.receipts) || lifecycle.receipts.length > STAGES.length) {
    addInvalid('lifecycle.receipts', 'INVALID_RECEIPT_LIST');
    return result();
  }
  const expectedNext = currentIndex >= 0 ? STAGES[currentIndex + 1] ?? null : undefined;
  if (lifecycle.proposedNextStage !== expectedNext) addInvalid('lifecycle.proposedNextStage', 'LIFECYCLE_MUST_NOT_SKIP');
  if (currentIndex >= 0 && lifecycle.receipts.length !== currentIndex + 1) {
    addMissing('lifecycle.receipts', 'CONTIGUOUS_STAGE_RECEIPTS_REQUIRED');
  }

  const receiptKeys = [
    'stage', 'status', 'resultReason', 'receiptId', 'receiptSha256', 'strategyId',
    'strategyVersion', 'source', 'data', 'temporalMode', 'completedAt',
    'holdoutTuning', 'metrics'
  ];
  const sourceDigests = new Map();
  const datasetDigests = new Map();
  const dataReceiptReferences = new Map();
  const dataWindows = [];
  const receiptIds = new Set();
  let previousCompletedAt = -Infinity;
  for (let index = 0; index < lifecycle.receipts.length; index++) {
    const receipt = lifecycle.receipts[index];
    const path = `lifecycle.receipts[${index}]`;
    if (!shape(receipt, path, receiptKeys)) continue;
    const expectedStage = STAGES[index];
    if (receipt.stage !== expectedStage) addInvalid(`${path}.stage`, 'STAGE_ORDER_OR_SKIP');
    exactEnum(receipt.stage, STAGES, `${path}.stage`);
    exactEnum(receipt.status, ['PASS', 'FAILED', 'INCONCLUSIVE', 'NOT_ASSESSED'], `${path}.status`);
    requireText(receipt.resultReason, `${path}.resultReason`);
    validId(receipt.receiptId, `${path}.receiptId`);
    if (receiptIds.has(receipt.receiptId)) addInvalid(`${path}.receiptId`, 'DUPLICATE_RECEIPT');
    receiptIds.add(receipt.receiptId);
    if (typeof receipt.receiptSha256 !== 'string' || !HASH.test(receipt.receiptSha256)) {
      addInvalid(`${path}.receiptSha256`, 'INVALID_ASSERTED_HASH');
    }
    if (receipt.strategyId !== value.strategy?.id || receipt.strategyVersion !== value.strategy?.version) {
      addInvalid(`${path}.strategyVersion`, 'STRATEGY_IDENTITY_MISMATCH');
    }
    if (receipt.holdoutTuning !== false) addInvalid(`${path}.holdoutTuning`, 'HOLDOUT_MUST_NOT_BE_TUNED');
    const forward = ['PAPER_BOT', 'FORWARD_VALIDATION'].includes(expectedStage);
    if (receipt.temporalMode !== (forward ? 'FORWARD' : 'RETROSPECTIVE')) {
      addInvalid(`${path}.temporalMode`, 'STAGE_TEMPORAL_MODE_MISMATCH');
    }
    if (!timestamp(receipt.completedAt)) {
      addInvalid(`${path}.completedAt`, 'INVALID_TIMESTAMP');
    } else {
      const completed = Date.parse(receipt.completedAt);
      if (completed < previousCompletedAt) addInvalid(`${path}.completedAt`, 'NON_MONOTONIC_STAGE_TIME');
      previousCompletedAt = completed;
    }
    if (shape(receipt.source, `${path}.source`, ['id', 'sha256'])) {
      validId(receipt.source.id, `${path}.source.id`);
      if (typeof receipt.source.sha256 !== 'string' || !HASH.test(receipt.source.sha256)) {
        addInvalid(`${path}.source.sha256`, 'INVALID_ASSERTED_HASH');
      }
      if (sourceDigests.has(receipt.source.id) && sourceDigests.get(receipt.source.id) !== receipt.source.sha256) {
        addInvalid(`${path}.source`, 'IMMUTABLE_SOURCE_REFERENCE_MISMATCH');
      }
      sourceDigests.set(receipt.source.id, receipt.source.sha256);
    }
    if (shape(receipt.data, `${path}.data`, [
      'id', 'datasetId', 'sha256', 'windowStart', 'windowEnd', 'availableAt',
      'validThrough', 'freshnessSource'
    ])) {
      const data = receipt.data;
      for (const key of ['id', 'datasetId']) validId(data[key], `${path}.data.${key}`);
      if (typeof data.sha256 !== 'string' || !HASH.test(data.sha256)) {
        addInvalid(`${path}.data.sha256`, 'INVALID_ASSERTED_HASH');
      }
      for (const key of ['windowStart', 'windowEnd', 'availableAt', 'validThrough']) {
        if (!timestamp(data[key])) addInvalid(`${path}.data.${key}`, 'INVALID_TIMESTAMP');
      }
      requireText(data.freshnessSource, `${path}.data.freshnessSource`);
      if ([data.windowStart, data.windowEnd, data.availableAt, data.validThrough, value.assessmentAt].every(timestamp)) {
        const start = Date.parse(data.windowStart);
        const end = Date.parse(data.windowEnd);
        const available = Date.parse(data.availableAt);
        const validThrough = Date.parse(data.validThrough);
        const assessed = Date.parse(value.assessmentAt);
        if (start > end || end > available || available > assessed) {
          addInvalid(`${path}.data`, 'INVALID_OR_FUTURE_DATA_WINDOW');
        }
        if (assessed > validThrough) addInvalid(`${path}.data.validThrough`, 'STALE_DATA_RECEIPT');
        if (forward && timestamp(value.strategy?.frozenAt) && start < Date.parse(value.strategy.frozenAt)) {
          addInvalid(`${path}.data.windowStart`, 'RETROSPECTIVE_DATA_MISLABELED_FORWARD');
        }
        if (expectedStage === 'OUT_OF_SAMPLE_HOLDOUT' &&
          dataWindows.some(window => start <= window.end && window.start <= end)) {
          addInvalid(`${path}.data`, 'HOLDOUT_WINDOW_OVERLAP');
        }
        const priorWindow = dataWindows.at(-1);
        if (forward && priorWindow && start <= priorWindow.end) {
          addInvalid(`${path}.data.windowStart`, 'NON_MONOTONIC_FORWARD_WINDOW');
        }
        dataWindows.push({stage: expectedStage, start, end});
      }
      if (datasetDigests.has(data.datasetId) && datasetDigests.get(data.datasetId) !== data.sha256) {
        addInvalid(`${path}.data`, 'IMMUTABLE_DATA_REFERENCE_MISMATCH');
      }
      if (typeof data.id === 'string' && typeof data.datasetId === 'string' && typeof data.sha256 === 'string') {
        const dataReference = `${data.datasetId}:${data.sha256}`;
        if (dataReceiptReferences.has(data.id) && dataReceiptReferences.get(data.id) !== dataReference) {
          addInvalid(`${path}.data.id`, 'IMMUTABLE_DATA_RECEIPT_MISMATCH');
        }
        dataReceiptReferences.set(data.id, dataReference);
      }
      if (expectedStage === 'OUT_OF_SAMPLE_HOLDOUT' && datasetDigests.has(data.datasetId)) {
        addInvalid(`${path}.data.datasetId`, 'HOLDOUT_DATASET_REUSED');
      }
      datasetDigests.set(data.datasetId, data.sha256);
    }
    if (!Array.isArray(receipt.metrics)) {
      addMissing(`${path}.metrics`, 'METRIC_LIST_REQUIRED');
      continue;
    }
    const metricRequired = index >= STAGES.indexOf('BACKTEST');
    if (!metricRequired && receipt.metrics.length !== 0) addInvalid(`${path}.metrics`, 'METRICS_NOT_APPLICABLE_TO_STAGE');
    if (metricRequired) validateMetrics(receipt, path, expectedStage);
  }

  if (lifecycle.receipts.length && lifecycle.receipts.at(-1)?.stage !== lifecycle.currentStage) {
    addInvalid('lifecycle.currentStage', 'CURRENT_STAGE_RECEIPT_MISMATCH');
  }
  return result();

  function validateMetrics(receipt, path, stage) {
    if (receipt.metrics.length !== METRICS.length) {
      addMissing(`${path}.metrics`, 'COMPLETE_METRIC_SET_REQUIRED');
      return;
    }
    const seen = new Set();
    for (let index = 0; index < receipt.metrics.length; index++) {
      const metric = receipt.metrics[index];
      const metricPath = `${path}.metrics[${index}]`;
      if (!shape(metric, metricPath, ['name', 'status', 'value', 'unit', 'denominator', 'reason', 'threshold'])) continue;
      if (!METRICS.includes(metric.name)) addInvalid(`${metricPath}.name`, 'UNKNOWN_METRIC');
      if (seen.has(metric.name)) addInvalid(`${metricPath}.name`, 'DUPLICATE_METRIC');
      seen.add(metric.name);
      exactEnum(metric.status, ['ASSESSED', 'NOT_APPLICABLE', 'NOT_ASSESSED'], `${metricPath}.status`);
      const mustAssessHoldout = STAGES.indexOf(stage) >= STAGES.indexOf('OUT_OF_SAMPLE_HOLDOUT');
      if (metric.name === 'OOS_HOLDOUT') {
        if (!mustAssessHoldout && metric.status !== 'NOT_ASSESSED') {
          addInvalid(`${metricPath}.status`, 'HOLDOUT_EVIDENCE_CANNOT_PRECEDE_HOLDOUT_STAGE');
        }
        if (!mustAssessHoldout && metric.status === 'NOT_ASSESSED' && !text(metric.reason)) {
          addMissing(`${metricPath}.reason`, 'NOT_ASSESSED_REASON_REQUIRED');
        }
      }
      if (metric.status === 'ASSESSED') {
        if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
          addInvalid(`${metricPath}.value`, 'FINITE_METRIC_REQUIRED');
        }
        requireText(metric.unit, `${metricPath}.unit`);
        if (shape(metric.denominator, `${metricPath}.denominator`, ['value', 'unit'])) {
          if (typeof metric.denominator.value !== 'number' || !Number.isFinite(metric.denominator.value) || metric.denominator.value <= 0) {
            addInvalid(`${metricPath}.denominator.value`, 'POSITIVE_FINITE_DENOMINATOR_REQUIRED');
          }
          requireText(metric.denominator.unit, `${metricPath}.denominator.unit`);
        }
        if (metric.reason !== null) addInvalid(`${metricPath}.reason`, 'REASON_MUST_BE_NULL_FOR_ASSESSED_METRIC');
        if (shape(metric.threshold, `${metricPath}.threshold`, ['operator', 'value', 'unit', 'source', 'predeclaredAt'])) {
          exactEnum(metric.threshold.operator, ['GT', 'GTE', 'LT', 'LTE'], `${metricPath}.threshold.operator`);
          if (typeof metric.threshold.value !== 'number' || !Number.isFinite(metric.threshold.value)) {
            addInvalid(`${metricPath}.threshold.value`, 'FINITE_THRESHOLD_REQUIRED');
          }
          if (metric.threshold.unit !== metric.unit) addInvalid(`${metricPath}.threshold.unit`, 'THRESHOLD_UNIT_MISMATCH');
          requireText(metric.threshold.source, `${metricPath}.threshold.source`);
          if (!timestamp(metric.threshold.predeclaredAt)) addInvalid(`${metricPath}.threshold.predeclaredAt`, 'INVALID_TIMESTAMP');
          else if (timestamp(receipt.data?.windowStart) &&
            Date.parse(metric.threshold.predeclaredAt) >= Date.parse(receipt.data.windowStart)) {
            addInvalid(`${metricPath}.threshold.predeclaredAt`, 'THRESHOLD_NOT_PREDECLARED');
          }
          if (typeof metric.threshold.operator === 'string' &&
            ['GT', 'GTE', 'LT', 'LTE'].includes(metric.threshold.operator) &&
            Number.isFinite(metric.value) && Number.isFinite(metric.threshold.value)) {
            const passed = {
              GT: metric.value > metric.threshold.value,
              GTE: metric.value >= metric.threshold.value,
              LT: metric.value < metric.threshold.value,
              LTE: metric.value <= metric.threshold.value
            }[metric.threshold.operator];
            if (passed === false) addInvalid(`${metricPath}.value`, 'PREDECLARED_THRESHOLD_NOT_MET');
          }
        }
      } else {
        if (metric.value !== null || metric.unit !== null || metric.denominator !== null || metric.threshold !== null) {
          addInvalid(metricPath, 'UNASSESSED_METRIC_SHAPE');
        }
        requireText(metric.reason, `${metricPath}.reason`);
        if (metric.status === 'NOT_ASSESSED' && metric.name !== 'OOS_HOLDOUT') {
          addInvalid(`${metricPath}.status`, 'REQUIRED_EVIDENCE_NOT_ASSESSED');
        }
        if (metric.name === 'OOS_HOLDOUT' && mustAssessHoldout && metric.status !== 'ASSESSED') {
          addInvalid(`${metricPath}.status`, 'HOLDOUT_EVIDENCE_REQUIRED');
        }
      }
    }
    for (const name of METRICS) if (!seen.has(name)) addMissing(`${path}.metrics.${name}`, 'METRIC_REQUIRED');
  }
}
