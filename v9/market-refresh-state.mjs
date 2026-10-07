/**
 * R131 market-refresh controller. In-memory data publication only.
 * No scoring, execution, storage, scheduling or authorization policy lives here.
 * The existing v9 analytics and transports are injected, not reimplemented.
 */
export const MARKET_MAX_AGE_MS = 3 * 60 * 1000;
export const MARKET_FUTURE_TOLERANCE_MS = 30 * 1000;
const ACTIONS = new Set(['HOLD', 'WATCH PROFIT', 'PROFIT LOCK CANDIDATE', 'RISK REVIEW']);
const FAILURE_CODES = new Set(['INVALID_CLOCK', 'MISSING_SOURCE_TIMESTAMP', 'FUTURE_SOURCE_TIMESTAMP',
  'STALE_SOURCE_TIMESTAMP', 'INSUFFICIENT_BARS', 'INVALID_BARS', 'INVALID_ANALYSIS',
  'INVALID_ACTIONS', 'OLDER_THAN_ACCEPTED', 'INVALID_TRANSPORT']);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const positive = n => finite(n) && n > 0;
const assert = (condition, code) => { if (!condition) throw new Error(code); };

/** One caller-supplied clock reading; attempts cannot renew source timestamps. */
export function marketEvidence(snapshot, now) {
  assert(positive(now), 'INVALID_CLOCK');
  if (snapshot == null) return { status: 'MISSING', ageMs: null, updatedAt: null, fresh: false };
  const t = snapshot.updatedAt;
  if (!positive(t) || t > now + MARKET_FUTURE_TOLERANCE_MS) {
    return { status: 'INVALID', ageMs: null, updatedAt: finite(t) ? t : null, fresh: false };
  }
  const ageMs = Math.max(0, now - t), fresh = ageMs <= MARKET_MAX_AGE_MS;
  return { status: fresh ? 'FRESH' : 'STALE', ageMs, updatedAt: t, fresh };
}

function sourceTime(sets, now) {
  assert(sets.every(rows => positive(rows?.fetchedAt)), 'MISSING_SOURCE_TIMESTAMP');
  assert(sets.every(rows => rows.fetchedAt <= now + MARKET_FUTURE_TOLERANCE_MS), 'FUTURE_SOURCE_TIMESTAMP');
  const timestamp = Math.min(...sets.map(rows => rows.fetchedAt));
  assert(now - timestamp <= MARKET_MAX_AGE_MS, 'STALE_SOURCE_TIMESTAMP');
  return timestamp;
}
function validRows(rows, minimum) {
  assert(Array.isArray(rows) && rows.length >= minimum, 'INSUFFICIENT_BARS');
  assert(rows.every(row => row && positive(row.high) && positive(row.low) && positive(row.close) &&
    row.high >= row.low && row.high >= row.close && row.low <= row.close), 'INVALID_BARS');
}
function acceptedAnalysis(value, timestamp, previous, extras, directional) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && positive(value.price), 'INVALID_ANALYSIS');
  if (directional) assert(ACTIONS.has(value.longAction) && ACTIONS.has(value.shortAction), 'INVALID_ACTIONS');
  assert(!positive(previous?.updatedAt) || timestamp >= previous.updatedAt, 'OLDER_THAN_ACCEPTED');
  // Detach nested arrays/objects from analysis-builder references before publishing.
  return { ...structuredClone(value), ...extras, updatedAt: timestamp };
}

/**
 * Returns the replacement for v9.syncIntel. A controller instance is single-flight.
 * Dependencies must be the existing production functions (or explicit test fakes).
 * A BTC tuple is published together; independent asset successes publish separately.
 */
