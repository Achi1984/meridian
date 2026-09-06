# MERIDIAN FIB Level Bot V2 — 4h Replication Design

Status: RESEARCH ONLY — NO PROMOTION — NO EXECUTION IMPACT.

This design is committed before V2 data are fetched or results inspected.

## Purpose

V1 rejected 15m and the predeclared 1h primary test. V1 discovered a positive 4h result on BTC/ETH/SOL during the 365 days ending 2026-09-06T14:15:00Z. V2 does not retune V1. It tests whether the unchanged 4h logic replicates on a temporally disjoint unseen year and whether breadth survives a locked seven-asset universe.

## Frozen strategy

V2 imports `fib-level-bot-v1.js` unchanged.

- confirmed 3-left / 3-right pivots;
- minimum impulse 1.50 × ATR(14), used only for micro-swing rejection;
- equal 25% fills at 0.382 / 0.500 / 0.618 / 0.786;
- stop at 1.000;
- TP1 at 0.236 for 50%, TP2 at 0.000 for the remainder;
- V1 conservative gap, same-candle and stop-first accounting;
- fixed 0.10% round-trip friction;
- no indicator, regime, asset, side or level entry gate;
- one active basket per symbol.

No V1 parameter may change in V2.

## Locked data and periods

- Timeframe: 4h only.
- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Public source: Coinbase Exchange 1h candles resampled deterministically to UTC-aligned 4h OHLC.
- Fixed V1 discovery cutoff: `2026-09-06T14:15:00Z`.
- Primary unseen replication period: basket closes from `2024-09-06T14:15:00Z` inclusive to `2025-09-06T14:15:00Z` exclusive.
- Secondary breadth stress period: basket closes from `2025-09-06T14:15:00Z` inclusive through the fixed V1 cutoff. This reuses V1 time and is not independent confirmation.
- Warm-up data precede the replication period by 45 days and are excluded from results.
- Primary period is split into three chronological folds by basket close time.
- Core assets: BTC/ETH/SOL. Expansion assets: XRP/ADA/AVAX/LINK.

## Required reporting

For both periods:

- PF, expectancy R, net R, max drawdown R, win rate, closed/open basket count;
- setup count, fill rate and duration/opportunity cost;
- LONG/SHORT;
- regime as descriptive telemetry only;
- every asset;
- core vs expansion universe;
- chronological folds for the primary unseen year;
- positive-PnL concentration by asset;
- sample adequacy: aggregate n >=300; cohort adequate at n >=30, descriptive below 30.

FIB deepest-touch telemetry remains realized-path information and cannot become a decision gate.

## Predeclared replication gate

V2 may be considered historically replicated only if the unseen primary year satisfies all of:

1. aggregate n >=300;
2. PF >=1.10 and expectancy >0;
3. all three chronological folds have PF >1 and expectancy >0;
4. LONG and SHORT each have PF >1 and expectancy >0;
5. at least five of seven assets have PF >1 and expectancy >0 with adequate samples;
6. neither the core nor expansion group has negative expectancy;
7. no single asset contributes more than 40% of positive net R;
8. the secondary expanded-universe stress period remains PF >1 and expectancy >0.

Failure of any gate means no historical replication. Passing every gate still does not permit promotion.

## Prospective holdout lock

All candles after `2026-09-06T14:15:00Z` are excluded from V2 development evidence and reserved for a later prospective holdout. No Paper/live connection or automatic promotion is permitted until a separately reviewed prospective sample is adequate.

No thresholds, assets, sides, regimes, FIB levels or periods may be changed after evidence is inspected.
