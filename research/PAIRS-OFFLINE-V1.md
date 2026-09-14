# Pairs statistics pipeline

Research tool only. No production imports, database writes, exchange orders or automatic
activation. R42 pairs is sealed after the frozen replay found no eligible entry.

## Reproduce

Use Python 3.12 in an isolated virtual environment:

```sh
python -m venv /tmp/meridian-pairs-venv
/tmp/meridian-pairs-venv/bin/pip install -r research/pairs-requirements.txt
node scripts/collect-pairs-history.mjs > /tmp/pairs-history.json
/tmp/meridian-pairs-venv/bin/python research/pairs_scan.py /tmp/pairs-history.json --costs-bps 40 > /tmp/pairs-result.json
/tmp/meridian-pairs-venv/bin/python research/pairs_walkforward.py /tmp/pairs-history.json --costs-bps 40 > /tmp/pairs-walkforward.json
/tmp/meridian-pairs-venv/bin/python -m unittest discover -s research -p 'test_pairs*.py' -v
```

The 40 bps all-in round-trip cost is an explicit scenario assumption, **not** a
measured execution cost. Include spread, slippage, commissions and a holding-period
funding reserve when choosing this input. Full convergence must exceed twice that
assumption. This scenario is not an expected return or evidence of profitability.

## Fixed screening specification

- Eight fixed assets; 28 pairs in fixed regression orientation. No best-orientation search.
- 751 aligned, consecutive, closed four-hour perpetual candles. No interpolation.
- 250/500/750 training observations; latest candle excluded from all fits and scale estimates.
- Log-price OLS with intercept. Hedge coefficient represents relative dollar exposure,
  not a direct quantity ratio.
- Augmented Engle–Granger cointegration p-values (MacKinnon), not ordinary residual ADF
  p-values. Explicit AIC lag selection, maximum 12.
- Bonferroni over all 84 pair/window tests. All three adjusted p-values must be <= .01.
- Diagnostic I(1) checks: level ADF p > .05 and difference ADF p < .01 in each window.
  Failure to reject a unit root is not proof of one.
- Positive hedge coefficients with max/min <= 1.25; same-sign entry z between 2.5 and 4
  in all windows. Thresholds are research hypotheses, not optimized parameters.
- Input hash included for reproducibility. Repeated scans must not be interpreted as
  independent confirmations; adjustment covers this fixed scan family only.

The walk-forward replay scans once per day and permits one pair at a time. It uses
$2,000 gross exposure, actual historical funding settlements and their mark prices,
40 bps round-trip costs, a $100 loss stop, z=5 structural stop, seven-day maximum
holding time, mean exit at |z| <= 0.5 and a two-day cooldown. Entries and exits use
four-hour candle closes, so this is deliberately not described as executable-price
accounting. The full rule set remains frozen after the first result.

Next gate, only if an eligible historical trade exists: order-book replay and then a
frozen prospective paper cohort. Neither screen nor replay can authorize a live trade.

Method reference: https://www.statsmodels.org/stable/generated/statsmodels.tsa.stattools.coint.html

## First captured scan — 2026-09-14 05:50 UTC

Snapshot and full output: `pairs-snapshots/2026-09-14/`. All 28 estimations completed.
Zero eligible pairs at the fixed thresholds and 40 bps scenario. Rejection counts
overlap: 28 lacked robust cointegration across all windows, 28 lacked a consistent
entry, 20 had unstable hedge coefficients, 12 lacked the cost buffer and 7 failed
the I(1) diagnostics. This is evidence against entering these pairs at this snapshot,
not proof that pairs strategies can never work. No thresholds were changed after
seeing the result. Four synthetic/data-integrity tests passed.

## First walk-forward replay — 2026-09-14 09:38 UTC

Evaluation period: 2026-03-31 16:00 UTC through 2026-09-14. The extended input contains
1,751 aligned closed candles and 876 funding settlements per asset. Result: zero
eligible entries, zero closed trades and no open position. Therefore no profit factor
or win rate is reported. This strategy remains `WAITING_DATA`; relaxing its criteria
after seeing zero trades would be post-hoc optimization. Eight tests passed, covering
signal absence, full cost charging, funding direction, input coverage and data integrity.
The durable R42 research ledger is therefore sealed with
`NO_ROBUST_PAIR_IN_WALK_FORWARD`; it cannot open a paper position.
