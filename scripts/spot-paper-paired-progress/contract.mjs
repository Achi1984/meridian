export const PROGRESS_SCHEMA = 'SPOT_PAPER_PAIRED_PROGRESS_V1';
export const PROGRESS_PATH = '/api/private/spot-paper-paired-progress';
export const PROGRESS_ENDPOINT =
  `https://p01--achi-meridian--ttvk44grdlp7.code.run${PROGRESS_PATH}`;
export const MAX_PROGRESS_BYTES = 64 * 1024;
export const ROLES = Object.freeze(['baseline', 'challenger', 'cash']);
export const MAX_RECENT_FILLS = 12;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const MODEL_PAIR = 'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
const MODELS = [
  'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
  'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1',
  'CASH_CONTROL_V1'
];
export const exactKeys = (value, keys) => value !== null &&
  typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
const time = value => Number.isSafeInteger(value) && value >= 0;
const nonnegative = time;
const metric = value => value === null || Number.isSafeInteger(value);

export function validIdentity(value) {
  return exactKeys(value, ['schemaVersion', 'runId', 'pair', 'sourceSha256',
    'configSha256', 'researchSourceSha256', 'feedSourceId',
    'comparisonEngineId', 'modelPairId', 'models']) &&
    value.schemaVersion === 'SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1' &&
    matches(RUN, value.runId) && value.pair === 'BTC/EUR' &&
    value.runId !== 'btc-eur-paired-host8h-20261108-001' &&
    matches(HASH, value.sourceSha256) && matches(HASH, value.configSha256) &&
    matches(HASH, value.researchSourceSha256) && matches(ID, value.feedSourceId) &&
    matches(ID, value.comparisonEngineId) && value.modelPairId === MODEL_PAIR &&
    Array.isArray(value.models) && value.models.length === 3 &&
    value.models.every((model, index) =>
      exactKeys(model, ['role', 'modelId', 'accountId']) &&
      model.role === ROLES[index] && model.modelId === MODELS[index] &&
      matches(RUN, model.accountId)) &&
    new Set(value.models.map(model => model.accountId)).size === 3;
}

