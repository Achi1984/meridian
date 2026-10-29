// Pure view projection. No transport, credentials, storage or execution authority.
const SCHEMA = 'MERIDIAN-ASSET-WATCH-BRIDGE-V1';
const SOURCES = ['PIONEX_BOT_API', 'PIONEX_WALLET_BOT_DETAIL'];
const MAX_AGE = 15 * 60 * 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const enumValue = (value, allowed) => allowed.includes(value) ? value : null;
const rowCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function coverage(snapshot) {
  const raw=object(snapshot?.coverage)?snapshot.coverage:{};
  const counts={listRows:rowCount(raw.listRows),recognizedRows:rowCount(raw.recognizedRows),
    representedRows:rowCount(raw.representedRows),unsupportedRows:rowCount(raw.unsupportedRows),
    unhydratedRows:rowCount(raw.unhydratedRows)};
  const partial=raw.status==='PARTIAL'||counts.unsupportedRows>0||counts.unhydratedRows>0;
  return {...counts,status:partial?'PARTIAL':raw.status==='UNVERIFIED'?'UNVERIFIED':'UNKNOWN',
    providerContractStatus:'UNVERIFIED'};
}

// V1 bridge coerces absent numeric inputs to zero. Until provenance is fixed,
// zero cannot be distinguished from missing and must never imply a known value.
const metric = (value, positive = false) => typeof value === 'number' && Number.isFinite(value) &&
  value !== 0 && (!positive || value > 0) ? value : null;
function metrics(bot) {
  return {leverage: metric(bot.leverage, true), investmentUsd: metric(bot.investment?.usd, true),
    investmentAmount: metric(bot.investment?.quoteAmount, true),
    investmentCurrency: typeof bot.investment?.currency === 'string' && /^[A-Z0-9]{2,12}$/.test(bot.investment.currency) ? bot.investment.currency : null,
    pnlUsd: metric(bot.pnl?.usd), lower: metric(bot.limits?.lower, true),
    upper: metric(bot.limits?.upper, true), liquidationPrice: metric(bot.limits?.liquidationPrice, true),
    liquidationLowerBound: metric(bot.limits?.liquidationLowerBound, true),
    liquidationUpperBound: metric(bot.limits?.liquidationUpperBound, true),
    takeProfit: metric(bot.limits?.takeProfit, true), stopLoss: metric(bot.limits?.stopLoss, true),
    gridProfitUsd: null, riskBufferPct: null};
}

export function buildBotReadModel(snapshot, {now = Date.now()} = {}) {
  const result = {status: 'UNKNOWN', source: null, snapshotAt: null, ageMs: null,
    readOnly: true, executionAllowed: false, coverage:coverage(snapshot), bots: []};
  if (!object(snapshot) || !Number.isFinite(now)) return result;
  if (snapshot.schemaVersion !== SCHEMA || !SOURCES.includes(snapshot.source) ||
      snapshot.readOnly !== true || snapshot.executionImpact !== false) return result;
  const stamp = snapshot.sourceSnapshotAt;
  const time = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp)
    ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(time) || time > now) return result;
  const canonicalStamp = stamp.includes('.') ? stamp : stamp.replace('Z', '.000Z');
  if (new Date(time).toISOString() !== canonicalStamp) return result;
  const limit = snapshot.freshnessLimitMs;
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_AGE) return result;
  const age = now - time;
  if (age > limit) return {...result, status: 'STALE', source: snapshot.source,
    snapshotAt: stamp, ageMs: age};
  if (snapshot.detailsComplete !== true || snapshot.sourceStatusOk !== true ||
      snapshot.fresh !== true ||
      !(snapshot.usableForDisplay === true || snapshot.usableForOverwrite === true)) return result;
  if (!Array.isArray(snapshot.bots) || snapshot.bots.length > 100 ||
      snapshot.botCount !== snapshot.bots.length) return result;
  const seen = new Set();
  const bots = [];
  for (const bot of snapshot.bots) {
    if (!object(bot) || typeof bot.botRef !== 'string' || !/^[a-f0-9]{20}$/.test(bot.botRef) ||
        seen.has(bot.botRef) || typeof bot.symbol !== 'string' ||
        !/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)) return result;
    seen.add(bot.botRef);
    bots.push({ref: bot.botRef, symbol: bot.symbol,
      side: enumValue(bot.side, ['LONG', 'SHORT', 'NEUTRAL']),
      category: enumValue(bot.cateType, ['inverse', 'linear']),
      type: enumValue(bot.botType, ['futures_grid', 'future_hedge_grid']),
      sideSource: enumValue(bot.sideSource, ['economic_inverse_asset', 'trend_inverse_asset', 'trend']),
      metrics: metrics(bot)});
  }
  return {...result, status: 'FRESH_SNAPSHOT', source: snapshot.source,
    snapshotAt: stamp, ageMs: age, expiresAt: time + limit, bots};
}
