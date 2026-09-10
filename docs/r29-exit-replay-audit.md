# Exit replay audit — R29

## Result

Research calculation corrections only. No changes to active V3 parameters, Paper execution, Live, retired ledgers or previous evidence files.

The archived 2026-09-02 report shows Challenger B_PROTECTED versus A_CURRENT differences of +0.422R (30-day window), -1.838R (60-day window), and +4.243R (90-day window). These are old simulated cohorts, not the current V3 ledger. Windows share an end date and are not independent holdouts. They do not establish a robust advantage for partial TP1 exits.

## Corrected defects

- A trade entered inside a candle could consume pre-entry highs and lows. Such trades are now excluded and counted in `excludedEntryBars`; merely omitting that candle could hide post-entry losses.
- A stop crossed by a candle-opening gap was always filled at the stop price. Long and short stops now use the worse opening price before the existing cost allowance.
- Same-bar stop/target conflicts retain the explicit stop-first convention and are counted in `ambiguousBars`.
- A cohort with no replayed trades receives no policy ranking.

## Limits and next evaluation

Only the old aggregate evidence is present locally; the underlying historical market arrays and current authenticated Paper ledger are not available for a matched rerun. Synthetic tests verify code behavior, not strategy profitability. The archived report must not be presented as recalculated evidence.

The model still approximates fees/slippage in R using entry price, uses OHLC rather than the actual quote path, and activates newly tightened stops on subsequent candles. Favorable excursion includes full candle extrema and can therefore overstate movement before an exit. No claim of exact execution parity is made.

Next: obtain the same trade IDs and dated quote/candle coverage, report excluded/ambiguous trades, freeze the cost and ordering rules, then compare full TP1 exits with one predeclared partial-exit policy. Use a fresh observation window rather than choosing the best historical window. Preserve parent and successor losses in the overall evaluation.
