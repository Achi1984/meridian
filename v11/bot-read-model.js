// Pure view projection. No transport, credentials, storage or execution authority.
const SCHEMA = 'MERIDIAN-ASSET-WATCH-BRIDGE-V1';
const SOURCES = ['PIONEX_BOT_API', 'PIONEX_WALLET_BOT_DETAIL'];
const MAX_AGE = 15 * 60 * 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const enumValue = (value, allowed) => allowed.includes(value) ? value : null;
const rowCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const REJECTION_REASONS = ['UNSUPPORTED_SCOPE', 'SUPPORTED_HYDRATION_MISSING',
  'SANITIZATION_LOSS_OR_DUPLICATE', 'PAGINATION_INCOMPLETE', 'EXPLICIT_PARTIAL',
  'SYNC_PARTIAL', 'DETAILS_INCOMPLETE', 'SOURCE_STATUS_NOT_OK', 'SOURCE_STALE', 'SOURCE_UNAVAILABLE'];
function scope(snapshot) {
  const reasons = snapshot.overwriteRejectionReasons;
  return {
    overwriteScope: enumValue(snapshot.overwriteScope, ['WALLET_FUTURES_GRID', 'PRIMARY_BOT_API', 'NONE']),
    excludedScope: enumValue(snapshot.excludedScope, ['KNOWN_EXCLUDED_PRODUCTS', 'UNVERIFIED', 'NONE']),
    usableForOverwrite: typeof snapshot.usableForOverwrite === 'boolean' ? snapshot.usableForOverwrite : null,
    overwriteRejectionReasons: Array.isArray(reasons) && reasons.length <= REJECTION_REASONS.length &&
      Array.from(reasons).every(reason => REJECTION_REASONS.includes(reason)) ? [...reasons] : null
  };
}
function coverage(snapshot) {
  const raw=object(snapshot?.coverage)?snapshot.coverage:{};
  const counts={listRows:rowCount(raw.listRows),recognizedRows:rowCount(raw.recognizedRows),
    representedRows:rowCount(raw.representedRows),unsupportedRows:rowCount(raw.unsupportedRows),
    unhydratedRows:rowCount(raw.unhydratedRows)};
  const paginationComplete=raw.paginationComplete===false?false:
    raw.paginationComplete===true?true:null;
  const partial=raw.status==='PARTIAL'||counts.unsupportedRows>0||counts.unhydratedRows>0||
    paginationComplete===false;
  return {...counts,status:partial?'PARTIAL':raw.status==='DOCUMENTED'?'DOCUMENTED':
      raw.status==='UNVERIFIED'?'UNVERIFIED':'UNKNOWN',
    providerContractStatus:raw.providerContractStatus==='DOCUMENTED'?'DOCUMENTED':'UNVERIFIED',
    liveAccountVerification:raw.liveAccountVerification==='NOT_PERFORMED'?'NOT_PERFORMED':'UNKNOWN',
    paginationComplete,pages:rowCount(raw.pages),pageLimit:rowCount(raw.pageLimit)};
}

// Legacy V1 bridge rows can conflate missing values with zero. Other metrics
// remain conservative; P/L accepts zero only with bounded source evidence below.
const metric = (value, positive = false) => typeof value === 'number' && Number.isFinite(value) &&
  value !== 0 && (!positive || value > 0) ? value : null;
function decimalKey(value) {
  const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  let power = Number(exponentText) - fraction.length;
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    power++;
  }
  return digits + 'e' + power;
}
function takeProfitCheck(metrics, evidence) {
  if (evidence !== 'PRICE_SET' || metrics.takeProfit === null) return {
    set: null, matchesUpper: null,
    reason: 'Die Quelle bestätigt keinen direkt vergleichbaren TP-Preis; fehlende Werte belegen kein ungesetztes TP.'
  };
  if (metrics.upper === null) return {
    set: true, matchesUpper: null,
    reason: 'Die obere Range fehlt oder ist nicht eindeutig bestätigt.'
  };
  return {set: true, matchesUpper: decimalKey(metrics.takeProfit) === decimalKey(metrics.upper), reason: null};
}
const PNL_UNAVAILABLE_REASONS=['USD_VALUE_MISSING','WALLET_PROFIT_UNIT_UNCONFIRMED',
  'WALLET_USD_PRICE_MISSING','ZERO_VALUE_UNCONFIRMED'];
const PNL_EVIDENCE=['EXPLICIT_USD_VALUE','INVERSE_WALLET_USD_VALUE'];
function metrics(bot) {
  const pnlEvidence=enumValue(bot.pnl?.evidence,PNL_EVIDENCE);
  const pnlUsd=bot.pnl?.usd===0&&pnlEvidence?0:metric(bot.pnl?.usd);
  return {leverage: metric(bot.leverage, true), investmentUsd: metric(bot.investment?.usd, true),
    investmentAmount: metric(bot.investment?.quoteAmount, true),
    investmentCurrency: typeof bot.investment?.currency === 'string' && /^[A-Z0-9]{2,12}$/.test(bot.investment.currency) ? bot.investment.currency : null,
    pnlUsd, pnlEvidence:pnlUsd!==null?pnlEvidence:null,
    pnlUnavailableReason: pnlUsd!==null?null:
      enumValue(bot.pnl?.unavailableReason,PNL_UNAVAILABLE_REASONS)||'USD_VALUE_MISSING',
    lower: metric(bot.limits?.lower, true),
    upper: metric(bot.limits?.upper, true), liquidationPrice: metric(bot.limits?.liquidationPrice, true),
    liquidationLowerBound: metric(bot.limits?.liquidationLowerBound, true),
    liquidationUpperBound: metric(bot.limits?.liquidationUpperBound, true),
    takeProfit: metric(bot.limits?.takeProfit, true), stopLoss: metric(bot.limits?.stopLoss, true),
    gridProfitUsd: null, riskBufferPct: null};
}

export function buildBotReadModel(snapshot, {now = Date.now()} = {}) {
  const result = {status: 'UNKNOWN', source: null, snapshotAt: null, ageMs: null,
    readOnly: true, executionAllowed: false, coverage:coverage(snapshot),
    overwriteScope: null, excludedScope: null, usableForOverwrite: null,
    overwriteRejectionReasons: null, bots: []};
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
    const cateType=enumValue(bot.cateType,['inverse','linear','FUTURES_MOON',
      'FUTURE_GRID_COIN_MARGINED','FULLY_HEDGING','SPOT']);
    const projectedMetrics=metrics(bot);
    const takeProfitEvidence=bot.limits?.takeProfitEvidence==='PRICE_SET'?'PRICE_SET':'UNKNOWN';
    bots.push({ref: bot.botRef, symbol: bot.symbol,
      side: enumValue(bot.side, ['LONG', 'SHORT', 'NEUTRAL']),
      category: enumValue(cateType, ['inverse', 'linear']),
      productCategory: cateType==='FUTURES_MOON'?'FUTURES_MOON':null,
      type: enumValue(bot.botType, ['futures_grid', 'future_hedge_grid']),
      sideSource: enumValue(bot.sideSource, ['economic_inverse_asset', 'trend_inverse_asset', 'trend']),
      metrics: projectedMetrics, takeProfitEvidence,
      takeProfitCheck: takeProfitCheck(projectedMetrics,takeProfitEvidence)});
  }
  return {...result, status: 'FRESH_SNAPSHOT', source: snapshot.source,
    snapshotAt: stamp, ageMs: age, expiresAt: time + limit, ...scope(snapshot), bots};
}
