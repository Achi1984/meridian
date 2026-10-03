# Cross-Sectional Low-Volatility V1 — First Discovery Authorization

Status: **FIRST DISCOVERY RUN AUTHORIZED / HOLDOUT SEALED / STRATEGY PNL BLOCKED**  
Ruleset: `CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN`  
Base merge: `852e6d43e3c55bb93c0ca9cce9392e76f4806fb1`  
Execution impact: **false**

## Frozen implementation lineage

The first historical discovery evaluation is authorized only for the already frozen implementation:

- preregistration blob: `7c72162b7cf2f3dd5b22ef2aecc30936de52f4c8`
- feature engine blob: `d161b6b4553d5a18fc7064570f4a4e956178d0c9`
- discovery collector blob: `c6d76e0feb0b779b96c6abe6d8a611bfe808fd3a`
- discovery runner blob: `c2c787ad3bfb10b001af90c7af68b279be84515a`
- invariant test blob: `e168fa68825c19d6ceee22370b1129132c3529eb`
- workflow blob: `43c72ee5dbfaf5e8002fc87f2cb95ca3e672a92f`

The frozen-research guard must pass before source collection.

## Authorized discovery source

Binance Vision official public USD-M monthly 1h perpetual kline archives only.

Frozen universe:
`BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX`

Archive months requested:
- 2025-01 through 2026-01.

Rows retained:
- first: **2025-01-03T23:00:00Z**
- last: **2026-01-03T00:00:00Z**
- expected per asset: **8,738 hourly rows**

No row after the discovery endpoint may be retained. Untouched holdout observations remain sealed.

No:
- funding data;
- private account data;
- synthetic backfill;
- interpolation;
- alternate exchange data;
- asset substitution.

## Authorized discovery calculation

Exactly 48 Saturday anchors:

- first anchor: **2025-02-01T00:00:00Z**
- last anchor: **2025-12-27T00:00:00Z**
- final next-week outcome open: **2026-01-03T00:00:00Z**

For every anchor and all 12 assets:

- trailing 28 days / 672 hourly log returns;
- `LOWVOL = -sqrt(sum(r_h^2))`;
- next-week return from anchor open to the open seven days later;
- cross-sectional Spearman Rank IC;
- equal-weight Low-2 minus High-2 forward-return spread;
- Newey-West(4) t-statistics;
- four chronological 12-week discovery blocks;
- the exact preregistered fail-closed discovery gate.

## Possible discovery decisions

Exactly one of:

- `DISCOVERY_PASS_HOLDOUT_ALLOWED`
- `DISCOVERY_FAIL_RESEARCH_STOP`

A PASS authorizes only a separately controlled untouched holdout stage. It does not authorize strategy construction, Paper bots, or live execution.

A FAIL closes V1 without retuning.

## Explicit prohibitions

This run may not:

- evaluate the 2026 holdout;
- inspect data after 2026-01-03T00:00:00Z;
- change the universe, feature, lookback, basket size, Newey-West lag, thresholds, dates, or block rule;
- calculate compounded strategy PnL, Profit Factor, Sharpe, Sortino, or drawdown;
- rescue a failed result by slicing subperiods or removing assets;
- authorize Paper or live trading.
