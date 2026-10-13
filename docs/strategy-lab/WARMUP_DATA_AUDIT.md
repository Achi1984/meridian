# Crypto 201-day warmup preparation — bounded source audit

This packet continues the owner's Top20/Top10 data-preparation request. It uses exactly the 25 frozen candidate identities from `universe-join-probe-20241013.json`, including earlier unsuccessful symbol mappings. It never replaces a failed candidate with a lower-ranked survivor. It is a data-coverage audit, not strategy Discovery, a backtest, approved universe selection or execution.

## Window and source scope

For each attempted Binance symbol, request the eight official monthly one-day kline archives for March–October 2024 and their SHA256 CHECKSUM files. The download budget is exactly 200 monthly archive attempts with at most one companion checksum request per successful archive; no retries or fallback source changes. Concurrent requests are bounded to eight. ZIP/expanded row sizes are bounded before parsing.

Filter rows by UTC opening dates 2024-03-27 through2024-10-13 inclusive. This gives 201 daily candles if complete. The corresponding exclusive end boundaries are2024-03-28 through2024-10-14. The final candle is not closed on 13 October; no claim is made that it was available before its close or before its true historical publication time.

Monthly downloads necessarily expose rows before/after the target window, including later October 2024. The full March–October source scope is logged as inspected material. Later rows are excluded before normalization and never fed into a strategy. None of these months may later be represented as an untouched holdout.

## What is checked

Archive bytes must match the downloaded companion checksum. CSV shape is checked. Selected rows are concatenated and sorted, then passed to the reviewed daily normalizer with explicit current receipt times. Passing that normalizer requires consecutive UTC days, exact inclusive raw closing timestamps, correct millisecond regime and coherent finite OHLCV. A complete window additionally requires all eight archive checks to succeed, 201 selected rows and the exact requested start/end. Sorting does not discard duplicates; duplicates/gaps fail the normalizer.

The report preserves every monthly URL, result, hash when verified, selected-row count and failure reason. Download timestamps are receipt evidence for this research session only. They are not retroactive historical availability. Byte-integrity checks cannot prove unrevised source history, a then-current ranking, broker access or executable prices.

`prepared-close-windows-20241013.json` retains only complete normalized close windows with columns `[exclusiveCloseTimeMs,closeUSDT]`. Each window references the source audit and provider ID/pair and carries a current-archive-availability timestamp. These close values are USDT-denominated spot observations, not EUR total returns. They have not been passed to H7 or any other strategy; no strategy PnL, rankings by return or performance metrics are calculated.

## What remains unverified

A complete price window is only a coverage result. CMC-to-venue identity mappings remain provisional. Historical stablecoin/wrapper classification, publication lag, provider revisions, historical listing/market filters, trade-size/liquidity limits, USDT/EUR conversion and trading costs must still be resolved. Short price histories and missing archives cannot be silently repaired by interpolation or substituted symbols.

The H7 universe and its Top10 comparison are not frozen by this packet. Even 20 complete windows would not prove 20 eligible assets under all filters. This date is a source feasibility example; repeated weekly memberships and an independent evaluation period still need their own reviewed manifest and trial accounting. Long/short derivatives require different instrument and funding data.

Portfolio risk/valuation, order sizing, corporate actions, persistent state and the migration of the old fixed 3:1 policy remain outstanding. The shared signal/ledger/normalizer primitives are not a running paper bot. The separate cross-market lane and frozen reference evidence are unchanged.

## Observed coverage

Of 200 monthly archive attempts, 178 passed checksum verification and 22 failed. Exactly 21 of the 25 frozen candidates have complete, normalized 201-day windows. TON has 67 selected daily rows, TAO has 186, and the attempted LEOUSDT and KASUSDT mappings have none. All failures and missing months remain in the machine-readable audit. These results do not certify 21 historically eligible instruments or profitability.
