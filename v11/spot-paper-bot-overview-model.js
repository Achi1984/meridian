import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODELS
} from '../scripts/spot-paper-paired-report/contract.mjs?v=B16-M11-FIX15';

export const SPOT_PAPER_BOT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'btc-eur-trend',
    label: 'BTC/EUR Trend-Kandidat',
    market: 'BTC/EUR',
    currency: 'EUR'
  }),
  Object.freeze({
    id: 'btc-usd-lives',
    label: 'BTC/USD Lives-Challenge',
    market: 'BTC/USD',
    currency: 'USD'
  }),
  Object.freeze({
    id: 'lowvol-v2',
    label: 'LowVol V2',
    market: null,
    currency: null,
    instrument: 'Perpetual-Portfolio (USDT-marginiert)',
    nativeUnit: 'USDT',
    strategyIdentity: 'LowVol V2'
  })
]);

const STATES = new Set(['PREPARED', 'RUNNING', 'PAUSED', 'COMPLETED', 'UNKNOWN']);
const FRESHNESS = new Set(['FRESH', 'STALE', 'UNKNOWN']);
const CURRENCY = /^(EUR|USD)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MONEY_FIELDS = Object.freeze([
  ['capital', false, true],
  ['netPnl', true, false],
  ['equity', true, false],
  ['realizedPnl', true, false],
  ['unrealizedPnl', true, false],
  ['fees', false, false],
  ['slippage', false, false],
  ['funding', true, false]
]);
const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);

function safeText(value, maxLength = 180) {
  return typeof value === 'string' && value.length > 0 &&
      value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value) ?
    value : null;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value) ||
      !Number.isFinite(Date.parse(value))) return null;
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return new Date(value).toISOString() === canonical ? value : null;
}

function unknown(reason) {
  return {available: false, value: null, currency: null, reason};
}

function amountMetric(value, currency, expectedCurrency, {
  signed = false,
  positive = false
} = {}) {
  if (!isRecord(value) || !Number.isFinite(value.amount)) {
    return unknown('METRIC_NOT_REPORTED');
  }
  if (typeof value.currency !== 'string' || !CURRENCY.test(value.currency) ||
      value.currency !== expectedCurrency || currency !== expectedCurrency) {
    return unknown('CURRENCY_MISMATCH');
  }
  if ((!signed && value.amount < 0) || (positive && value.amount <= 0)) {
    return unknown('INVALID_METRIC_VALUE');
  }
  return {
    available: true,
    value: value.amount,
    currency,
    reason: null
  };
}

function countMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 ?
    {available: true, value, reason: null} : unknown('COUNT_NOT_REPORTED');
}

function validateTrade(trade, currency, baseAsset) {
  if (!isRecord(trade)) return null;
  const at = validTimestamp(trade.at);
  const side = trade.side;
  if (!at || !['BUY', 'SELL', 'OTHER'].includes(side)) return null;
  const amount = amountMetric(trade.amount, currency, currency, {positive: true});
  const price = amountMetric(trade.price, currency, currency, {positive: true});
  if (!amount.available || !price.available ||
      !Number.isFinite(trade.quantity) || trade.quantity <= 0) return null;
  return {
    at,
    side,
    quantity: trade.quantity,
    quantityUnit: baseAsset,
    amount,
    price,
    reason: safeText(trade.reason)
  };
}

function validatedRisk(risk, botId, {
  metricsFresh = false,
  state = 'UNKNOWN',
  equity = unknown('METRIC_NOT_REPORTED')
} = {}) {
  const unavailable = reason => ({
    available: false,
    drawdown: unknown(reason),
    allowance: unknown(reason)
  });
  if (botId !== 'btc-usd-lives') return unavailable('NOT_APPLICABLE_TO_THIS_BOT');
  if (!metricsFresh || !equity.available) {
    return unavailable('LIVES_RISK_NOT_VALIDATED');
  }
  if (!isRecord(risk) || risk.status !== 'VALIDATED' ||
      !isRecord(risk.lossAllowanceLimit) ||
      risk.lossAllowanceLimit.amount !== 100 ||
      risk.lossAllowanceLimit.currency !== 'USD' ||
      typeof risk.paused !== 'boolean' ||
      (risk.paused ?
        typeof risk.pauseObservationId !== 'string' || risk.pauseObservationId.length === 0 :
        risk.pauseObservationId !== null)) {
    return unavailable('LIVES_RISK_NOT_VALIDATED');
  }
  const highWaterEquity = amountMetric(risk.highWaterEquity, 'USD', 'USD');
  const drawdown = amountMetric(risk.netEquityHighWaterDrawdown, 'USD', 'USD');
  const allowance = amountMetric(risk.remainingLossAllowance, 'USD', 'USD');
  if (!highWaterEquity.available || !drawdown.available || !allowance.available ||
      highWaterEquity.value < equity.value ||
      Math.abs(highWaterEquity.value - equity.value - drawdown.value) > 0.005 ||
      Math.abs(Math.max(0, 100 - drawdown.value) - allowance.value) > 0.005 ||
      (drawdown.value >= 100 && !risk.paused) ||
      (risk.paused && state !== 'PAUSED')) {
    return unavailable('LIVES_RISK_NOT_VALIDATED');
  }
  return {available: true, drawdown, allowance};
}

