// Pure view projection. No transport, credentials, storage or execution authority.
const SCHEMA = 'MERIDIAN-ASSET-WATCH-BRIDGE-V1';
const SOURCES = ['PIONEX_BOT_API', 'PIONEX_WALLET_BOT_DETAIL'];
const MAX_AGE = 15 * 60 * 1000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const enumValue = (value, allowed) => allowed.includes(value) ? value : null;

export function buildBotReadModel(snapshot, {now = Date.now()} = {}) {
  const result = {status: 'UNKNOWN', source: null, snapshotAt: null, ageMs: null,
    readOnly: true, executionAllowed: false, bots: []};
  if (!object(snapshot) || !Number.isFinite(now)) return result;
  if (snapshot.schemaVersion !== SCHEMA || !SOURCES.includes(snapshot.source) ||
      snapshot.readOnly !== true || snapshot.executionImpact !== false) return result;
  const stamp = snapshot.sourceSnapshotAt;
  const time = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp)
    ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(time) || time > now) return result;
  const limit = snapshot.freshnessLimitMs;
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_AGE) return result;
  const age = now - time;
  if (age > limit) return {...result, status: 'STALE', source: snapshot.source,
    snapshotAt: stamp, ageMs: age};
  if (snapshot.detailsComplete !== true || snapshot.sourceStatusOk !== true ||
      snapshot.fresh !== true || snapshot.usableForOverwrite !== true) return result;
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
      sideSource: enumValue(bot.sideSource, ['economic_inverse_asset', 'trend_inverse_asset', 'trend'])});
  }
  return {...result, status: 'FRESH_SNAPSHOT', source: snapshot.source,
    snapshotAt: stamp, ageMs: age, bots};
}
