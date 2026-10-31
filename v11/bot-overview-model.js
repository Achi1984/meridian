const DIRECTIONS = new Set(['LONG', 'SHORT', 'NEUTRAL']);
const CATEGORIES = new Set(['inverse', 'linear']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const confirmed = value => typeof value === 'number' && Number.isFinite(value) && value !== 0;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const TP_ORDER = {mismatch: 0, unknown: 1, match: 2};
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function takeProfitStatus(bot) {
  const check = bot.takeProfitCheck;
  if (bot.takeProfitEvidence !== 'PRICE_SET' || !positive(bot.metrics?.takeProfit) ||
      !positive(bot.metrics?.upper) || check?.set !== true) return 'unknown';
  // Reuse the exact comparison already performed by the read model.
  return check.matchesUpper === true ? 'match' : check.matchesUpper === false ? 'mismatch' : 'unknown';
}

function freshness(snapshot) {
  const stamp = Date.parse(snapshot.snapshotAt);
  const ageMs = Number.isSafeInteger(snapshot.ageMs) && snapshot.ageMs >= 0 &&
    snapshot.ageMs <= 900000 ? snapshot.ageMs : null;
  const expiresAt = Number.isSafeInteger(snapshot.expiresAt) && snapshot.expiresAt > stamp &&
    snapshot.expiresAt <= stamp + 900000 && (ageMs === null || ageMs <= snapshot.expiresAt - stamp)
    ? snapshot.expiresAt : null;
  return {ageMs, expiresAt};
}

function direction(side) {
  if (!DIRECTIONS.has(side)) return 'unknown';
  return side === 'LONG' ? 'long' : side === 'SHORT' ? 'short' : 'neutral';
}

function category(value) {
  return value === 'inverse' ? 'coin-m' : value === 'linear' ? 'linear' : 'unknown';
}

function compareKnown(a, b, key, descending = false) {
  const aKnown = confirmed(a[key]) || key==='pnl'&&a[key]===0, bKnown = confirmed(b[key]) || key==='pnl'&&b[key]===0;
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  if (aKnown && a[key] !== b[key]) return (descending ? b[key] - a[key] : a[key] - b[key]);
  return compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref);
}

function validSnapshot(snapshot) {
  return object(snapshot) && snapshot.status === 'FRESH_SNAPSHOT' &&
    snapshot.readOnly === true && snapshot.executionAllowed === false &&
    Array.isArray(snapshot.bots) && snapshot.bots.length <= 100 &&
    typeof snapshot.snapshotAt === 'string' && Number.isFinite(Date.parse(snapshot.snapshotAt));
}

export function buildBotOverviewModel(snapshot, filters = {}) {
  if (!validSnapshot(snapshot)) return {status: 'unavailable', bots: []};
  const seen = new Set();
  const bots = [];
  for (const bot of snapshot.bots) {
    if (!object(bot) || typeof bot.ref !== 'string' || !/^[a-f0-9]{20}$/.test(bot.ref) ||
        seen.has(bot.ref) || typeof bot.symbol !== 'string' ||
        !/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)) {
      return {status: 'unavailable', bots: []};
    }
    seen.add(bot.ref);
    const pnl = confirmed(bot.metrics?.pnlUsd) || bot.metrics?.pnlUsd===0&&
      ['EXPLICIT_USD_VALUE','INVERSE_WALLET_USD_VALUE'].includes(bot.metrics?.pnlEvidence)
      ? bot.metrics.pnlUsd : null;
    const leverage = confirmed(bot.metrics?.leverage) && bot.metrics.leverage > 0
      ? bot.metrics.leverage : null;
    bots.push({ref: bot.ref, symbol: bot.symbol, direction: direction(bot.side),
      category: category(bot.category), leverage, pnl, tpStatus: takeProfitStatus(bot)});
  }

  const distribution = {long: 0, short: 0, neutral: 0, unknown: 0};
  const counts = {tp: {mismatch: 0, match: 0, unknown: 0}, pnl: {available: 0, unavailable: 0}};
  for (const bot of bots) {
    distribution[bot.direction]++;
    counts.tp[bot.tpStatus]++;
    counts.pnl[bot.pnl === null ? 'unavailable' : 'available']++;
  }
  const query = typeof filters.query === 'string' ? filters.query.trim().toUpperCase() : '';
  const selectedDirection = ['long', 'short', 'neutral', 'unknown'].includes(filters.direction)
    ? filters.direction : 'all';
  const selectedCategory = ['coin-m', 'linear', 'unknown'].includes(filters.category)
    ? filters.category : 'all';
  const selectedTp = ['mismatch', 'match', 'unknown'].includes(filters.tpStatus) ? filters.tpStatus : 'all';
  const selectedPnl = ['available', 'unavailable'].includes(filters.pnlAvailability) ? filters.pnlAvailability : 'all';
  const rows = bots.filter(bot =>
    (!query || bot.symbol.includes(query)) &&
    (selectedDirection === 'all' || bot.direction === selectedDirection) &&
    (selectedCategory === 'all' || bot.category === selectedCategory) &&
    (selectedTp === 'all' || bot.tpStatus === selectedTp) &&
    (selectedPnl === 'all' || (bot.pnl === null ? 'unavailable' : 'available') === selectedPnl));
  const sort = ['leverage', 'pnl', 'tp'].includes(filters.sort) ? filters.sort : 'symbol';
  rows.sort((a, b) => sort === 'leverage'
    ? compareKnown(a, b, 'leverage', true)
    : sort === 'pnl' ? compareKnown(a, b, 'pnl')
    : sort === 'tp' ? TP_ORDER[a.tpStatus] - TP_ORDER[b.tpStatus] || compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref)
    : compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref));

  const losses = bots.filter(bot => bot.pnl !== null && bot.pnl < 0)
    .sort((a, b) => a.pnl - b.pnl || compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref))
    .slice(0, 3);
  return {status: 'fresh', snapshotAt: snapshot.snapshotAt, source: snapshot.source ?? null,
    count: bots.length, visibleCount: rows.length, counts, ...freshness(snapshot), distribution, bots: rows, losses};
}
