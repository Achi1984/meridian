# MERIDIAN — Elliott Wave Bot V2 Historical Replication

Status: PREDECLARED / UNCHANGED V1 / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-07, before the first V2 result

## Question

Does the frozen Elliott Wave V1 Wave-3 setup retain positive edge on an older, temporally disjoint year that was not used in the V1 primary or secondary evaluation?

## Frozen strategy

V2 changes no strategy behavior. It uses the exact V1 engine from head `a1283b68419bdb2a5d22ff2b49fff5b4109354db`:

- 1D structural context; 4h counting and execution;
- immutable 3-left/3-right confirmed pivots;
- 30-day median 4h true range and fixed 2× structural noise floor;
- Wave-2 retracement 0.382–0.786;
- entry only after a fresh break of W1 following W2 confirmation;
- W2 stop; fixed 1.000 and 1.618 Wave-1 projection targets;
- fixed 0.05R completed-trade execution cost;
- BTC, ETH, SOL, XRP, ADA, AVAX and LINK;
- LONG and SHORT symmetry; no asset, side or daily-context filter.

## Locked replication period

- Primary replication: `2022-09-06T16:00:00Z` through `2023-09-06T16:00:00Z`.
- Warm-up data begins 150 days earlier.
- Coinbase Exchange public 1h OHLC resampled to complete 4h bars.
- No V1 result is re-used as replication evidence.

## Decision gates

The replication passes only if all hold:

1. at least 120 closed trades;
2. PF at least 1.10 and positive expectancy;
3. three chronological folds with at least 30 trades each and PF at least 0.90;
4. LONG and SHORT each have at least 25 trades, PF above 1 and positive expectancy;
5. at least five of seven assets with at least 12 trades are positive;
6. no asset supplies more than 40% of positive net R;
7. maximum drawdown does not exceed 15R.

Passing permits prospective holdout review only. Failure closes the historical replication without pivot, noise-floor, retracement, target, cost, date, asset, side or context tuning. No automatic promotion is allowed.

## Isolation

No Baseline 6.2, Hybrid Alpha, FIB V3, Paper/live execution, Pionex, `server.js`, sizing, orders or ledgers are changed.