function preparedBot(definition) {
  return {
    ...definition,
    state: 'PREPARED',
    stateReason: 'LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE',
    strategy: 'LowVol V2',
    version: unknown('VERSION_NOT_REPORTED'),
    market: unknown('LOWVOL_INSTRUMENT_ADAPTER_NOT_AVAILABLE'),
    currency: unknown('LOWVOL_NATIVE_UNIT_ADAPTER_NOT_AVAILABLE'),
    metrics: Object.fromEntries(MONEY_FIELDS.map(([key]) =>
      [key, unknown('LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE')])),
    netPnlPercent: unknown('LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE'),
    roundTrips: countMetric(null),
    timeInvestedMs: unknown('LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE'),
    lastTradeAt: unknown('LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE'),
    freshness: {
      status: 'UNKNOWN', at: null, ageMs: null,
      reason: 'LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE'
    },
    reason: 'LowVol V2 bleibt in Vorbereitung; die native USDT-Integration fehlt.',
    risk: validatedRisk(null, definition.id),
    trades: [],
    tradesReason: 'LOWVOL_RUNTIME_ADAPTER_NOT_AVAILABLE'
  };
}

function unknownBot(definition, reason) {
  const metrics = Object.fromEntries(MONEY_FIELDS.map(([key]) => [key, unknown(reason)]));
  return {
    ...definition,
    state: 'UNKNOWN',
    stateReason: reason,
    strategy: definition.label,
    version: unknown('VERSION_NOT_REPORTED'),
    market: definition.market ?
      {available: true, value: definition.market, reason: null} :
      unknown('MARKET_NOT_REPORTED'),
    currency: definition.currency ?
      {available: true, value: definition.currency, reason: null} :
      unknown('CURRENCY_NOT_REPORTED'),
    metrics,
    netPnlPercent: unknown(reason),
    roundTrips: countMetric(null),
    timeInvestedMs: unknown(reason),
    lastTradeAt: unknown(reason),
    freshness: {status: 'UNKNOWN', at: null, ageMs: null, reason},
    reason,
    risk: validatedRisk(null, definition.id),
    trades: [],
    tradesReason: reason
  };
}

