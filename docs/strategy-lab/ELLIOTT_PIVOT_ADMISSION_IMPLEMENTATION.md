# Single-pivot evidence/admission implementation

`elliott-pivot-admission.mjs` exports `bindSinglePivotAdmission`, implementing the reviewed `ELLIOTT_PIVOT_ADMISSION_CONTRACT_20261014.md` (SHA-256 `bf9bc5b4721a14d83b609e3dbe10532b5f52832178cd4d5b433aa8892cba94b3`, published at `53189cef`). This identifies one admitted price pivot; it is not an Elliott wave setup or signal/entry adapter.

The exact minimal window has left/right widths 1–32 and 3–65 bars. The implementation reuses unchanged raw-bar, geometric-time and admission helpers. It validates every metadata index/open-time binding before receipt scalars, and **every bar's admission before any pivot-pattern diagnostic**. A late left or final bar therefore blocks even a non-pivot/ambiguous verdict. Geometric confirmation is derived internally from the actual timeframe's rightmost close. Actual admission uses maximum receipt across the whole window; assumption admission uses explicit delay after each bar close while retaining original archive receipts separately, including retrospective receipt after decision.

After admission, the independent comparator uses strict left and inclusive right extreme comparisons from frozen V1's legacy rule. Both high and low true reject as ambiguous; neither rejects as non-pivot. A copied complete window and metadata provide local evidence binding, not source authenticity. The next aligned hypothetical opening is strictly later than decision and rejects unsafe arithmetic. No candle, order price or fill at that future timestamp is established.

Outputs have exact contract shapes and fixed denied-authority flags, including `dataSourceAuthenticated:false`, `tradingSignal:false`, `entryFillEstablished:false`. Inputs and outputs do not share mutable evidence records. Failures return no partial pivot/evidence. The input boundary is trusted plain JSON data without accessors/proxies; shape checks do not authenticate or sanitize arbitrary executable JavaScript objects.

## Synthetic verification

```sh
node --test test/elliott-pivot-admission.test.js test/elliott-synthetic-path.test.js test/elliott-correction-helpers.test.js test/elliott-frozen-characterization.test.js
```

**48/48 tests pass:** 13 pivot tests and all 35 unchanged existing tests. Complete expected outputs cover HIGH/LOW × 4H/1D in both receipt modes. Other tests cover asymmetric ties, both/neither patterns, changed prices, late-left/final receipt precedence, full metadata binding before scalar timing, incorrect index/open/order, future archive receipt retained honestly, widths 1/32 and invalid bounds, exact window sizes, strict next boundary, near-safe-limit publication/entry-time overflow, malformed schema/time/OHLC, input immutability, repeatability and output-mutation isolation.

These are synthetic engineering checks, not market-history runs or profitability results. Frozen comparators, helpers, prior tests and path adapter are unchanged. No empirical trial is registered, no budget is reconciled/reset, and no strategy is reopened or promoted. Multi-pivot waves, entries, external data authentication and empirical/trading authorization remain outside scope. Independent review of this implementation is separate from approval of the design contract.

## Scoped static review follow-up

Claude response `6162611285` at source head `fdb7f839` returned `GREEN_SOURCE_ONLY` with `TESTS_NOT_RUN`: Claude performed static review, not test execution. This follow-up changes only pivot tests and this documentation. The pivot module is unchanged relative to that prior reviewed head (not a claim of no changes relative to the PR base), SHA-256 `c0deb7c7e7881c8c7fe681dfe33ebb43eacb1b718c93a18c4753cf805664f760`. Helpers and the contract are also unchanged.

Added synthetic tests exercise asymmetric widths 2/1 and 1/3 for HIGH/LOW in both timeframes, with explicit candidate index, rightmost confirmation, maximum left receipt and complete evidence assertions. Each receipt index is separately made late to assert all-window admission. At width32, the sole violating neighbor is placed at the farthest left or right edge for both kinds and timeframes; valid OHLC is retained, and `NOT_A_PIVOT` is required. The 48 passing local tests are separate from Claude's static verdict; no empirical results or expanded authorization follow.
