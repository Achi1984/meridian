# Kraken USD daily archive acquisition — 2026-10-18

Status: **CAPTURED_VALIDATED_COVERAGE_LIMITED**

## Scope and source

Official Kraken SPOT archives only; pairs: XBTUSD, ETHUSD, SOLUSD, XRPUSD, HBARUSD, LINKUSD, AVAXUSD, SUIUSD. Interval: 1440 minutes. Fixed inclusive cutoff: 2026-09-30T23:59:59Z. No exchange, quote-currency, or asset substitutions. Exact selected CSV member bytes are retained after ZIP decompression; hashes identify the captured member bytes and are not archive authenticity claims. ZIP CRCs are corruption checks only.

Format basis: owner-provided official page summary for timestamp/OHLC/volume/trade-count columns and no header, corroborated by the selected member rows. The support page was not fetched by this worker. Unix epoch timestamps are UTC day boundaries; gaps are reported and not filled.

## Archive evidence

- Q3 ZIP HEAD: HTTP 200; 576,348,633 bytes; ETag `"caa4a859d2f1c2b3740006d3dadf80ea-69"`; Last-Modified `Tue, 06 Oct 2026 13:02:46 GMT`; `Accept-Ranges: bytes`. A bounded 1 MiB tail returned HTTP 206 and exposed the complete central directory (10,054 entries).
- Full archive: five official parts; four parts of 2,097,152,000 bytes and final part 1,157,945,626 bytes. Bounded 1 MiB tail of part04 returned HTTP 206; ZIP64 central directory (12,352 entries; 852,374 bytes) was fully present. No archive parts were downloaded wholesale and no full archive SHA was claimed.
- Exact archive URLs, per-part ETags/Last-Modified, requested/received ranges, and capture hashes are in `acquisition-receipt.json`. The official full-parts checksum manifest URL is recorded there but was not fetched; no full archive checksum is claimed.
- **Metadata discrepancy:** owner-supplied page summary said Full through 2026-06-30. Observed Full member CSVs extend to 2026-09-30; all 92 July–September overlaps per asset match Q3 rows exactly. Treat observed member bytes as evidence and the summary discrepancy as unresolved.

## Budget

- Conservative original start lower bound: `2026-10-18T07:41:08.816Z`; original deadline: `2026-10-18T08:01:08.816Z`.
- Requests: 27/64 attempted (including three DNS-blocked probes); 24 HTTP responses; 16 selected-member range requests.
- Response bodies: 3,747,305 / 268,435,456 bytes (includes directory tails and bounded range overhead).
- Receipt `lastAccountingAt` and `completedAt`: `2026-10-18T07:58:01.964008Z`. The exact time of the earliest of the three failed DNS attempts was not exposed; elapsed time is measured conservatively from the worker/task start lower bound.

## Coverage and validation

Per-asset selected rows through cutoff (normalization keeps at most 2,500 most recent bars):

- **XBTUSD:** 2500 bars, 2019-11-27 to 2026-09-30; 0 gaps in normalized coverage; observed member coverage 2013-10-06 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **ETHUSD:** 2500 bars, 2019-11-27 to 2026-09-30; 0 gaps in normalized coverage; observed member coverage 2015-08-07 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **SOLUSD:** 1932 bars, 2021-06-17 to 2026-09-30; 0 missing calendar days across 0 gap intervals; observed member coverage 2021-06-17 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **XRPUSD:** 2500 bars, 2019-11-27 to 2026-09-30; 0 gaps in normalized coverage; observed member coverage 2017-05-18 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **HBARUSD:** 448 bars, 2025-07-10 to 2026-09-30; 0 missing calendar days across 0 gap intervals; observed member coverage 2025-07-10 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **LINKUSD:** 2500 bars, 2019-11-27 to 2026-09-30; 0 gaps in normalized coverage; observed member coverage 2019-09-25 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **AVAXUSD:** 1745 bars, 2021-12-21 to 2026-09-30; 0 missing calendar days across 0 gap intervals; observed member coverage 2021-12-21 to 2026-09-30; exact full/Q3 overlap 92 rows.
- **SUIUSD:** 1247 bars, 2023-05-03 to 2026-09-30; 0 missing calendar days across 0 gap intervals; observed member coverage 2023-05-03 to 2026-09-30; exact full/Q3 overlap 92 rows.

Common closes across all eight: **448**, 2025-07-10 through 2026-09-30; no missing days in common sequence. This is below the ideally desired 955; it is limited by observed HBARUSD history beginning 2025-07-10. No assets or parameters were changed.

The independent offline verifier also checked the complete observed Full+Q3 source sequences before the 2,500-bar truncation. It found 12 missing calendar days for XBTUSD, 6 for ETHUSD, and 1 for XRPUSD; SOLUSD, HBARUSD, LINKUSD, AVAXUSD, and SUIUSD had none. The exact dates and counts by source/normalized sequence are in `offline-verification.json`. No missing intervals were filled.

All inputs were validated in original row order; duplicate timestamps, exact overlap agreement, seven-field shape, UTC daily alignment, finite positive OHLC/bounds, finite nonnegative volume, nonnegative integer trade count, cutoff, and 2,500-bar ceiling passed. No sorting to repair disorder, no interpolation, and no strategy/evaluator/indicator/PnL run. Full archive hash verification was not performed.

## Reproduction commands

- Offline content verification: `node scripts/verify-kraken-usd-daily-acquisition.mjs`.
- Focused verifier tests: `node --test test/kraken-usd-daily-acquisition.test.js`.
- Existing full Node suite: `npm test` (2,593 tests passed). This shared sandbox checkout initially exposed tracked source files as group-writable; the suite was rerun with those local permissions temporarily normalized and then restored.
- Deterministic content-check output: `offline-verification.json` (contains observed input hashes, content-check counts, coverage/gaps, budget reconciliation, and receipt-only network limitations).
- Acquisition-time capture and normalization used temporary session scripts and are not reproduced as network-capable utilities. No acquisition or network operation is part of the offline verifier.

The verifier checks committed file bytes and independently derives normalized rows. Request counts, response statuses, URLs, ETags, Last-Modified values, and source identity remain receipt-only claims; no network events are replayed or authenticated. Hashes and CRCs establish consistency of captured bytes, not historical source authenticity.

## Outputs

- `acquisition-receipt.json` — exact cumulative counters, source metadata, member hashes, validation and coverage.
- `raw/full/` and `raw/2026Q3/` — exact selected raw member bytes; the 312,737-byte XBT Full member is losslessly chunked with a whole-member hash/index.
- `normalized/` — UTC daily rows at or before cutoff, capped at 2,500 per pair; split into ordered files if a file exceeds 262,144 bytes.

No strategy run, source audit flags change, publisher change, frozen research/result modification, or release metadata change.