function projectBot(definition, adapter) {
  if (definition.id === 'lowvol-v2') return preparedBot(definition);
  if (!adapter || typeof adapter.project !== 'function') {
    return unknownBot(definition, 'REPORT_ADAPTER_NOT_PROVIDED');
  }
  let report;
  try {
    report = adapter.project(adapter.report);
  } catch {
    return unknownBot(definition, 'REPORT_ADAPTER_REJECTED');
  }
  if (!isRecord(report)) return unknownBot(definition, 'SANITIZED_REPORT_INVALID');

  const market = safeText(report.market, 32);
  const currency = typeof report.currency === 'string' && CURRENCY.test(report.currency) ?
    report.currency : null;
  const strategy = safeText(report.strategy);
  const marketParts = /^([A-Z0-9]{2,12})\/(EUR|USD)$/.exec(market || '');
  const marketMatches = marketParts !== null &&
    (definition.market === null || market === definition.market);
  const currencyMatches = currency !== null && marketParts?.[2] === currency &&
    (definition.currency === null || currency === definition.currency);
  const strategyMatches = !definition.strategyIdentity ||
    strategy === definition.strategyIdentity;
  const identityValid = marketMatches && currencyMatches && strategyMatches &&
    market !== null && currency !== null;
  const state = STATES.has(report.state) ? report.state : 'UNKNOWN';
  const runtimeEvidence = report.runtimeEvidence === 'VALIDATED';
  const stateValidated = state === 'PREPARED' || state === 'UNKNOWN' || runtimeEvidence;
  const resultState = identityValid && stateValidated ? state : 'UNKNOWN';
  const stateReason = !identityValid ? 'BOT_IDENTITY_OR_CURRENCY_MISMATCH' :
    !stateValidated ? 'RUNTIME_EVIDENCE_NOT_VALIDATED' :
      state === 'UNKNOWN' ? safeText(report.stateReason) || 'STATE_UNKNOWN' : null;
  const freshnessStatus = isRecord(report.freshness) &&
      FRESHNESS.has(report.freshness.status) ? report.freshness.status : 'UNKNOWN';
  const freshnessAt = isRecord(report.freshness) ?
    validTimestamp(report.freshness.at) : null;
  const freshnessAge = isRecord(report.freshness) &&
      Number.isFinite(report.freshness.ageMs) && report.freshness.ageMs >= 0 ?
    report.freshness.ageMs : null;
  const freshness = {
    status: freshnessStatus,
    at: freshnessAt,
    ageMs: freshnessAge,
    reason: safeText(report.freshness?.reason) ||
      (freshnessStatus === 'FRESH' && (!freshnessAt || freshnessAge === null) ?
        'FRESHNESS_METADATA_INCOMPLETE' : 'FRESHNESS_NOT_REPORTED')
  };
  const metricsFresh = freshnessStatus === 'FRESH' && freshnessAt !== null &&
    freshnessAge !== null && identityValid && stateValidated &&
    state !== 'PREPARED' && state !== 'UNKNOWN';
  const metrics = {};
  for (const [key, signed, positive] of MONEY_FIELDS) {
    metrics[key] = metricsFresh ?
      amountMetric(report[key], currency, currency, {signed, positive}) :
      unknown(freshnessStatus === 'STALE' ? 'DATA_STALE' :
        freshnessStatus === 'FRESH' ? stateReason || 'FRESHNESS_METADATA_INCOMPLETE' :
          'DATA_FRESHNESS_UNKNOWN');
  }
  const percentValid = metricsFresh && isRecord(report.netPnlPercent) &&
    Number.isFinite(report.netPnlPercent.value) &&
    report.netPnlPercent.basis === 'INITIAL_CAPITAL';
  const netPnlPercent = percentValid ?
    {available: true, value: report.netPnlPercent.value, reason: null} :
    unknown(metricsFresh ? 'PERCENT_BASIS_NOT_VALIDATED' :
      freshnessStatus === 'STALE' ? 'DATA_STALE' : 'DATA_FRESHNESS_UNKNOWN');
  const timeInvestedMs = metricsFresh && Number.isSafeInteger(report.timeInvestedMs) &&
      report.timeInvestedMs >= 0 ?
    {available: true, value: report.timeInvestedMs, reason: null} :
    unknown(freshnessStatus === 'STALE' ? 'DATA_STALE' : 'TIME_INVESTED_NOT_REPORTED');
  const lastTrade = validTimestamp(report.lastTradeAt);
  const lastTradeAt = metricsFresh && lastTrade ?
    {available: true, value: lastTrade, reason: null} :
    unknown(report.noTradeReason ? 'NO_TRADE_REPORTED' :
      freshnessStatus === 'STALE' ? 'DATA_STALE' : 'LAST_TRADE_NOT_REPORTED');
  const rawTrades = report.trades;
  const tradesValid = metricsFresh && Array.isArray(rawTrades) &&
    rawTrades.length <= 100 &&
    rawTrades.every(trade => validateTrade(trade, currency, marketParts[1]));
  const trades = tradesValid ?
    rawTrades.map(trade => validateTrade(trade, currency, marketParts[1])) : [];
  const noTradeReason = safeText(report.noTradeReason);
  const pauseReason = safeText(report.pauseReason);
  const reason = resultState === 'PAUSED' ? pauseReason :
    (resultState === 'PREPARED' || report.roundTrips === 0 || !report.lastTradeAt ?
      noTradeReason || 'NO_TRADE_REASON_NOT_REPORTED' : null);
  const risk = validatedRisk(report.risk, definition.id, {
    metricsFresh,
    state: resultState,
    equity: metrics.equity
  });
  return {
    ...definition,
    state: resultState,
    stateReason,
    strategy: strategy || definition.label,
    version: safeText(report.version) ?
      {available: true, value: report.version, reason: null} :
      unknown('VERSION_NOT_REPORTED'),
    market: identityValid ?
      {available: true, value: market, reason: null} : unknown('BOT_IDENTITY_OR_CURRENCY_MISMATCH'),
    currency: identityValid ?
      {available: true, value: currency, reason: null} : unknown('BOT_IDENTITY_OR_CURRENCY_MISMATCH'),
    metrics,
    netPnlPercent,
    roundTrips: metricsFresh ? countMetric(report.roundTrips) :
      unknown(freshnessStatus === 'STALE' ? 'DATA_STALE' : 'DATA_FRESHNESS_UNKNOWN'),
    timeInvestedMs,
    lastTradeAt,
    freshness,
    reason: reason || (resultState === 'PAUSED' ?
      'PAUSE_REASON_NOT_REPORTED' :
      resultState === 'PREPARED' ? 'Noch keine Laufzeit-Evidenz.' :
        stateReason),
    risk,
    trades,
    tradesReason: tradesValid ? null :
      freshnessStatus === 'STALE' ? 'DATA_STALE' : 'TRADE_DETAILS_NOT_VALIDATED',
    syntheticFixture: report.syntheticFixture === true,
    curve: metricsFresh && isRecord(report.curve) ? report.curve : null
  };
}

