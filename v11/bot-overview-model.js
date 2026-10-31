const DIRECTIONS = new Set(['LONG', 'SHORT', 'NEUTRAL']);
const CATEGORIES = new Set(['inverse', 'linear']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const confirmed = value => typeof value === 'number' && Number.isFinite(value) && value !== 0;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

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
      category: category(bot.category), leverage, pnl});
  }

  const distribution = {long: 0, short: 0, neutral: 0, unknown: 0};
  for (const bot of bots) distribution[bot.direction]++;
  const query = typeof filters.query === 'string' ? filters.query.trim().toUpperCase() : '';
  const selectedDirection = ['long', 'short', 'neutral', 'unknown'].includes(filters.direction)
    ? filters.direction : 'all';
  const selectedCategory = ['coin-m', 'linear', 'unknown'].includes(filters.category)
    ? filters.category : 'all';
  const rows = bots.filter(bot =>
    (!query || bot.symbol.includes(query)) &&
    (selectedDirection === 'all' || bot.direction === selectedDirection) &&
    (selectedCategory === 'all' || bot.category === selectedCategory));
  const sort = ['leverage', 'pnl'].includes(filters.sort) ? filters.sort : 'symbol';
  rows.sort((a, b) => sort === 'leverage'
    ? compareKnown(a, b, 'leverage', true)
    : sort === 'pnl' ? compareKnown(a, b, 'pnl') : compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref));

  const losses = bots.filter(bot => bot.pnl !== null && bot.pnl < 0)
    .sort((a, b) => a.pnl - b.pnl || compareText(a.symbol, b.symbol) || compareText(a.ref, b.ref))
    .slice(0, 3);
  return {status: 'fresh', snapshotAt: snapshot.snapshotAt, source: snapshot.source ?? null,
    count: bots.length, distribution, bots: rows, losses};
}
