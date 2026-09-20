/**
 * MERIDIAN FIB DCA Futures Long research backtester.
 * Pure JS, no exchange dependency. Feed oldest->newest closed OHLCV candles.
 * Research/paper only.
 */
export const DEFAULT_CONFIG = {
  leverage: 3,
  dcaLevels: [0.382, 0.5, 0.618, 0.786],
  dcaWeights: [0.15, 0.2, 0.3, 0.35],
  tpExtensions: [1.0, 1.272, 1.618],
  tpWeights: [0.3, 0.3, 0.4],
  feeRate: 0.0005,
  slippageRate: 0.0003,
  initialEquity: 10000,
  riskCapitalFraction: 0.1,
  conservativeIntrabar: true,
};

export function fibPrices(swingLow, swingHigh, cfg = DEFAULT_CONFIG) {
  if (!(swingHigh > swingLow)) throw new Error("swingHigh must exceed swingLow");
  const range = swingHigh - swingLow;
  return {
    dca: cfg.dcaLevels.map(x => swingHigh - range * x),
    tp: cfg.tpExtensions.map(x => x === 1 ? swingHigh : swingLow + range * x),
    invalidation: swingLow,
  };
}

export function weightedEntry(fills) {
  const q = fills.reduce((s, f) => s + f.qty, 0);
  return q ? fills.reduce((s, f) => s + f.price * f.qty, 0) / q : 0;
}

function adverseBuy(px, slip) { return px * (1 + slip); }
function adverseSell(px, slip) { return px * (1 - slip); }

/**
 * Backtest one already-confirmed fib cycle.
 * Conservative rule: if invalidation and a favorable TP are both touched
 * in one candle, invalidation is processed first.
 */
export function backtestFibCycle(candles, swingLow, swingHigh, userCfg = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...userCfg };
  const lv = fibPrices(swingLow, swingHigh, cfg);
  let equity = cfg.initialEquity;
  const allocation = equity * cfg.riskCapitalFraction * cfg.leverage;
  const fills = [];
  const used = new Set();
  const tpDone = new Set();
  let realized = 0, fees = 0, qtyOpen = 0, stopped = false;
  const events = [];

  for (const c of candles) {
    // Worst-case sequencing when path inside OHLC is unknowable.
    if (qtyOpen > 0 && c.low <= lv.invalidation) {
      const px = adverseSell(lv.invalidation, cfg.slippageRate);
      const avg = weightedEntry(fills);
      const pnl = (px - avg) * qtyOpen;
      const fee = px * qtyOpen * cfg.feeRate;
      realized += pnl - fee; fees += fee;
      events.push({ ts:c.ts, type:"STOP", price:px, qty:qtyOpen, pnl:pnl-fee });
      qtyOpen = 0; stopped = true; break;
    }

    for (let i=0;i<lv.dca.length;i++) {
      if (!used.has(i) && c.low <= lv.dca[i]) {
        const px = adverseBuy(lv.dca[i], cfg.slippageRate);
        const notional = allocation * cfg.dcaWeights[i];
        const qty = notional / px;
        const fee = notional * cfg.feeRate;
        fills.push({ level:i, price:px, qty });
        qtyOpen += qty; fees += fee; realized -= fee; used.add(i);
        events.push({ ts:c.ts, type:"DCA", level:i+1, price:px, qty, fee });
      }
    }

    if (qtyOpen > 0) {
      for (let i=0;i<lv.tp.length;i++) {
        if (!tpDone.has(i) && c.high >= lv.tp[i]) {
          const fraction = cfg.tpWeights[i];
          const qty = i === lv.tp.length-1 ? qtyOpen : Math.min(qtyOpen, fills.reduce((s,f)=>s+f.qty,0)*fraction);
          if (qty <= 0) continue;
          const px = adverseSell(lv.tp[i], cfg.slippageRate);
          const avg = weightedEntry(fills);
          const pnl = (px - avg) * qty;
          const fee = px * qty * cfg.feeRate;
          realized += pnl - fee; fees += fee; qtyOpen -= qty; tpDone.add(i);
          events.push({ ts:c.ts, type:`TP${i+1}`, price:px, qty, pnl:pnl-fee });
        }
      }
    }
  }
  return {
    swingLow, swingHigh, levels:lv, fills, events, stopped,
    weightedEntry:weightedEntry(fills), realizedPnl:realized, fees,
    openQty:qtyOpen, tpHits:[0,1,2].map(i=>tpDone.has(i)),
    dcaUsed:[0,1,2,3].map(i=>used.has(i)),
  };
}
