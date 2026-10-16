# BTC/ETH longer engineering history

Purpose: extend two fixed engineering references from201 to652 UTC daily OHLCV bars each,1January2023 through13October2024 inclusive. This is not a representative Top20 selection or a strategy performance result. Choosing today's familiar surviving assets is unsuitable evidence for a historical ranked-universe backtest.

The extension attempts30monthly archives: BTCUSDT and ETHUSDT, January2023–March2024. Download/checksum and expanded ZIP sizes are bounded; eight concurrent workers maximum, no retries or alternate sources. Only the prefix through26March2024 is retained, then joined to the earlier201-day window. The earlier suffix must remain byte-equivalent as normalized row arrays. Full combined data is checked by the reviewed daily normalizer, including continuous days, unit regime, geometry and timestamps. Exact required length652 is an additional gate. Any download failure remains recorded; no failed month is silently filled.

core-history-20241013/manifest.json lists completed files and SHA256. extension-audit.json preserves every attempted archive's outcome and checksum. Prior source hashes remain in warmup-history-audit-20241013.json. Current receipt time is preserved for the combined export, not backdated. All January2023–October2024 source months are inspected development material, not an untouched holdout. The final exclusive candle close is14October2024 at00:00UTC.

The new history crosses a year boundary and includes the2024leap day. Both are data-shape checks, not evidence of strategy robustness across market regimes.652bars contain many overlapping201bar windows, not independent samples. No windows have been fed to P1 or H7. No returns, trades or portfolio PnL are computed.

Remaining comparison prerequisites: historical instrument identity and listing rules, date-specific eligible universe, historical publication/revision evidence, execution quotes or an explicitly scoped approximation, FX conversion, verified fee model and position lifecycle/risk engine. The initial21candidate snapshot does not establish membership on any other date. Future universe construction must retain entrants/exits/delistings and rank/classification evidence as known then.

Legacy trend-pullback-v1-evidence-r34.md remains REJECTED. DailyP1 changes neither that decision nor the status of the frozen reference. Longer data preparation does not authorize strategy promotion, change campaign trial limits, install an optimizer or modify the parallel platform lane.
