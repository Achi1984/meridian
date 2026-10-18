import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {
  ASSETS, BUDGET, IMPLEMENTATION_ID, INPUT, PROTOCOL_ID, PROTOCOL_SHA256,
  SCENARIOS, SEGMENTS, VARIANTS, validateSeries, validateSourceIdentity
} from './validate.mjs';

const HASH = /^[a-f0-9]{64}$/;
const CAPITAL = 10000;
const FEE_TOLERANCE = 1e-6;
const NO_HOLDOUT = 'HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT';
const INPUT_ROW_KEYS = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'trades'];

export function canonicalJson(value, checkpoint = () => {}) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value) {
      checkpoint('canonical-array');
      items.push(canonicalJson(item, checkpoint));
    }
    return `[${items.join(',')}]`;
  }
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    checkpoint('canonical-object');
    entries.push(`${JSON.stringify(key)}:${canonicalJson(value[key], checkpoint)}`);
  }
  return `{${entries.join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fail(code, detail = null) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  throw error;
}

function sampleStandardDeviation(values, checkpoint = () => {}) {
  if (!Array.isArray(values) || values.length < 2) return NaN;
  let sum = 0;
  for (const value of values) {
    checkpoint('standard-deviation-mean');
    if (!finite(value)) return NaN;
    sum += value;
  }
  const mean = sum / values.length;
  let squaredDeviation = 0;
  for (const value of values) {
    checkpoint('standard-deviation-variance');
    squaredDeviation += (value - mean) ** 2;
  }
  const variance = squaredDeviation / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values, checkpoint = () => {}) {
  if (!values.length) return NaN;
  if (values.some(value => !finite(value))) return NaN;
  const ordered = [...values].sort((left, right) => {
    checkpoint('median-sort');
    return left - right;
  });
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function acceptsTarget(rawExposure, lastAccepted) {
  return Math.abs(rawExposure - lastAccepted) >= 0.10;
}

export function deriveFeatures(seriesByAsset, variant, checkpoint = () => {}) {
  const count = INPUT.rowCount;
  const basketReturns = new Array(count).fill(null);
  for (let index = 1; index < count; index++) {
    checkpoint('basket-return');
    const returns = ASSETS.map(asset => {
      const prior = seriesByAsset[asset][index - 1].close;
      const current = seriesByAsset[asset][index].close;
      return current / prior - 1;
    });
    const basketReturn = returns.reduce((sum, value) => sum + value, 0) / ASSETS.length;
    if (!finite(basketReturn)) fail('INVALID_SIGNAL', {index, reason: 'NONFINITE_BASKET_RETURN'});
    basketReturns[index] = basketReturn;
  }

  const sigmas = new Array(count).fill(null);
  for (let index = variant.window; index < count; index++) {
    checkpoint('annualized-volatility');
    const window = basketReturns.slice(index - variant.window + 1, index + 1);
    const deviation = sampleStandardDeviation(window, checkpoint);
    const sigma = deviation * Math.sqrt(365);
    if (!finite(sigma)) fail('INVALID_SIGNAL', {index, reason: 'NONFINITE_SIGMA'});
    sigmas[index] = sigma;
  }

  const result = new Array(count).fill(null);
  const firstSignalIndex = variant.window + 364;
  for (let index = firstSignalIndex; index < count; index++) {
    checkpoint('rolling-volatility-median');
    const rolling = sigmas.slice(index - 364, index + 1);
    if (rolling.length !== 365 || rolling.some(value => !finite(value))) {
      fail('INVALID_SIGNAL', {index, reason: 'INCOMPLETE_MEDIAN_WINDOW'});
    }
    const currentSigma = sigmas[index];
    const rollingMedian = median(rolling, checkpoint);
    if (!finite(currentSigma) || currentSigma <= 1e-12 ||
      !finite(rollingMedian) || rollingMedian <= 0) {
      fail('INVALID_SIGNAL', {index, reason: 'ZERO_OR_INVALID_VOLATILITY'});
    }
    const rawExposure = Math.min(1, Math.max(variant.floor, rollingMedian / currentSigma));
    if (!finite(rawExposure)) fail('INVALID_SIGNAL', {index, reason: 'NONFINITE_TARGET'});
    result[index] = {sigma: currentSigma, median: rollingMedian, rawExposure};
  }
  return result;
}

export function buildSchedule(rows, features, segment, delayDays = 0, checkpoint = () => {}) {
  const decisions = [];
  const fills = [];
  const cancelled = [];
  let lastAccepted = null;
  const schedule = (decisionIndex, rawExposure, initial = false) => {
    let accepted = initial;
    if (initial) lastAccepted = rawExposure;
    else if (acceptsTarget(rawExposure, lastAccepted)) {
      lastAccepted = rawExposure;
      accepted = true;
    }
    const fillIndex = decisionIndex + 1 + delayDays;
    const decision = {
      decisionIndex,
      decisionTimestamp: rows[decisionIndex].timestamp,
      rawExposure,
      acceptedExposure: lastAccepted,
      accepted,
      fillIndex,
      fillTimestamp: fillIndex < rows.length ? rows[fillIndex].timestamp : null,
      target: lastAccepted
    };
    decisions.push(decision);
    const instruction = Object.freeze({
      decisionIndex,
      fillIndex,
      target: lastAccepted,
      decisionTimestamp: decision.decisionTimestamp
    });
    if (fillIndex > segment.endIndex) cancelled.push({...instruction, reason: 'BEYOND_SEGMENT_HORIZON'});
    else if (fillIndex < segment.startIndex) fail('INVALID_SCHEDULE', {fillIndex});
    else fills.push(instruction);
  };

  const initialIndex = segment.startIndex - 1;
  const initialFeature = features[initialIndex];
  if (!initialFeature) fail('INVALID_SIGNAL', {index: initialIndex, reason: 'INITIAL_TARGET_MISSING'});
  schedule(initialIndex, initialFeature.rawExposure, true);
  for (let index = segment.startIndex; index <= segment.endIndex; index++) {
    checkpoint('schedule-row');
    if (new Date(rows[index].timestamp).getUTCDay() !== 0) continue;
    const feature = features[index];
    if (!feature) fail('INVALID_SIGNAL', {index, reason: 'WEEKLY_TARGET_MISSING'});
    schedule(index, feature.rawExposure);
  }
  return {decisions, fills, cancelled};
}

function fixedSchedule(rows, segment, target, delayDays, checkpoint = () => {}) {
  const decisions = [];
  const fills = [];
  const cancelled = [];
  const firstIndex = segment.startIndex - 1;
  for (let index = firstIndex; index <= segment.endIndex; index++) {
    checkpoint('fixed-schedule-row');
    const initial = index === firstIndex;
    if (!initial && new Date(rows[index].timestamp).getUTCDay() !== 0) continue;
    const fillIndex = index + 1 + delayDays;
    const instruction = Object.freeze({
      decisionIndex: index,
      fillIndex,
      target,
      decisionTimestamp: rows[index].timestamp
    });
    decisions.push({
      decisionIndex: index,
      decisionTimestamp: rows[index].timestamp,
      rawExposure: target,
      acceptedExposure: target,
      accepted: initial,
      fillIndex,
      fillTimestamp: fillIndex < rows.length ? rows[fillIndex].timestamp : null,
      target
    });
    if (fillIndex > segment.endIndex) cancelled.push({...instruction, reason: 'BEYOND_SEGMENT_HORIZON'});
    else fills.push(instruction);
  }
  return {decisions, fills, cancelled};
}

function closeValue(units, prices) {
  return units.reduce((sum, quantity, index) => sum + quantity * prices[index], 0);
}

function selfFinancingFill(state, prices, target, feeRate, date, checkpoint = () => {}) {
  const previousEquity = state.cash + closeValue(state.units, prices);
  if (!finite(previousEquity) || previousEquity <= 0) fail('INVALID_ACCOUNTING', {date, reason: 'NONPOSITIVE_VALUE'});
  const weights = new Array(ASSETS.length).fill(target / ASSETS.length);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (!finite(target) || target < 0 || target > 1 || weightSum > 1 + Number.EPSILON ||
    prices.some(price => !finite(price) || price <= 0)) {
    fail('INVALID_ACCOUNTING', {date, reason: 'INVALID_TARGET_OR_PRICE'});
  }
  const costAt = equity => feeRate * weights.reduce((total, weight, index) =>
    total + Math.abs(weight * equity - state.units[index] * prices[index]), 0);
  let low = 0;
  let high = previousEquity;
  let equity = high / 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    checkpoint('fill-bisection');
    equity = (low + high) / 2;
    const residual = equity + costAt(equity) - previousEquity;
    if (!finite(residual)) fail('INVALID_ACCOUNTING', {date, reason: 'NONFINITE_BISECTION'});
    if (Math.abs(residual) <= FEE_TOLERANCE) break;
    if (residual > 0) high = equity;
    else low = equity;
  }
  const cost = costAt(equity);
  const nextUnits = weights.map((weight, index) => weight * equity / prices[index]);
  const nextCash = (1 - weightSum) * equity;
  const conservationResidual = nextCash + closeValue(nextUnits, prices) + cost - previousEquity;
  if (!finite(cost) || cost < 0 || !finite(nextCash) || nextCash < 0 ||
    nextUnits.some(quantity => !finite(quantity) || quantity < 0) ||
    !finite(conservationResidual) || Math.abs(conservationResidual) > FEE_TOLERANCE) {
    fail('INVALID_ACCOUNTING', {date, reason: 'FILL_CONSERVATION_FAILED', conservationResidual});
  }
  const turnover = weights.reduce((total, weight, index) =>
    total + Math.abs(weight * equity - state.units[index] * prices[index]), 0);
  state.cash = nextCash;
  state.units = nextUnits;
  return {
    date,
    kind: 'REBALANCE',
    turnover,
    cost,
    cumulativeCost: state.cumulativeCost + cost,
    equityAfterFees: equity,
    cashAfterFees: state.cash,
    conservationResidual
  };
}

function liquidateAtClose(state, prices, feeRate, date) {
  const markedEquity = state.cash + closeValue(state.units, prices);
  const turnover = closeValue(state.units, prices);
  const cost = feeRate * turnover;
  const nextCash = markedEquity - cost;
  if (!finite(nextCash) || nextCash < 0 || !finite(cost)) {
    fail('INVALID_ACCOUNTING', {date, reason: 'TERMINAL_LIQUIDATION_FAILED'});
  }
  state.units = new Array(ASSETS.length).fill(0);
  state.cash = nextCash;
  return {
    date,
    kind: 'TERMINAL_LIQUIDATION',
    turnover,
    cost,
    cumulativeCost: state.cumulativeCost + cost,
    equityAfterFees: nextCash,
    cashAfterFees: nextCash,
    conservationResidual: state.cash + cost - markedEquity
  };
}

function quarterlyReturns(dates, equity, checkpoint = () => {}) {
  const quarters = [];
  let startEquity = CAPITAL;
  let quarter = null;
  let endEquity = CAPITAL;
  for (let index = 0; index < dates.length; index++) {
    checkpoint('quarterly-return');
    const date = new Date(dates[index]);
    const nextQuarter = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    if (quarter !== nextQuarter) {
      if (quarter !== null) quarters.push({quarter, netReturn: endEquity / startEquity - 1});
      quarter = nextQuarter;
      startEquity = index === 0 ? CAPITAL : equity[index - 1];
    }
    endEquity = equity[index];
  }
  if (quarter !== null) quarters.push({quarter, netReturn: endEquity / startEquity - 1});
  return quarters;
}

export function calculateDrawdown(equity, checkpoint = () => {}) {
  let peak = CAPITAL;
  let drawdownDuration = 0;
  let maxDrawdownDuration = 0;
  let sampledDrawdown = 0;
  for (const value of equity) {
    checkpoint('drawdown-row');
    if (!finite(value) || value < 0) fail('INVALID_ACCOUNTING', {reason: 'INVALID_DRAWDOWN_EQUITY'});
    if (value >= peak) {
      peak = value;
      drawdownDuration = 0;
    } else {
      drawdownDuration++;
      maxDrawdownDuration = Math.max(maxDrawdownDuration, drawdownDuration);
      sampledDrawdown = Math.max(sampledDrawdown, 1 - value / peak);
    }
  }
  return {sampledDrawdown, maxDrawdownDuration};
}

function simulatePath({seriesByAsset, descriptor, scenario, targetSource, checkpoint = () => {}}) {
  const segment = SEGMENTS[descriptor.segmentId];
  const rows = seriesByAsset[ASSETS[0]];
  let schedule;
  if (descriptor.kind === 'CASH') {
    schedule = {decisions: [], fills: [], cancelled: []};
  } else if (descriptor.kind === 'CANDIDATE') {
    schedule = buildSchedule(rows, targetSource.features, segment, scenario.delayDays, checkpoint);
  } else {
    schedule = fixedSchedule(rows, segment, descriptor.target, scenario.delayDays, checkpoint);
  }

  const state = {cash: CAPITAL, units: new Array(ASSETS.length).fill(0), cumulativeCost: 0};
  const fillsByIndex = new Map(schedule.fills.map(fill => [fill.fillIndex, fill]));
  const dailyEquity = [];
  const dailyReturns = [];
  const dailyTarget = [];
  const dates = [];
  const fillCosts = [];
  let previousEquity = CAPITAL;
  let heldTarget = 0;
  let totalTurnover = 0;
  let totalRealizedExposure = 0;
  let totalAbsoluteTargetMismatch = 0;
  let maxAbsoluteTargetMismatch = 0;
  let maxConcentration = 0;

  for (let index = segment.startIndex; index <= segment.endIndex; index++) {
    checkpoint('simulation-row');
    const date = rows[index].timestamp;
    dates.push(date);
    const openPrices = ASSETS.map(asset => seriesByAsset[asset][index].open);
    const scheduled = fillsByIndex.get(index);
    if (scheduled) {
      heldTarget = scheduled.target;
      if (descriptor.kind !== 'CASH') {
        const fill = selfFinancingFill(
          state, openPrices, heldTarget, scenario.costRate, date, checkpoint
        );
        state.cumulativeCost += fill.cost;
        totalTurnover += fill.turnover;
        fill.cumulativeCost = state.cumulativeCost;
        fillCosts.push(fill);
      }
    }
    const closePrices = ASSETS.map(asset => seriesByAsset[asset][index].close);
    let closeEquity = state.cash + closeValue(state.units, closePrices);
    if (!finite(closeEquity) || closeEquity < 0) fail('INVALID_ACCOUNTING', {date, reason: 'INVALID_CLOSE_EQUITY'});
    const markedPositions = closeValue(state.units, closePrices);
    const realizedExposure = closeEquity > 0 ? markedPositions / closeEquity : 0;
    const absoluteTargetMismatch = Math.abs(realizedExposure - heldTarget);
    if (!finite(realizedExposure) || realizedExposure < 0 || !finite(absoluteTargetMismatch)) {
      fail('INVALID_ACCOUNTING', {date, reason: 'INVALID_EXPOSURE_MISMATCH'});
    }
    totalRealizedExposure += realizedExposure;
    totalAbsoluteTargetMismatch += absoluteTargetMismatch;
    maxAbsoluteTargetMismatch = Math.max(maxAbsoluteTargetMismatch, absoluteTargetMismatch);
    if (markedPositions > 0) {
      for (const quantityIndex of ASSETS.keys()) {
        checkpoint('concentration-asset');
        const weight = state.units[quantityIndex] * closePrices[quantityIndex] / closeEquity;
        if (!finite(weight) || weight < 0) fail('INVALID_ACCOUNTING', {date, reason: 'INVALID_CONCENTRATION'});
        if (weight > maxConcentration) maxConcentration = weight;
      }
    }
    if (index === segment.endIndex && descriptor.kind !== 'CASH') {
      const terminal = liquidateAtClose(state, closePrices, scenario.costRate, date);
      state.cumulativeCost += terminal.cost;
      totalTurnover += terminal.turnover;
      terminal.cumulativeCost = state.cumulativeCost;
      fillCosts.push(terminal);
      closeEquity = state.cash;
    }
    const dailyReturn = closeEquity / previousEquity - 1;
    if (!finite(dailyReturn)) fail('INVALID_ACCOUNTING', {date, reason: 'NONFINITE_DAILY_RETURN'});
    dailyEquity.push(closeEquity);
    dailyReturns.push(dailyReturn);
    dailyTarget.push(heldTarget);
    previousEquity = closeEquity;

  }

  const {sampledDrawdown, maxDrawdownDuration} = calculateDrawdown(dailyEquity, checkpoint);
  return {
    pathId: descriptor.pathId,
    variantId: descriptor.variantId,
    scenarioId: descriptor.scenarioId,
    segmentId: descriptor.segmentId,
    status: 'COMPLETED',
    attempts: 1,
    computed: true,
    observationClass: NO_HOLDOUT,
    tradeCRV: {status: 'UNDEFINED_NO_FINITE_STOP', value: null, promotionEligible: false},
    rows: segment.rows,
    startEquity: CAPITAL,
    endEquity: dailyEquity.at(-1),
    netReturn: dailyEquity.at(-1) / CAPITAL - 1,
    sampledDrawdown,
    maxDrawdownDuration,
    dailyReturnCount: dailyReturns.length,
    dailyReturnSd: sampleStandardDeviation(dailyReturns, checkpoint),
    meanHeldTarget: dailyTarget.reduce((sum, value) => sum + value, 0) / dailyTarget.length,
    meanRealizedExposure: totalRealizedExposure / dailyTarget.length,
    meanTargetRealizedMismatch:
      (totalRealizedExposure - dailyTarget.reduce((sum, value) => sum + value, 0)) / dailyTarget.length,
    meanAbsoluteTargetMismatch: totalAbsoluteTargetMismatch / dailyTarget.length,
    maxAbsoluteTargetMismatch,
    diagnosticRescaling: 'NONE',
    maxConcentration,
    turnoverNotional: totalTurnover,
    turnoverOnInitialEquity: totalTurnover / CAPITAL,
    totalCosts: state.cumulativeCost,
    fillCostCount: fillCosts.length,
    fillCosts,
    cancelledInstructionCount: schedule.cancelled.length,
    cancelledInstructions: schedule.cancelled,
    quarterlyReturns: quarterlyReturns(dates, dailyEquity, checkpoint),
    dailyReturns,
    dailyHeldTarget: dailyTarget
  };
}

export function deriveControlExposures(
  primaryDailyReturns, benchmarkDailyReturns, primaryHeldTarget, checkpoint = () => {}
) {
  let targetTotal = 0;
  for (const value of primaryHeldTarget) {
    checkpoint('control-mean-exposure');
    targetTotal += value;
  }
  const meanExposure = targetTotal / primaryHeldTarget.length;
  const primarySd = sampleStandardDeviation(primaryDailyReturns, checkpoint);
  const benchmarkSd = sampleStandardDeviation(benchmarkDailyReturns, checkpoint);
  if (!finite(meanExposure) || !finite(primarySd) || !finite(benchmarkSd) || benchmarkSd <= 1e-12) {
    return {
      ok: false,
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR',
      primarySd: finite(primarySd) ? primarySd : null,
      benchmarkSd: finite(benchmarkSd) ? benchmarkSd : null
    };
  }
  return {
    ok: true,
    status: 'FROZEN_DEVELOPMENT_ONLY',
    meanExposure,
    riskExposure: primarySd === 0 ? 0 : Math.min(1, primarySd / benchmarkSd),
    primarySd,
    benchmarkSd,
    calibration: 'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'
  };
}

function descriptors() {
  const result = [];
  for (const variant of VARIANTS) {
    for (const scenario of SCENARIOS) {
      for (const segment of Object.values(SEGMENTS)) {
        result.push({
          kind: 'CANDIDATE',
          variantId: variant.id,
          variant,
          scenarioId: scenario.id,
          scenario,
          segmentId: segment.id
        });
      }
    }
  }
  for (const scenario of SCENARIOS) {
    for (const segment of Object.values(SEGMENTS)) {
      result.push({
        kind: 'FULL_BASKET',
        variantId: 'full-basket-weekly',
        target: 1,
        scenarioId: scenario.id,
        scenario,
        segmentId: segment.id
      });
    }
  }
  for (const controlId of ['frozen-mean-exposure', 'frozen-risk-exposure']) {
    for (const scenario of SCENARIOS) {
      result.push({
        kind: 'FIXED_CONTROL',
        variantId: controlId,
        scenarioId: scenario.id,
        scenario,
        segmentId: 'diagnostic'
      });
    }
  }
  for (const segment of Object.values(SEGMENTS)) {
    result.push({
      kind: 'CASH',
      variantId: 'cash-zero',
      target: 0,
      scenarioId: 'scenario-independent',
      scenario: {id: 'scenario-independent', costRate: 0, delayDays: 0},
      segmentId: segment.id
    });
  }
  return result;
}

function inputIdentity(seriesByAsset, source, checkpoint = () => {}) {
  const seriesHashes = {};
  for (const asset of ASSETS) {
    checkpoint('input-identity-asset');
    seriesHashes[asset] = sha256(canonicalJson(seriesByAsset[asset], checkpoint));
  }
  const identity = {
    datasetKind: source.kind,
    sourceCommit: source.kind === 'FROZEN_RESEARCH_INPUT' ? source.commit : 'SYNTHETIC_FIXTURE',
    sourceProvenance: source.kind === 'FROZEN_RESEARCH_INPUT'
      ? {normalizedFileSha256: source.files}
      : {syntheticFixtureSeriesSha256: seriesHashes},
    canonicalSeriesSha256: seriesHashes
  };
  return {...identity, inputSha256: sha256(canonicalJson(identity, checkpoint))};
}

function snapshotDataRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail('UNSAFE_INPUT_SHAPE');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) {
    fail('UNSAFE_INPUT_SHAPE');
  }
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('UNSAFE_INPUT_SHAPE');
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function snapshotSource(source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source) ||
      (Object.getPrototypeOf(source) !== Object.prototype && Object.getPrototypeOf(source) !== null)) {
    fail('UNSAFE_INPUT_SHAPE');
  }
  const kind = Object.getOwnPropertyDescriptor(source, 'kind');
  if (!kind?.enumerable || !Object.hasOwn(kind, 'value')) fail('UNSAFE_INPUT_SHAPE');
  const keys = kind.value === 'FROZEN_RESEARCH_INPUT'
    ? ['kind', 'commit', 'files']
    : ['kind'];
  const snapshot = snapshotDataRecord(source, keys);
  if (kind.value === 'FROZEN_RESEARCH_INPUT') {
    snapshot.files = Object.freeze(snapshotDataRecord(snapshot.files, ASSETS));
  }
  if (Object.hasOwn(snapshot, 'files')) Object.freeze(snapshot.files);
  return Object.freeze(snapshot);
}

function snapshotSeries(seriesByAsset) {
  const input = snapshotDataRecord(seriesByAsset, ASSETS);
  const snapshot = Object.create(null);
  for (const asset of ASSETS) {
    const inputRows = input[asset];
    if (!Array.isArray(inputRows)) fail('UNSAFE_INPUT_SHAPE');
    const lengthDescriptor = Object.getOwnPropertyDescriptor(inputRows, 'length');
    const length = lengthDescriptor?.value;
    if (length !== INPUT.rowCount) fail('UNSAFE_INPUT_SHAPE');
    const ownKeys = Reflect.ownKeys(inputRows);
    if (ownKeys.length !== length + 1 ||
        ownKeys.some(key => key !== 'length' &&
          (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)))) {
      fail('UNSAFE_INPUT_SHAPE');
    }
    const rows = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(inputRows, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('UNSAFE_INPUT_SHAPE');
      rows.push(Object.freeze(snapshotDataRecord(descriptor.value, INPUT_ROW_KEYS)));
    }
    snapshot[asset] = Object.freeze(rows);
  }
  return Object.freeze(snapshot);
}

function bindDescriptors(items, identity, implementationSha256, checkpoint = () => {}) {
  return items.map(item => {
    checkpoint('bind-path-identity');
    const pathIdentity = {
      protocolId: PROTOCOL_ID,
      protocolSha256: PROTOCOL_SHA256,
      implementationId: IMPLEMENTATION_ID,
      implementationSha256,
      inputSha256: identity.inputSha256,
      canonicalSeriesSha256: identity.canonicalSeriesSha256,
      variantId: item.variantId,
      scenarioId: item.scenarioId,
      segmentId: item.segmentId
    };
    return {
      ...item,
      pathId: sha256(canonicalJson(pathIdentity, checkpoint)),
      identity: pathIdentity
    };
  });
}

export function createBudgetTracker(clock = () => performance.now(), {
  trustedBatchStart = performance.now(),
  preparationElapsedMs = 0
} = {}) {
  const batchStart = clock({phase: 'batch-start'});
  let lastClock = batchStart;
  let stopped = false;
  let stopError = null;
  let activePathId = null;
  let activePathOrdinal = null;
  let pathStart = null;
  let trustedPathStart = null;
  const readClock = context => {
    const now = clock(context);
    if (!finite(now) || now < lastClock) {
      fail('INVALID_BUDGET_CLOCK', {phase: context.phase, now, previous: lastClock});
    }
    lastClock = now;
    return now;
  };
  const checkpoint = phase => {
    if (stopError) throw stopError;
    const now = readClock({phase, pathId: activePathId, pathOrdinal: activePathOrdinal});
    const totalElapsed = Math.max(
      now - batchStart + preparationElapsedMs,
      performance.now() - trustedBatchStart
    );
    const pathElapsed = pathStart === null ? null : Math.max(
      now - pathStart,
      performance.now() - trustedPathStart
    );
    if (totalElapsed > BUDGET.totalMs || pathElapsed > BUDGET.pathMs) {
      stopped = true;
      try {
        fail('BUDGET_EXCEEDED', {
          status: totalElapsed > BUDGET.totalMs ? 'INVALID_TOTAL_BUDGET' : 'INVALID_PATH_BUDGET',
          phase,
          pathElapsed,
          totalElapsed
        });
      } catch (error) {
        stopError = error;
        throw error;
      }
    }
  };
  return {
    checkpoint,
    run(pathId, pathOrdinal, operation) {
      if (typeof pathOrdinal === 'function') {
        operation = pathOrdinal;
        pathOrdinal = 1;
      }
      if (stopped) return {status: 'NOT_RUN_BATCH_ABORT', attempts: 0, result: null};
      activePathId = pathId;
      activePathOrdinal = pathOrdinal;
      let result;
      try {
        trustedPathStart = performance.now();
        pathStart = readClock({phase: 'path-start', pathId, pathOrdinal});
        checkpoint('path-start-check');
        result = operation(checkpoint);
        checkpoint('path-end-check');
      } catch (error) {
        stopped = true;
        stopError ??= error;
        const budgetStatus = error.code === 'BUDGET_EXCEEDED'
          ? error.detail?.status : null;
        activePathId = null;
        activePathOrdinal = null;
        pathStart = null;
        trustedPathStart = null;
        return {
          status: budgetStatus ?? 'INVALID',
          attempts: 1,
          result: null,
          failure: {code: error.code ?? 'PATH_FAILED', detail: error.detail ?? null}
        };
      }
      activePathId = null;
      activePathOrdinal = null;
      pathStart = null;
      trustedPathStart = null;
      return {status: 'COMPLETED', attempts: 1, result};
    },
    get stopped() {
      return stopped;
    }
  };
}

export function screenResults(paths, controlDefinitions, checkpoint = () => {}) {
  const byKey = new Map();
  for (const path of paths) {
    checkpoint('screen-index');
    byKey.set(`${path.variantId}|${path.scenarioId}|${path.segmentId}`, path);
  }
  const get = (variant, scenario, segment) => byKey.get(`${variant}|${scenario}|${segment}`);
  const primary = get('primary-n30-f25', 'base-15bp', 'diagnostic');
  const full = get('full-basket-weekly', 'base-15bp', 'diagnostic');
  const meanControl = get('frozen-mean-exposure', 'base-15bp', 'diagnostic');
  const riskControl = get('frozen-risk-exposure', 'base-15bp', 'diagnostic');
  const stressed = get('primary-n30-f25', 'stress-30bp', 'diagnostic');
  const delayed = get('primary-n30-f25', 'stress-30bp-delay-1d', 'diagnostic');
  const neighbours = VARIANTS.slice(1);
  const neighbourPaths = neighbours.map(variant => [
    get(variant.id, 'base-15bp', 'diagnostic'),
    get(variant.id, 'stress-30bp', 'diagnostic')
  ]);
  const required = [primary, full, meanControl, riskControl, stressed, delayed,
    ...neighbourPaths.flat()];
  if (required.some(path => !path || path.status !== 'COMPLETED' ||
      !finite(path.netReturn) || !finite(path.sampledDrawdown)) ||
    controlDefinitions?.status !== 'FROZEN_DEVELOPMENT_ONLY') {
    return {status: 'INSUFFICIENT_EVIDENCE', checks: {}, relativeDrawdownReduction: null};
  }
  let basePositive = 0;
  let stressPositive = 0;
  for (const [base, stress] of neighbourPaths) {
    checkpoint('screen-neighbour');
    if (base.netReturn > 0) basePositive++;
    if (stress.netReturn > 0) stressPositive++;
  }
  if (full.sampledDrawdown <= 1e-12) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      checks: {fullBasketDrawdownDenominator: false},
      relativeDrawdownReduction: null
    };
  }
  const relativeDrawdownReduction = (full.sampledDrawdown - primary.sampledDrawdown) / full.sampledDrawdown;
  const checks = {
    primaryDiagnosticNetPositive: primary.netReturn > 0,
    primaryDiagnosticDrawdownAtMost25Percent: primary.sampledDrawdown <= 0.25,
    primaryReturnAtLeastBothFrozenControls:
      primary.netReturn >= meanControl.netReturn && primary.netReturn >= riskControl.netReturn,
    primaryDrawdownAtMostBothFrozenControls:
      primary.sampledDrawdown <= meanControl.sampledDrawdown &&
      primary.sampledDrawdown <= riskControl.sampledDrawdown,
    relativeDrawdownReductionAtLeast20Percent: relativeDrawdownReduction >= 0.20,
    primaryNetPositiveAt30bpNonDelayed: stressed.netReturn > 0,
    primaryNetPositiveAt30bpPlusDelay: delayed.netReturn > 0,
    atLeastThreeOfFourNeighboursPositiveAt15bp: basePositive >= 3,
    atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed: stressPositive >= 3
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'PASS' : 'NO_EDGE',
    interpretation: 'HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT',
    comparisonSegment: 'diagnostic',
    neighbourStressScenario: 'stress-30bp-non-delayed',
    checks,
    relativeDrawdownReduction,
    neighbourPositiveCounts: {base15bp: basePositive, stress30bp: stressPositive},
    stopPolicy: 'NO_FINITE_TRADE_STOP',
    tradeCRV: {status: 'UNDEFINED_NO_FINITE_STOP', value: null}
  };
}

function pathFailureRecord(descriptor, status, attempts, failure = null) {
  return {
    pathId: descriptor.pathId,
    kind: descriptor.kind,
    variantId: descriptor.variantId,
    scenarioId: descriptor.scenarioId,
    segmentId: descriptor.segmentId,
    status,
    attempts,
    computed: false,
    failure
  };
}

function emptyResult(status, code, errors = []) {
  const plan = descriptors().map(item => ({
    kind: item.kind,
    variantId: item.variantId,
    scenarioId: item.scenarioId,
    segmentId: item.segmentId,
    pathId: null,
    status: 'NOT_RUN_INPUT_INVALID',
    attempts: 0,
    computed: false
  }));
  return {
    schema: 'MERIDIAN_B1_7_ENGINE_RESULT_R3',
    protocolId: PROTOCOL_ID,
    protocolSha256: PROTOCOL_SHA256,
    status,
    failure: {code, errors},
    attemptedPaths: 0,
    completedPaths: 0,
    computedPaths: 0,
    plannedPaths: BUDGET.paths,
    paths: plan,
    screen: {status: 'NOT_EVALUATED'},
    budget: {
      limits: BUDGET,
      attemptsPerStartedPath: 1,
      automaticRetry: false,
      status: 'NOT_STARTED'
    },
    authority: authority(),
    evidence: {
      priceSource: 'NOT_EVALUATED',
      costModel: 'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
      executionEvidence: 'NOT_OKX_EXECUTION_EVIDENCE',
      sourceAuthenticity: 'NOT_ESTABLISHED',
      holdoutClaim: false,
      trialLedger: 'UNKNOWN',
      stoppedPolicy: 'NO_FINITE_TRADE_STOP',
      crv: {status: 'UNDEFINED_NO_FINITE_STOP', value: null, researchOnly: true}
    },
    trialLedger: 'UNKNOWN',
    protocolReview: {
      r1RequestId: 'MERIDIAN-B1-7-DESIGN-R1',
      r1ResponseComment: '6249442046',
      r1Verdict: 'REVISION_REQUIRED',
      r2RequestId: 'MERIDIAN-B1-7-DESIGN-R2',
      r2ResponseComment: '6249482850',
      r2Verdict: 'GREEN_LIGHT_DESIGN_ONLY',
      r2Scope: 'HISTORICAL_R2_ONLY_NOT_APPROVAL_FOR_R3',
      r3Review: 'PENDING'
    }
  };
}

function budgetFailureResult(error) {
  const output = emptyResult('INVALID', error.code, [
    {code: error.code, detail: error.detail ?? null}
  ]);
  output.failure = {code: error.code, detail: error.detail ?? null};
  output.paths = output.paths.map(path => ({...path, status: 'NOT_RUN_BATCH_ABORT'}));
  output.budget.status = 'FAILED_NO_RETRY';
  return output;
}

function authority() {
  return {
    researchOnly: true,
    executionAuthorized: false,
    strategyPnlAuthorized: false,
    discoveryAuthorized: false,
    validationAuthorized: false,
    holdoutAuthorized: false,
    paperAuthorized: false,
    liveAuthorized: false
  };
}

function compactIfOverBudget(output, checkpoint = () => {}) {
  checkpoint('output-serialize-before');
  const bytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  checkpoint('output-serialize-after');
  if (bytes <= BUDGET.outputBytes) return output;
  const paths = [];
  for (const path of output.paths) {
    checkpoint('output-compact-path');
    paths.push({
      pathId: path.pathId,
      kind: path.kind,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId,
      status: path.status === 'COMPLETED' ? 'INCOMPLETE_OUTPUT_BUDGET' : path.status,
      attempts: path.attempts,
      computed: path.status === 'COMPLETED',
      outputOmitted: path.status === 'COMPLETED' ? 'GLOBAL_OUTPUT_BUDGET_EXCEEDED' : null
    });
  }
  const compact = {
    schema: output.schema,
    protocolId: output.protocolId,
    protocolSha256: output.protocolSha256,
    status: 'INVALID',
    failure: {code: 'OUTPUT_BUDGET_EXCEEDED', bytes, limit: BUDGET.outputBytes},
    identity: output.identity,
    executionId: output.executionId,
    attemptedPaths: output.attemptedPaths,
    completedPaths: 0,
    computedPaths: output.computedPaths,
    plannedPaths: BUDGET.paths,
    paths,
    screen: {status: 'NOT_EVALUATED'},
    authority: authority(),
    trialLedger: 'UNKNOWN'
  };
  checkpoint('output-compact-serialize-before');
  JSON.stringify(compact);
  checkpoint('output-compact-serialize-after');
  return compact;
}

function* executeBatch(options) {
  const trustedBatchStart = performance.now();
  let tracker;
  let batch;
  try {
    const keys = ['seriesByAsset', 'source', 'implementationSha256', 'syntheticClock'];
    if (options === null || typeof options !== 'object' || Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) {
      return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
    }
    const ownKeys = Reflect.ownKeys(options);
    if (ownKeys.length < 3 || ownKeys.length > keys.length ||
      ownKeys.some(key => !keys.includes(key)) ||
      keys.slice(0, 3).some(key => !ownKeys.includes(key))) {
      return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
    }
    batch = {};
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
      }
      batch[key] = descriptor.value;
    }
  } catch {
    return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
  }
  const {implementationSha256} = batch;
  let seriesByAsset;
  let source;
  if (!HASH.test(PROTOCOL_SHA256)) {
    return emptyResult('INVALID', 'PROTOCOL_HASH_NOT_FROZEN');
  }
  if (typeof implementationSha256 !== 'string' || !HASH.test(implementationSha256)) {
    return emptyResult('INVALID', 'IMPLEMENTATION_HASH_REQUIRED');
  }
  let preparationElapsedMs;
  try {
    seriesByAsset = snapshotSeries(batch.seriesByAsset);
    source = snapshotSource(batch.source);
  } catch (error) {
    return emptyResult('INVALID', error.code ?? 'INPUT_SNAPSHOT_FAILED', [
      {code: error.code ?? 'INPUT_SNAPSHOT_FAILED', detail: error.detail ?? null}
    ]);
  }
  const sourceCheck = validateSourceIdentity(source);
  if (!sourceCheck.ok) return emptyResult('INVALID', sourceCheck.error.code, [sourceCheck.error]);
  if (Object.hasOwn(batch, 'syntheticClock') &&
    (source.kind !== 'SYNTHETIC_FIXTURE' || typeof batch.syntheticClock !== 'function')) {
    return emptyResult('INVALID', 'SYNTHETIC_CLOCK_NOT_ALLOWED');
  }
  preparationElapsedMs = performance.now() - trustedBatchStart;
  tracker = createBudgetTracker(batch.syntheticClock, {trustedBatchStart, preparationElapsedMs});
  let inputCheck;
  try {
    inputCheck = validateSeries(seriesByAsset, tracker.checkpoint);
    tracker.checkpoint('validation-complete');
  } catch (error) {
    if (error.code === 'BUDGET_EXCEEDED') return budgetFailureResult(error);
    return emptyResult('INVALID', error.code ?? 'INPUT_VALIDATION_FAILED', [
      {code: error.code ?? 'INPUT_VALIDATION_FAILED', detail: error.detail ?? null}
    ]);
  }
  if (!inputCheck.ok) return emptyResult('INVALID', 'INPUT_INVALID', inputCheck.errors);

  let identity;
  let allDescriptors;
  try {
    tracker.checkpoint('input-identity-start');
    identity = inputIdentity(seriesByAsset, source, tracker.checkpoint);
    tracker.checkpoint('input-identity-complete');
    allDescriptors = bindDescriptors(
      descriptors(), identity, implementationSha256, tracker.checkpoint
    );
  } catch (error) {
    if (error.code === 'BUDGET_EXCEEDED') return budgetFailureResult(error);
    return emptyResult('INVALID', error.code ?? 'INPUT_IDENTITY_FAILED', [
      {code: error.code ?? 'INPUT_IDENTITY_FAILED', detail: error.detail ?? null}
    ]);
  }
  if (allDescriptors.length !== BUDGET.paths) return emptyResult('INVALID', 'PATH_PLAN_MISMATCH');
  const pathRecords = new Map(allDescriptors.map(item =>
    [item.pathId, pathFailureRecord(item, 'NOT_RUN', 0)]));
  const featuresByVariant = new Map();
  let startedPathOrdinal = 0;
  let lastPathResult = null;
  const developmentPaths = allDescriptors.filter(item =>
    item.segmentId === 'development' && item.kind !== 'FIXED_CONTROL');
  const diagnosticPaths = allDescriptors.filter(item => item.segmentId === 'diagnostic');
  const executionDescriptors = [...developmentPaths, ...diagnosticPaths];

  function executeDescriptor(descriptor, target = descriptor.target) {
    const run = tracker.run(descriptor.pathId, ++startedPathOrdinal, checkpoint => {
      if (descriptor.kind === 'CANDIDATE' && !featuresByVariant.has(descriptor.variantId)) {
        const variant = VARIANTS.find(item => item.id === descriptor.variantId);
        featuresByVariant.set(
          descriptor.variantId,
          deriveFeatures(seriesByAsset, variant, checkpoint)
        );
      }
      return simulatePath({
        seriesByAsset,
        descriptor: {...descriptor, target},
        scenario: descriptor.scenario,
        targetSource: {features: featuresByVariant.get(descriptor.variantId)},
        checkpoint
      });
    });
    if (run.status === 'COMPLETED') {
      pathRecords.set(descriptor.pathId, {
        ...run.result,
        kind: descriptor.kind,
        targetExposure: target
      });
    } else {
      pathRecords.set(descriptor.pathId,
        pathFailureRecord(descriptor, run.status, run.attempts, run.failure ?? null));
    }
    lastPathResult = pathRecords.get(descriptor.pathId);
    return run.status;
  }

  let aborted = false;
  let controlDefinitions = {status: 'NOT_CALIBRATED'};
  let batchFailure = null;
  for (const descriptor of developmentPaths) {
    const requestedPathId = yield {
      type: 'BEFORE_PATH',
      descriptor,
      completedPath: lastPathResult,
      manifest: allDescriptors,
      computationOrder: executionDescriptors
    };
    if (requestedPathId !== undefined && requestedPathId !== descriptor.pathId) {
      aborted = true;
      batchFailure = Object.assign(new Error('Unexpected execution-session advance'), {
        code: requestedPathId?.type === 'INTERRUPT' ? 'SESSION_INTERRUPTED' : 'OUT_OF_ORDER_PATH'
      });
      break;
    }
    const status = executeDescriptor(descriptor);
    if (status !== 'COMPLETED') {
      aborted = true;
      break;
    }
  }

  if (!aborted) {
    try {
      tracker.checkpoint('control-calibration-start');
      const primaryDevelopment = allDescriptors.find(item =>
        item.kind === 'CANDIDATE' && item.variantId === 'primary-n30-f25' &&
        item.scenarioId === 'base-15bp' && item.segmentId === 'development');
      const basketDevelopment = allDescriptors.find(item =>
        item.kind === 'FULL_BASKET' && item.scenarioId === 'base-15bp' &&
        item.segmentId === 'development');
      const primary = pathRecords.get(primaryDevelopment.pathId);
      const basket = pathRecords.get(basketDevelopment.pathId);
      controlDefinitions = deriveControlExposures(
        primary.dailyReturns, basket.dailyReturns, primary.dailyHeldTarget, tracker.checkpoint
      );
      tracker.checkpoint('control-calibration-complete');
    } catch (error) {
      aborted = true;
      batchFailure = error;
    }
    if (!aborted) {
      if (!controlDefinitions.ok) {
        for (const descriptor of allDescriptors.filter(item => item.segmentId === 'diagnostic')) {
          pathRecords.set(descriptor.pathId,
            pathFailureRecord(descriptor, 'NOT_RUN_INSUFFICIENT_EVIDENCE', 0));
        }
      } else {
        for (const descriptor of diagnosticPaths) {
          const requestedPathId = yield {
            type: 'BEFORE_PATH',
            descriptor,
            completedPath: lastPathResult,
            controlDefinitions: publicControlDefinitions(controlDefinitions)
          };
          if (requestedPathId !== undefined && requestedPathId !== descriptor.pathId) {
            aborted = true;
            batchFailure = Object.assign(new Error('Unexpected execution-session advance'), {
              code: requestedPathId?.type === 'INTERRUPT' ? 'SESSION_INTERRUPTED' : 'OUT_OF_ORDER_PATH'
            });
            break;
          }
          let target = descriptor.target;
          if (descriptor.kind === 'FIXED_CONTROL') {
            target = descriptor.variantId === 'frozen-mean-exposure'
              ? controlDefinitions.meanExposure : controlDefinitions.riskExposure;
          }
          const status = executeDescriptor(descriptor, target);
          if (status !== 'COMPLETED') {
            aborted = true;
            break;
          }
        }

      }
    }
  }

  if (aborted) {
    for (const descriptor of allDescriptors) {
      const record = pathRecords.get(descriptor.pathId);
      if (record.status === 'COMPLETED') {
        pathRecords.set(descriptor.pathId, {
          ...record,
          status: 'INCOMPLETE_BATCH_ABORT',
          computed: true
        });
        continue;
      }
      if (record.status === 'NOT_RUN') {
        pathRecords.set(descriptor.pathId,
          pathFailureRecord(descriptor, 'NOT_RUN_BATCH_ABORT', 0));
      }
    }
  }

  const executionId = sha256(canonicalJson({
    protocolId: PROTOCOL_ID,
    protocolSha256: PROTOCOL_SHA256,
    implementationId: IMPLEMENTATION_ID,
    implementationSha256,
    inputSha256: identity.inputSha256,
    pathIds: allDescriptors.map(item => item.pathId)
  }));
  const output = {
    schema: 'MERIDIAN_B1_7_ENGINE_RESULT_R3',
    protocolId: PROTOCOL_ID,
    protocolSha256: PROTOCOL_SHA256,
    implementationId: IMPLEMENTATION_ID,
    implementationSha256,
    identity,
    executionId,
    status: 'INVALID',
    failure: null,
    attemptedPaths: startedPathOrdinal,
    completedPaths: 0,
    computedPaths: 0,
    plannedPaths: BUDGET.paths,
    paths: [],
    controlDefinitions: publicControlDefinitions(controlDefinitions),
    controlRealization: [],
    screen: {status: 'NOT_EVALUATED'},
    evidence: {
      syntheticFixture: source.kind === 'SYNTHETIC_FIXTURE',
      priceSource: source.kind === 'SYNTHETIC_FIXTURE'
        ? 'SYNTHETIC_FIXTURE'
        : 'PINNED_KRAKEN_SPOT_USD_CANDLES',
      costModel: 'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
      executionEvidence: 'NOT_OKX_EXECUTION_EVIDENCE',
      sourceAuthenticity: source.kind === 'SYNTHETIC_FIXTURE'
        ? 'SYNTHETIC_ONLY'
        : 'HASH_PROVENANCE_COPIED_NOT_AUTHENTICATED',
      survivorship: 'UNIVERSE_HISTORY_LIMITATION_HBAR_OMITTED_FOR_COVERAGE_ONLY',
      historyLabel: 'DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC',
      candidateInterpretation: 'HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES',
      diagnosticRescaling: 'NONE',
      holdoutClaim: false,
      trialLedger: 'UNKNOWN',
      stoppedPolicy: 'NO_FINITE_TRADE_STOP',
      crv: {status: 'UNDEFINED_NO_FINITE_STOP', value: null, researchOnly: true}
    },
    budget: {
      limits: BUDGET,
      attemptsPerStartedPath: 1,
      automaticRetry: false,
      status: 'FAILED_NO_RETRY'
    },
    authority: authority(),
    protocolReview: {
      r1RequestId: 'MERIDIAN-B1-7-DESIGN-R1',
      r1ResponseComment: '6249442046',
      r1Verdict: 'REVISION_REQUIRED',
      r2RequestId: 'MERIDIAN-B1-7-DESIGN-R2',
      r2ResponseComment: '6249482850',
      r2Verdict: 'GREEN_LIGHT_DESIGN_ONLY',
      r2Scope: 'HISTORICAL_R2_ONLY_NOT_APPROVAL_FOR_R3',
      r3Review: 'PENDING'
    }
  };
  try {
    tracker.checkpoint('result-paths-start');
    for (const descriptor of allDescriptors) {
      tracker.checkpoint('result-path-record');
      output.paths.push(pathRecords.get(descriptor.pathId));
    }
    output.computedPaths = output.paths.filter(path => path.computed).length;
    const completed = output.paths.filter(path => path.status === 'COMPLETED').length;
    output.status = aborted ? 'INVALID' :
      controlDefinitions.status === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' :
        completed === BUDGET.paths ? 'COMPLETED' : 'INCOMPLETE';
    output.completedPaths = completed;
    output.budget.status = aborted ? 'FAILED_NO_RETRY' : 'WITHIN_LIMITS';
    if (aborted) {
      const failedPath = output.paths.find(path =>
        path.status === 'INVALID' || path.status.startsWith('INVALID_'));
      output.failure = failedPath?.failure ?? (batchFailure
        ? {code: batchFailure.code ?? 'BATCH_ABORTED', detail: batchFailure.detail ?? null}
        : {code: 'BATCH_ABORTED'});
    }

    if (output.status === 'COMPLETED') {
      const calculatedScreen = screenResults(output.paths, controlDefinitions, tracker.checkpoint);
      output.screen = source.kind === 'SYNTHETIC_FIXTURE'
        ? {
          ...calculatedScreen,
          status: 'SYNTHETIC_ONLY_NOT_ASSESSED',
          interpretation: 'SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY'
        }
        : calculatedScreen;
    } else if (output.status === 'INSUFFICIENT_EVIDENCE') {
      output.screen = {status: 'INSUFFICIENT_EVIDENCE'};
    }

    for (const path of output.paths) {
      tracker.checkpoint('control-realization');
      if (path.kind !== 'FIXED_CONTROL') continue;
      output.controlRealization.push({
        pathId: path.pathId,
        variantId: path.variantId,
        scenarioId: path.scenarioId,
        segmentId: path.segmentId,
        status: path.status,
        frozenTargetExposure: path.targetExposure ?? null,
        meanRealizedExposure: path.meanRealizedExposure ?? null,
        meanTargetRealizedMismatch: path.meanTargetRealizedMismatch ?? null,
        meanAbsoluteTargetMismatch: path.meanAbsoluteTargetMismatch ?? null,
        maxAbsoluteTargetMismatch: path.maxAbsoluteTargetMismatch ?? null,
        diagnosticRescaling: 'NONE'
      });
    }
    tracker.checkpoint('result-object-complete');
    return compactIfOverBudget(output, tracker.checkpoint);
  } catch (error) {
    const incompletePaths = allDescriptors.map(descriptor => {
      const path = pathRecords.get(descriptor.pathId);
      if (path.status === 'COMPLETED') return {...path, status: 'INCOMPLETE_BATCH_ABORT', computed: true};
      if (path.status === 'NOT_RUN') {
        return pathFailureRecord(descriptor, 'NOT_RUN_BATCH_ABORT', 0);
      }
      return path;
    });
    const failedOutput = {
      ...output,
      status: 'INVALID',
      failure: {
        code: batchFailure?.code ?? error.code ?? 'FINALIZATION_FAILED',
        detail: batchFailure?.detail ?? error.detail ?? null
      },
      completedPaths: 0,
      computedPaths: incompletePaths.filter(path => path.computed).length,
      paths: incompletePaths,
      screen: {status: 'NOT_EVALUATED'},
      budget: {...output.budget, status: 'FAILED_NO_RETRY'}
    };
    return compactIfOverBudget(failedOutput);
  }
}

function failClosedAfterInterruption(result, code) {
  if (!result || typeof result !== 'object') return result;
  const paths = (result.paths ?? []).map(path => path.status === 'COMPLETED'
    ? {...path, status: 'INCOMPLETE_BATCH_ABORT', computed: true}
    : path);
  return {
    ...result,
    status: 'INVALID',
    failure: {code, detail: null},
    completedPaths: 0,
    computedPaths: paths.filter(path => path.computed).length,
    paths,
    screen: {status: 'NOT_EVALUATED'},
    budget: {...result.budget, status: 'FAILED_NO_RETRY'}
  };
}

function publicControlDefinitions(controls) {
  return controls.ok ? {
    status: controls.status,
    meanExposure: controls.meanExposure,
    riskExposure: controls.riskExposure,
    primaryDevelopmentSd: controls.primarySd,
    fullBasketDevelopmentSd: controls.benchmarkSd,
    calibration: controls.calibration
  } : controls;
}

function publicClone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

export function createExecution(options) {
  const iterator = executeBatch(options);
  let step = iterator.next();
  let result = step.done ? step.value : null;
  let status = step.done
    ? step.value?.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED'
    : 'READY';
  const prepared = step.done ? {manifest: [], computationOrder: []} : step.value;
  const manifest = Object.freeze(prepared.manifest.map(item => Object.freeze({
    kind: item.kind,
    variantId: item.variantId,
    scenarioId: item.scenarioId,
    segmentId: item.segmentId,
    pathId: item.pathId
  })));
  const computationOrder = Object.freeze(prepared.computationOrder.map((item, index) =>
    Object.freeze({
      ordinal: index + 1,
      kind: item.kind,
      variantId: item.variantId,
      scenarioId: item.scenarioId,
      segmentId: item.segmentId,
      pathId: item.pathId
    })));
  let lastCompletedPath = null;

  function advance(requestedPathId) {
    if (status !== 'READY') {
      result = failClosedAfterInterruption(result, 'SESSION_NOT_ADVANCEABLE');
      status = 'FAILED';
      return {status};
    }
    const current = step.value;
    if (current?.type !== 'BEFORE_PATH') {
      status = 'FAILED';
      result = failClosedAfterInterruption(result, 'SESSION_STATE_INVALID');
      return {status};
    }
    const interrupted = requestedPathId?.type === 'INTERRUPT';
    const expected = interrupted
      ? requestedPathId
      : requestedPathId === undefined ? current.descriptor.pathId : requestedPathId;
    step = iterator.next(expected);
    const finishedPath = step.done
      ? step.value?.paths?.find(path => path.pathId === current.descriptor.pathId)
      : step.value?.completedPath;
    if (!interrupted && expected === current.descriptor.pathId &&
      (finishedPath?.status === 'COMPLETED' || finishedPath?.computed === true)) {
      lastCompletedPath = current.descriptor.pathId;
    }
    if (step.done) {
      result = step.value;
      status = result?.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
      const completedPath = result?.paths?.find(path => path.pathId === lastCompletedPath) ?? null;
      return {status, pathId: lastCompletedPath, completedPath: publicClone(completedPath)};
    }
    if (step.value?.type !== 'BEFORE_PATH' || expected !== current.descriptor.pathId) {
      result = step.value;
      status = 'FAILED';
      return {status, pathId: lastCompletedPath};
    }
    return {
      status: 'PATH_COMPLETED',
      pathId: lastCompletedPath,
      completedPath: publicClone(step.value.completedPath),
      nextPathId: step.value.descriptor.pathId
    };
  }

  return {
    manifest,
    computationOrder,
    get status() { return status; },
    get completedResult() {
      return status === 'COMPLETED' && result?.status === 'COMPLETED' ? publicClone(result) : null;
    },
    get lastCompletedPath() { return lastCompletedPath; },
    get controlDefinitions() {
      return publicClone(step.done ? result?.controlDefinitions ?? null
        : step.value?.controlDefinitions ?? null);
    },
    beforePathBoundary() {
      if (status !== 'READY') return {status};
      const current = step.value;
      if (current?.type !== 'BEFORE_PATH') {
        status = 'FAILED';
        result = failClosedAfterInterruption(result, 'SESSION_STATE_INVALID');
        return {status};
      }
      return Object.freeze({
        status: 'READY',
        phase: current.descriptor.segmentId === 'development' ? 'DEVELOPMENT' : 'DIAGNOSTIC',
        ordinal: computationOrder.find(item => item.pathId === current.descriptor.pathId).ordinal,
        pathId: current.descriptor.pathId
      });
    },
    advanceOne(expectedPathId) {
      return advance(expectedPathId);
    },
    interrupt() {
      if (status !== 'READY') {
        result = failClosedAfterInterruption(result, 'SESSION_INTERRUPTED');
        status = 'FAILED';
        return {status};
      }
      return advance({type: 'INTERRUPT'});
    },
    finalResult() {
      return status === 'READY' ? null : publicClone(result);
    }
  };
}

export function runBatch(options) {
  const execution = createExecution(options);
  while (execution.status === 'READY') execution.advanceOne();
  return execution.finalResult();
}