function pairedSnapshotBot(input) {
  let report;
  try {
    report = projectSpotPaperPairedDashboard(input);
  } catch {
    report = null;
  }
  const definition = SPOT_PAPER_BOT_DEFINITIONS[0];
  if (!isRecord(report)) return unknownBot(definition, 'PAIRED_REPORT_NOT_VALIDATED');
  const challenger = report.arms.challenger;
  const trendModel = SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[1];
  if (report.identity.pair !== 'BTC/EUR' ||
      report.identity.modelPairId !== SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR ||
      report.identity.models[1]?.modelId !== trendModel ||
      challenger.modelId !== trendModel) {
    return unknownBot(definition, 'PAIRED_REPORT_IDENTITY_NOT_SUPPORTED');
  }
  if (report.evidenceStatus === 'CORRUPT_UNKNOWN') {
    return unknownBot(definition, 'PAIRED_REPORT_EVIDENCE_UNKNOWN');
  }

  const snapshotMetric = (cents, reason) => {
    if (cents === null) return unknown(reason || 'METRIC_MISSING');
    return {available: true, value: cents / 100, currency: 'EUR', reason: null};
  };
  const unknownHistorical = unknown('REPORT_SNAPSHOT_HISTORICAL');
  return {
    ...definition,
    state: 'UNKNOWN',
    stateReason: 'REPORT_SNAPSHOT_HISTORICAL',
    strategy: trendModel,
    version: unknown('VERSION_NOT_REPORTED'),
    market: {available: true, value: 'BTC/EUR', reason: null},
    currency: {available: true, value: 'EUR', reason: null},
    metrics: {
      capital: unknown('METRIC_NOT_REPORTED'),
      netPnl: snapshotMetric(challenger.netPnlCents,
        challenger.metricReasons.netPnlCents),
      equity: snapshotMetric(challenger.netEquityCents,
        challenger.metricReasons.netEquityCents),
      realizedPnl: unknownHistorical,
      unrealizedPnl: unknownHistorical,
      fees: snapshotMetric(challenger.bookedFeesCents,
        challenger.metricReasons.bookedFeesCents),
      slippage: snapshotMetric(challenger.modeledSlippageCents,
        challenger.metricReasons.modeledSlippageCents),
      funding: unknownHistorical
    },
    netPnlPercent: unknownHistorical,
    roundTrips: unknown('ROUND_TRIPS_NOT_REPORTED'),
    timeInvestedMs: unknownHistorical,
    lastTradeAt: unknownHistorical,
    freshness: {
      status: 'UNKNOWN',
      at: null,
      ageMs: null,
      reason: 'REPORT_SNAPSHOT_HISTORICAL'
    },
    reason: 'REPORT_SNAPSHOT_HISTORICAL',
    risk: validatedRisk(null, definition.id),
    trades: [],
    tradesReason: 'TRADE_DETAILS_NOT_REPORTED',
    syntheticFixture: report.syntheticFixture,
    reportSnapshot: {
      runId: report.identity.runId,
      valuationAt: report.timing.valuationAt,
      evidenceStatus: report.evidenceStatus,
      feeBpsPerSide: report.assumptions.feeBpsPerSide,
      slippageBpsPerSide: report.assumptions.slippageBpsPerSide,
      ratesVerified: report.assumptions.ratesVerified
    }
  };
}

