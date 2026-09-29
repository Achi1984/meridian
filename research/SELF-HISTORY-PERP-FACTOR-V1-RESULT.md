# Self-History Perp Factor V1 — Frozen Pre-Foundation Discovery Result

Workflow run: **36549194584**  
Artifact: **11023213666**  
Trigger commit: `9eaf7cd4edd075f386044f009a6fdaeafa4ffd62`  
Artifact ZIP SHA-256: `1dd475dedea5a727d8002cc3c5eb977640c23adf62f31d78db96c620b24b4580`  
Summary SHA-256: `10419606a677a58ac9557bae3c12f28626aee05a0538a105e5c2ec628e5f9efd`  
Full evidence SHA-256: `f79a00cd198ffb30a3225d7906f3fc692cb7bfa5ff939d01b41e5a8b1b4b4d16`

This records the first untouched run of `SELF-HISTORY-PERP-FACTOR-V1-FROZEN`, the earlier single-factor 8h lineage created before Perpetual Factor Data V1 became canonical.

## Frozen result

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

Gate reason:
- `DATA_INTEGRITY_FAILURE`

No economic strategy metrics were evaluated.

## Data integrity failures

Official Binance Vision USD-M 8h archives:

- SOLUSDT: `BAR_GAP`
- XRPUSDT: `BAR_GAP`
- LTCUSDT: `BAR_GAP`

Observed archive row counts across 2021-01 through 2026-08:
- most fixed assets: 6,207 8h bars
- SOLUSDT: 6,192
- XRPUSDT: 6,192
- LTCUSDT: 6,192

The frozen V1 engine required exact 8h cadence and therefore failed closed before trading.

## Decision

- no threshold change;
- no gap interpolation;
- no asset removal;
- no economic interpretation of zero trades;
- no temporal or transfer holdout;
- no Paper/live promotion.

The independently built `PERPETUAL-FACTOR-DATA-V1` foundation uses a separately audited 4h + premium + funding data standard and is a distinct successor foundation. It does not retroactively repair this V1 result.