export function createMarketRefreshController(deps) {
  const { state, trackedMarketSymbols, marketKlines, closedMarketRows, intel, profitLockIntel,
    marketTransportLabel, syncCrossPrices, notifyData, renderHeaderTruth,
    now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = deps;
  assert(state && typeof state === 'object' && !Array.isArray(state), 'INVALID_STATE');
  for (const fn of [trackedMarketSymbols, marketKlines, closedMarketRows, intel, profitLockIntel,
    marketTransportLabel, syncCrossPrices, notifyData, renderHeaderTruth, now, pause]) {
    assert(typeof fn === 'function', 'INVALID_DEPENDENCY');
  }
  let busy = false;
  const notify = () => {
    try { notifyData(); } catch { state.marketRefreshObserverError = 'NOTIFY_FAILED'; }
  };
  const publish = patch => {
    // No await/callback between evidence and timestamp writes.
    Object.assign(state, patch);
    state.lastGoodMarketSnapshot = {
      intel: state.intel ?? null, assetIntel: state.assetIntel,
      marketSyncedAt: state.marketSyncedAt ?? null, marketTransport: state.marketTransport ?? null
    };
    notify();
  };

  return async function refreshMarket() {
    if (busy) return false;
    busy = true;
    const errors = [], accepted = [];
    let cross = Promise.resolve();
    try {
      const startedAt = now();
      assert(positive(startedAt), 'INVALID_CLOCK');
      Object.assign(state, { marketSyncStatus: 'RUNNING', marketSyncStartedAt: startedAt,
        marketRefreshObserverError: null });
      notify();
      const rawSymbols = trackedMarketSymbols();
      assert(Array.isArray(rawSymbols) && rawSymbols.every(s => typeof s === 'string' && /^[A-Z0-9]{1,20}$/.test(s)), 'INVALID_UNIVERSE');
      const universe = [...new Set(['BTC', ...rawSymbols])];
      // Cross-prices own their state/expiry. Failure must not revoke valid analyses.
      cross = Promise.resolve().then(syncCrossPrices).catch(() => {
        state.marketPriceError = 'CROSS_PRICE_REFRESH_FAILED';
      });
      async function refreshAsset(symbol) {
        try {
          const btc = symbol === 'BTC';
          const intervals = btc ? [['15m',180],['1h',200],['4h',240],['1d',240]] : [['15m',160],['1h',180],['4h',160]];
          const sets = await Promise.all(intervals.map(([interval, limit]) => marketKlines(interval, limit, symbol)));
          const stampNow = now();
          assert(positive(stampNow), 'INVALID_CLOCK');
          // Validate every source timestamp, including daily confirmation for BTC.
          const timestamp = sourceTime(sets, stampNow);
          const [m15,h1,h4,d1] = sets;
          sets.forEach(rows => validRows(rows, 1));
          const h1c = closedMarketRows(h1), h4c = closedMarketRows(h4);
          validRows(m15,35); validRows(h1c,60); validRows(h4c,100);
          const transport = marketTransportLabel(...sets);
          assert(typeof transport === 'string' && transport.length > 0, 'INVALID_TRANSPORT');
          const assetTimestamp = sourceTime(sets.slice(0,3), stampNow);
          const asset = acceptedAnalysis(profitLockIntel(m15,h1c,h4c), assetTimestamp,
            state.assetIntel?.[symbol], { confirmationBars:'CLOSED_1H_4H', transport }, true);
          const patch = { assetIntel: { ...(state.assetIntel || {}), [symbol]: asset } };
          if (btc) {
            const d1c = closedMarketRows(d1); validRows(d1c,210);
            const global = acceptedAnalysis(intel(m15,h1c,h4c,d1c), timestamp,
              state.intel, { confirmationBars:'CLOSED_1H_4H_1D', transport }, false);
            // A failed global candidate cannot partially replace the BTC tuple.
            Object.assign(patch, { intel: global, marketSyncedAt: timestamp, marketTransport: transport });
          }
          publish(patch);
          accepted.push(symbol);
        } catch (error) {
          // Fixed codes only: no API body, URL, credentials or private data in diagnostics.
          const code = String(error?.message || '');
          errors.push(symbol + ' ' + (FAILURE_CODES.has(code) ? code : 'FETCH_OR_ANALYSIS_FAILED'));
        }
      }
      await refreshAsset('BTC');
      const assets = universe.filter(symbol => symbol !== 'BTC');
      for (let i = 0; i < assets.length; i += 4) {
        await Promise.all(assets.slice(i,i+4).map(refreshAsset));
        if (i+4 < assets.length) await pause(220);
      }
      await cross;
      state.marketSyncStatus = accepted.length ? (errors.length ? 'PARTIAL' : 'OK') : 'ERROR';
      return true;
    } catch {
      errors.push('REFRESH_FAILED');
      state.marketSyncStatus = 'ERROR';
      await cross;
      return false;
    } finally {
      state.marketError = errors.length ? errors.slice(0,6).join(' · ') : null;
      state.marketRefreshAccepted = [...accepted];
      busy = false;
      let completedAt = null;
      try { const t = now(); if (positive(t)) completedAt = t; } catch {}
      state.marketSyncCompletedAt = completedAt;
      if (completedAt === null) { state.marketSyncStatus = 'ERROR'; state.marketError = 'INVALID_CLOCK'; }
      try { renderHeaderTruth(); } catch { state.marketRefreshObserverError = 'HEADER_FAILED'; }
      notify();
    }
  };
}
