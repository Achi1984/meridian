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

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some(value => !finite(value))) return NaN;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length || values.some(value => !finite(value))) return NaN;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function acceptsTarget(rawExposure, lastAccepted) {
  return Math.abs(rawExposure - lastAccepted) >= 0.10;
}

export function deriveFeatures(seriesByAsset, variant) {
  const count = INPUT.rowCount;
  const basketReturns = new Array(count).fill(null);
  for (let index = 1; index < count; index++) {
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
    const window = basketReturns.slice(index - variant.window + 1, index + 1);
    const deviation = sampleStandardDeviation(window);
    const sigma = deviation * Math.sqrt(365);
    if (!finite(sigma)) fail('INVALID_SIGNAL', {index, reason: 'NONFINITE_SIGMA'});
    sigmas[index] = sigma;
  }

  const result = new Array(count).fill(null);
  const firstSignalIndex = variant.window + 364;
  for (let index = firstSignalIndex; index < count; index++) {
    const rolling = sigmas.slice(index - 364, index + 1);
    if (rolling.length !== 365 || rolling.some(value => !finite(value))) {
      fail('INVALID_SIGNAL', {index, reason: 'INCOMPLETE_MEDIAN_WINDOW'});
    }
    const currentSigma = sigmas[index];
    const rollingMedian = median(rolling);
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

export function buildSchedule(rows, features, segment, delayDays = 0) {
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
    if (new Date(rows[index].timestamp).getUTCDay() !== 0) continue;
    const feature = features[index];
    if (!feature) fail('INVALID_SIGNAL', {index, reason: 'WEEKLY_TARGET_MISSING'});
    schedule(index, feature.rawExposure);
  }
  return {decisions, fills, cancelled};
}

function fixedSchedule(rows, segment, target, delayDays) {
  const decisions = [];
  const fills = [];
  const cancelled = [];
  const firstIndex = segment.startIndex - 1;
  for (let index = firstIndex; index <= segment.endIndex; index++) {
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

function selfFinancingFill(state, prices, target, feeRate, date) {
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

function quarterlyReturns(dates, equity) {
  const quarters = [];
  let startEquity = CAPITAL;
  let quarter = null;
  let endEquity = CAPITAL;
  for (let index = 0; index < dates.length; index++) {
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

export function calculateDrawdown(equity) {
  let peak = CAPITAL;
  let drawdownDuration = 0;
  let maxDrawdownDuration = 0;
  let sampledDrawdown = 0;
  for (const value of equity) {
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

function simulatePath({seriesByAsset, descriptor, scenario, targetSource}) {
  const segment = SEGMENTS[descriptor.segmentId];
  const rows = seriesByAsset[ASSETS[0]];
  let schedule;
  if (descriptor.kind === 'CASH') {
    schedule = {decisions: [], fills: [], cancelled: []};
  } else if (descriptor.kind === 'CANDIDATE') {
    schedule = buildSchedule(rows, targetSource.features, segment, scenario.delayDays);
  } else {
    schedule = fixedSchedule(rows, segment, descriptor.target, scenario.delayDays);
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
  let maxConcentration = 0;

  for (let index = segment.startIndex; index <= segment.endIndex; index++) {
    const date = rows[index].timestamp;
    dates.push(date);
    const openPrices = ASSETS.map(asset => seriesByAsset[asset][index].open);
    const scheduled = fillsByIndex.get(index);
    if (scheduled) {
      heldTarget = scheduled.target;
      if (descriptor.kind !== 'CASH') {
        const fill = selfFinancingFill(state, openPrices, heldTarget, scenario.costRate, date);
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
    if (markedPositions > 0) {
      for (const quantityIndex of ASSETS.keys()) {
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

  const {sampledDrawdown, maxDrawdownDuration} = calculateDrawdown(dailyEquity);
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
    dailyReturnSd: sampleStandardDeviation(dailyReturns),
    meanHeldTarget: dailyTarget.reduce((sum, value) => sum + value, 0) / dailyTarget.length,
    maxConcentration,
    turnoverNotional: totalTurnover,
    turnoverOnInitialEquity: totalTurnover / CAPITAL,
    totalCosts: state.cumulativeCost,
    fillCostCount: fillCosts.length,
    fillCosts,
    cancelledInstructionCount: schedule.cancelled.length,
    cancelledInstructions: schedule.cancelled,
    quarterlyReturns: quarterlyReturns(dates, dailyEquity),
    dailyReturns,
    dailyHeldTarget: dailyTarget
  };
}

export function deriveControlExposures(primaryDailyReturns, benchmarkDailyReturns, primaryHeldTarget) {
  const meanExposure = primaryHeldTarget.reduce((sum, value) => sum + value, 0) / primaryHeldTarget.length;
  const primarySd = sampleStandardDeviation(primaryDailyReturns);
  const benchmarkSd = sampleStandardDeviation(benchmarkDailyReturns);
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
    calibration: 'DEVELOPMENT_85BP_DAILY_NET_RETURNS_AND_HELD_TARGETS'
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

function inputIdentity(seriesByAsset, source) {
  const seriesHashes = Object.fromEntries(ASSETS.map(asset =>
    [asset, sha256(canonicalJson(seriesByAsset[asset]))]));
  const identity = {
    datasetKind: source.kind,
    sourceCommit: source.kind === 'FROZEN_RESEARCH_INPUT' ? source.commit : 'SYNTHETIC_FIXTURE',
    sourceProvenance: source.kind === 'FROZEN_RESEARCH_INPUT'
      ? {normalizedFileSha256: source.files}
      : {syntheticFixtureSeriesSha256: seriesHashes},
    canonicalSeriesSha256: seriesHashes
  };
  return {...identity, inputSha256: sha256(canonicalJson(identity))};
}

function bindDescriptors(items, identity, implementationSha256) {
  return items.map(item => {
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
    return {...item, pathId: sha256(canonicalJson(pathIdentity)), identity: pathIdentity};
  });
}

export function createBudgetTracker(clock = () => performance.now()) {
  const batchStart = clock();
  let stopped = false;
  return {
    run(pathId, operation) {
      if (stopped) return {status: 'NOT_RUN_BATCH_ABORT', attempts: 0, result: null};
      if (clock() - batchStart > BUDGET.totalMs) {
        stopped = true;
        return {status: 'INVALID_TOTAL_BUDGET', attempts: 0, result: null};
      }
      const pathStart = clock();
      let result;
      try {
        result = operation();
      } catch (error) {
        stopped = true;
        return {
          status: 'INVALID',
          attempts: 1,
          result: null,
          failure: {code: error.code ?? 'PATH_FAILED', detail: error.detail ?? null}
        };
      }
      const pathElapsed = clock() - pathStart;
      const totalElapsed = clock() - batchStart;
      if (pathElapsed > BUDGET.pathMs || totalElapsed > BUDGET.totalMs) {
        stopped = true;
        return {
          status: pathElapsed > BUDGET.pathMs ? 'INVALID_PATH_BUDGET' : 'INVALID_TOTAL_BUDGET',
          attempts: 1,
          result: null,
          failure: {code: 'BUDGET_EXCEEDED', detail: {pathElapsed, totalElapsed}}
        };
      }
      return {status: 'COMPLETED', attempts: 1, result};
    },
    get stopped() {
      return stopped;
    }
  };
}

function screenResults(paths, controlDefinitions) {
  const byKey = new Map(paths.map(path =>
    [`${path.variantId}|${path.scenarioId}|${path.segmentId}`, path]));
  const get = (variant, scenario, segment) => byKey.get(`${variant}|${scenario}|${segment}`);
  const primary = get('primary-n30-f25', 'base-85bp', 'diagnostic');
  const full = get('full-basket-weekly', 'base-85bp', 'diagnostic');
  const meanControl = get('frozen-mean-exposure', 'base-85bp', 'diagnostic');
  const riskControl = get('frozen-risk-exposure', 'base-85bp', 'diagnostic');
  const stressed = get('primary-n30-f25', 'stress-160bp', 'diagnostic');
  const delayed = get('primary-n30-f25', 'stress-160bp-delay-1d', 'diagnostic');
  const neighbours = VARIANTS.slice(1);
  const basePositive = neighbours.filter(variant =>
    get(variant.id, 'base-85bp', 'diagnostic').netReturn > 0).length;
  const stressPositive = neighbours.filter(variant =>
    get(variant.id, 'stress-160bp', 'diagnostic').netReturn > 0).length;
  if (!primary || !full || !meanControl || !riskControl || !stressed || !delayed ||
    controlDefinitions.status !== 'FROZEN_DEVELOPMENT_ONLY') {
    return {status: 'INSUFFICIENT_EVIDENCE', checks: {}, relativeDrawdownReduction: null};
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
    primaryNetPositiveAt160bp: stressed.netReturn > 0,
    primaryNetPositiveAt160bpPlusDelay: delayed.netReturn > 0,
    atLeastThreeOfFourNeighboursPositiveAt85bp: basePositive >= 3,
    atLeastThreeOfFourNeighboursPositiveAt160bp: stressPositive >= 3
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'PASS' : 'NO_EDGE',
    interpretation: 'HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT',
    checks,
    relativeDrawdownReduction,
    neighbourPositiveCounts: {base85bp: basePositive, stress160bp: stressPositive},
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
    schema: 'MERIDIAN_B1_7_ENGINE_RESULT_R2',
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
    trialLedger: 'UNKNOWN',
    protocolReview: {
      r1RequestId: 'MERIDIAN-B1-7-DESIGN-R1',
      r1ResponseComment: '6249442046',
      r1Verdict: 'REVISION_REQUIRED',
      r2RequestId: 'MERIDIAN-B1-7-DESIGN-R2',
      r2ResponseStatus: 'PENDING'
    }
  };
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

function compactIfOverBudget(output) {
  const bytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  if (bytes <= BUDGET.outputBytes) return output;
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
    paths: output.paths.map(path => ({
      pathId: path.pathId,
      kind: path.kind,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId,
      status: path.status === 'COMPLETED' ? 'INCOMPLETE_OUTPUT_BUDGET' : path.status,
      attempts: path.attempts,
      computed: path.status === 'COMPLETED',
      outputOmitted: path.status === 'COMPLETED' ? 'GLOBAL_OUTPUT_BUDGET_EXCEEDED' : null
    })),
    screen: {status: 'NOT_EVALUATED'},
    authority: authority(),
    trialLedger: 'UNKNOWN'
  };
  return compact;
}

export function runBatch(options) {
  const tracker = createBudgetTracker();
  let batch;
  try {
    const keys = ['seriesByAsset', 'source', 'implementationSha256'];
    if (options === null || typeof options !== 'object' || Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) {
      return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
    }
    const ownKeys = Reflect.ownKeys(options);
    if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) {
      return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
    }
    batch = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
      }
      batch[key] = descriptor.value;
    }
  } catch {
    return emptyResult('INVALID', 'BATCH_INPUT_INVALID');
  }
  const {seriesByAsset, source, implementationSha256} = batch;
  if (!HASH.test(PROTOCOL_SHA256)) {
    return emptyResult('INVALID', 'PROTOCOL_HASH_NOT_FROZEN');
  }
  if (typeof implementationSha256 !== 'string' || !HASH.test(implementationSha256)) {
    return emptyResult('INVALID', 'IMPLEMENTATION_HASH_REQUIRED');
  }
  const sourceCheck = validateSourceIdentity(source);
  if (!sourceCheck.ok) return emptyResult('INVALID', sourceCheck.error.code, [sourceCheck.error]);
  const inputCheck = validateSeries(seriesByAsset);
  if (!inputCheck.ok) return emptyResult('INVALID', 'INPUT_INVALID', inputCheck.errors);

  let featuresByVariant;
  try {
    featuresByVariant = Object.fromEntries(VARIANTS.map(variant =>
      [variant.id, deriveFeatures(seriesByAsset, variant)]));
  } catch (error) {
    return emptyResult('INVALID', error.code ?? 'INVALID_SIGNAL', [
      {code: error.code ?? 'INVALID_SIGNAL', detail: error.detail ?? null}
    ]);
  }

  const identity = inputIdentity(seriesByAsset, source);
  const allDescriptors = bindDescriptors(descriptors(), identity, implementationSha256);
  if (allDescriptors.length !== BUDGET.paths) return emptyResult('INVALID', 'PATH_PLAN_MISMATCH');
  const pathRecords = new Map(allDescriptors.map(item =>
    [item.pathId, pathFailureRecord(item, 'NOT_RUN', 0)]));
  const targetSource = Object.fromEntries(VARIANTS.map(variant =>
    [variant.id, {features: featuresByVariant[variant.id]}]));

  function executeDescriptor(descriptor, target = descriptor.target) {
    const run = tracker.run(descriptor.pathId, () => simulatePath({
      seriesByAsset,
      descriptor: {...descriptor, target},
      scenario: descriptor.scenario,
      targetSource: targetSource[descriptor.variantId] ?? {}
    }));
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
    return run.status;
  }

  const developmentPaths = allDescriptors.filter(item =>
    item.segmentId === 'development' && item.kind !== 'FIXED_CONTROL');
  let aborted = false;
  for (const descriptor of developmentPaths) {
    const status = executeDescriptor(descriptor);
    if (status !== 'COMPLETED') {
      aborted = true;
      break;
    }
  }

  let controlDefinitions = {status: 'NOT_CALIBRATED'};
  if (!aborted) {
    const primaryDevelopment = allDescriptors.find(item =>
      item.kind === 'CANDIDATE' && item.variantId === 'primary-n30-f25' &&
      item.scenarioId === 'base-85bp' && item.segmentId === 'development');
    const basketDevelopment = allDescriptors.find(item =>
      item.kind === 'FULL_BASKET' && item.scenarioId === 'base-85bp' &&
      item.segmentId === 'development');
    const primary = pathRecords.get(primaryDevelopment.pathId);
    const basket = pathRecords.get(basketDevelopment.pathId);
    controlDefinitions = deriveControlExposures(
      primary.dailyReturns, basket.dailyReturns, primary.dailyHeldTarget
    );
    if (!controlDefinitions.ok) {
      for (const descriptor of allDescriptors.filter(item => item.segmentId === 'diagnostic')) {
        pathRecords.set(descriptor.pathId,
          pathFailureRecord(descriptor, 'NOT_RUN_INSUFFICIENT_EVIDENCE', 0));
      }
    } else {
      const diagnosticPaths = allDescriptors.filter(item => item.segmentId === 'diagnostic');
      for (const descriptor of diagnosticPaths) {
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

  const paths = allDescriptors.map(item => pathRecords.get(item.pathId));
  const completed = paths.filter(path => path.status === 'COMPLETED').length;
  const status = aborted ? 'INVALID' :
    controlDefinitions.status === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' :
      completed === BUDGET.paths ? 'COMPLETED' : 'INCOMPLETE';
  const calculatedScreen = status === 'COMPLETED'
    ? screenResults(paths, controlDefinitions) : null;
  const executionId = sha256(canonicalJson({
    protocolId: PROTOCOL_ID,
    protocolSha256: PROTOCOL_SHA256,
    implementationId: IMPLEMENTATION_ID,
    implementationSha256,
    inputSha256: identity.inputSha256,
    pathIds: allDescriptors.map(item => item.pathId)
  }));
  const output = {
    schema: 'MERIDIAN_B1_7_ENGINE_RESULT_R2',
    protocolId: PROTOCOL_ID,
    protocolSha256: PROTOCOL_SHA256,
    implementationId: IMPLEMENTATION_ID,
    implementationSha256,
    identity,
    executionId,
    status,
    attemptedPaths: paths.filter(path => path.attempts === 1).length,
    completedPaths: completed,
    computedPaths: paths.filter(path => path.computed).length,
    plannedPaths: BUDGET.paths,
    paths,
    controlDefinitions: controlDefinitions.ok ? {
      status: controlDefinitions.status,
      meanExposure: controlDefinitions.meanExposure,
      riskExposure: controlDefinitions.riskExposure,
      primaryDevelopmentSd: controlDefinitions.primarySd,
      fullBasketDevelopmentSd: controlDefinitions.benchmarkSd,
      calibration: controlDefinitions.calibration
    } : controlDefinitions,
    screen: calculatedScreen
      ? source.kind === 'SYNTHETIC_FIXTURE'
        ? {
          ...calculatedScreen,
          status: 'SYNTHETIC_ONLY_NOT_ASSESSED',
          interpretation: 'SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY'
        }
        : calculatedScreen
      : {status: status === 'INSUFFICIENT_EVIDENCE' ? status : 'NOT_EVALUATED'},
    evidence: {
      syntheticFixture: source.kind === 'SYNTHETIC_FIXTURE',
      sourceAuthenticity: source.kind === 'SYNTHETIC_FIXTURE'
        ? 'SYNTHETIC_ONLY'
        : 'HASH_PROVENANCE_COPIED_NOT_AUTHENTICATED',
      historyLabel: 'DEVELOPMENT_AND_HISTORICAL_DIAGNOSTIC',
      holdoutClaim: false,
      trialLedger: 'UNKNOWN',
      stoppedPolicy: 'NO_FINITE_TRADE_STOP',
      crv: {status: 'UNDEFINED_NO_FINITE_STOP', value: null, researchOnly: true}
    },
    budget: {
      limits: BUDGET,
      attemptsPerStartedPath: 1,
      automaticRetry: false,
      status: aborted ? 'FAILED_NO_RETRY' : 'WITHIN_LIMITS'
    },
    authority: authority(),
    protocolReview: {
      r1RequestId: 'MERIDIAN-B1-7-DESIGN-R1',
      r1ResponseComment: '6249442046',
      r1Verdict: 'REVISION_REQUIRED',
      r2RequestId: 'MERIDIAN-B1-7-DESIGN-R2',
      r2ResponseStatus: 'PENDING'
    }
  };
  return compactIfOverBudget(output);
}