export function validateProgress(value, expectedIdentity) {
  try {
    if (!validIdentity(expectedIdentity) ||
        !exactKeys(value, ['schemaVersion', 'identity', 'journalSequence',
          'journalSha256', 'classification', 'observedAt', 'valuationAt',
          'exportedAt', 'latestEventAt', 'terminal', 'currency', 'monetaryUnit',
          'assumptions', 'arms']) ||
        value.schemaVersion !== PROGRESS_SCHEMA ||
        !validIdentity(value.identity) ||
        canonicalJson(value.identity) !== canonicalJson(expectedIdentity) ||
        !Number.isSafeInteger(value.journalSequence) || value.journalSequence < 2 ||
        !matches(HASH, value.journalSha256) ||
        value.classification !== 'OBSERVED_CHECKPOINT' ||
        !time(value.observedAt) || value.valuationAt !== value.observedAt ||
        !time(value.exportedAt) || value.exportedAt < value.observedAt ||
        !time(value.latestEventAt) || value.latestEventAt < value.observedAt ||
        value.latestEventAt > value.exportedAt ||
        value.currency !== 'EUR' || value.monetaryUnit !== 'CENTS' ||
        !exactKeys(value.terminal, ['status', 'at']) ||
        !['UNKNOWN', 'TERMINAL_RECORDED', 'INTERRUPTED_RECORDED']
          .includes(value.terminal.status) ||
        (value.terminal.status === 'UNKNOWN' ? value.terminal.at !== null :
          !time(value.terminal.at) || value.terminal.at < value.observedAt ||
          value.terminal.at !== value.latestEventAt) ||
        !exactKeys(value.assumptions, ['feeBpsPerSide', 'slippageBpsPerSide',
          'ratesVerified', 'feeBasis', 'netEquityIncludesCosts']) ||
        value.assumptions.feeBpsPerSide !== 20 ||
        value.assumptions.slippageBpsPerSide !== 10 ||
        value.assumptions.ratesVerified !== false ||
        value.assumptions.feeBasis !== 'EEA_SPOT_ONLY_TAKER_ASSUMPTION' ||
        value.assumptions.netEquityIncludesCosts !== true ||
        !Array.isArray(value.arms) || value.arms.length !== 3) return null;
    for (const [index, arm] of value.arms.entries()) {
      const signed = ['startingCapitalCents', 'netEquityCents', 'netPnlCents',
        'cashCents'];
      const unsigned = ['bookedFeesCents', 'modeledSlippageCents',
        'hypotheticalExitFeeCents', 'hypotheticalExitSlippageCents',
        'turnoverCents', 'exposureCents', 'sampledDrawdownCents',
        'unresolvedObservations'];
      if (!exactKeys(arm, ['role', 'modelId', ...signed, ...unsigned,
        'inventoryStatus', 'stopReason', 'tradingStoppedAt', 'fillCount',
        'completedRoundTripCount', 'recentFills']) ||
          arm.role !== ROLES[index] || arm.modelId !== MODELS[index] ||
          signed.some(key => !metric(arm[key])) ||
          unsigned.some(key => !metric(arm[key]) ||
            arm[key] !== null && arm[key] < 0) ||
          arm.startingCapitalCents !== 100_000 ||
          arm.netPnlCents !== (arm.netEquityCents === null ? null :
            arm.netEquityCents - arm.startingCapitalCents) ||
          !['FLAT', 'OPEN', 'UNKNOWN'].includes(arm.inventoryStatus) ||
          ![null, 'SAMPLED_2PCT_BID_STOP', 'SESSION_LOSS_LIMIT'].includes(arm.stopReason) ||
          (arm.stopReason === null ? arm.tradingStoppedAt !== null :
            !time(arm.tradingStoppedAt) || arm.tradingStoppedAt > value.observedAt) ||
          !nonnegative(arm.fillCount) || arm.fillCount > 960 ||
          !nonnegative(arm.completedRoundTripCount) ||
          arm.completedRoundTripCount !== Math.floor(arm.fillCount / 2) ||
          !Array.isArray(arm.recentFills) ||
          arm.recentFills.length !== Math.min(MAX_RECENT_FILLS, arm.fillCount)) return null;
      let previous = 0;
      for (const [fillIndex, fill] of arm.recentFills.entries()) {
        if (!exactKeys(fill, ['side', 'grossCents', 'feeCents', 'executionAt']) ||
            fill.side !== ((arm.fillCount - arm.recentFills.length + fillIndex) %
              2 === 0 ? 'BUY' : 'SELL') ||
            !nonnegative(fill.grossCents) || fill.grossCents === 0 ||
            !nonnegative(fill.feeCents) ||
            fill.feeCents !== Number((BigInt(fill.grossCents) * 20n + 5000n) / 10000n) ||
            !time(fill.executionAt) || fill.executionAt < previous ||
            fill.executionAt > value.observedAt) return null;
        previous = fill.executionAt;
      }
      if (arm.bookedFeesCents === null || arm.turnoverCents === null ||
          arm.recentFills.reduce((sum, fill) => sum + fill.feeCents, 0) >
            arm.bookedFeesCents ||
          arm.recentFills.reduce((sum, fill) => sum + fill.grossCents, 0) >
            arm.turnoverCents ||
          arm.fillCount <= MAX_RECENT_FILLS &&
            (arm.recentFills.reduce((sum, fill) => sum + fill.feeCents, 0) !==
              arm.bookedFeesCents ||
             arm.recentFills.reduce((sum, fill) => sum + fill.grossCents, 0) !==
              arm.turnoverCents) ||
          (arm.inventoryStatus !== 'UNKNOWN' &&
            arm.inventoryStatus !== (arm.fillCount % 2 ? 'OPEN' : 'FLAT'))) return null;
      if (arm.role === 'cash' && (arm.fillCount !== 0 ||
          arm.bookedFeesCents !== 0 || arm.modeledSlippageCents !== 0 ||
          arm.netEquityCents !== 100_000 || arm.exposureCents !== 0 ||
          arm.inventoryStatus !== 'FLAT')) return null;
    }
    const result = JSON.parse(canonicalJson(value));
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength >
        MAX_PROGRESS_BYTES) return null;
    return result;
  } catch {
    return null;
  }
}