function validCurve(curve) {
  if (!isRecord(curve) || curve.basis !== 'INITIAL_CAPITAL_INDEX_100' ||
      !validTimestamp(curve.coverageStart) || !validTimestamp(curve.coverageEnd) ||
      !Array.isArray(curve.points) || curve.points.length < 2 ||
      curve.points.length > 100) return false;
  const start = Date.parse(curve.coverageStart);
  const end = Date.parse(curve.coverageEnd);
  if (start >= end || curve.points[0]?.at !== curve.coverageStart ||
      curve.points.at(-1)?.at !== curve.coverageEnd ||
      curve.points[0]?.index !== 100) return false;
  return curve.points.every((point, index) => {
    if (!isRecord(point)) return false;
    const at = validTimestamp(point.at);
    const timestamp = Date.parse(point.at);
    return at !== null && timestamp >= start && timestamp <= end &&
      Number.isFinite(point.index) && point.index >= 0 &&
      (index === 0 || timestamp > Date.parse(curve.points[index - 1].at));
  });
}

function alignedCurve(bots) {
  const unavailable = reason => ({available: false, reason, points: []});
  const eligible = bots.filter(bot =>
    ['RUNNING', 'PAUSED', 'COMPLETED'].includes(bot.state) && validCurve(bot.curve));
  if (eligible.length < 2) return unavailable('CURVE_NEEDS_TWO_ELIGIBLE_BOTS');
  const curves = eligible.map(bot => bot.curve);
  const first = curves[0];
  const sameCoverage = curves.every(curve =>
    curve.coverageStart === first.coverageStart &&
    curve.coverageEnd === first.coverageEnd &&
    curve.points.length === first.points.length &&
    curve.points.every((point, index) =>
      point.at === first.points[index]?.at &&
      Number.isFinite(point.index) && point.index >= 0));
  if (!sameCoverage) {
    return unavailable('CURVE_HORIZONS_NOT_ALIGNED');
  }
  return {
    available: true,
    basis: first.basis,
    coverageStart: first.coverageStart,
    coverageEnd: first.coverageEnd,
    botIds: eligible.map(bot => bot.id),
    excludedBotIds: bots.filter(bot => !eligible.includes(bot)).map(bot => bot.id),
    points: first.points.map((point, index) => ({
      at: point.at,
      values: Object.fromEntries(eligible.map((bot, botIndex) =>
        [bot.id, curves[botIndex].points[index].index]))
    }))
  };
}

export function presentSpotPaperBotOverview(adapters = [], {pairedReport = null} = {}) {
  if (!Array.isArray(adapters) || adapters.length > SPOT_PAPER_BOT_DEFINITIONS.length) {
    return {
      bots: SPOT_PAPER_BOT_DEFINITIONS.map(definition =>
        definition.id === 'lowvol-v2' ? preparedBot(definition) :
          unknownBot(definition, 'ADAPTER_LIST_INVALID')),
      curve: {available: false, reason: 'ADAPTER_LIST_INVALID', points: []}
    };
  }
  const byId = new Map();
  for (const adapter of adapters) {
    if (!isRecord(adapter) || !SPOT_PAPER_BOT_DEFINITIONS.some(item =>
      item.id === adapter.id) || byId.has(adapter.id)) {
      return {
        bots: SPOT_PAPER_BOT_DEFINITIONS.map(definition =>
          definition.id === 'lowvol-v2' ? preparedBot(definition) :
            unknownBot(definition, 'ADAPTER_ID_INVALID_OR_DUPLICATED')),
        curve: {available: false, reason: 'ADAPTER_ID_INVALID_OR_DUPLICATED', points: []}
      };
    }
    byId.set(adapter.id, adapter);
  }
  const bots = SPOT_PAPER_BOT_DEFINITIONS.map(definition =>
    projectBot(definition, byId.get(definition.id)));
  if (pairedReport !== null && pairedReport !== undefined) {
    bots[0] = pairedSnapshotBot(pairedReport);
  }
  return {bots, curve: alignedCurve(bots)};
}
