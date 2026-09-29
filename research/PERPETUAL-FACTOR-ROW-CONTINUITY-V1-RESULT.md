# Perpetual Factor Row Continuity V1 — Frozen Result

Workflow run: **36555861582**  
Artifact: **11027907266**  
Artifact ZIP SHA-256: `e007ab090a8eb4b371d5932d7c43675f59d5be43e2a3ae62a3e6a6f11aef9753`  
JSON SHA-256: `996a85e176bd45e897232a3ac803feca66e289e9b796c044133c98d2e412cc82`  
Markdown SHA-256: `ce0cf3e3379b05c7d96f3334ddeeb4fde5f77762bd543ed41e89a96a65233adc`

## Decision

**ROW_CONTINUITY_CHARACTERIZED**

Transport errors: **0**

No strategy PnL was computed.

## Key findings

### Funding
Across all 14 frozen assets:
- funding gaps >12 hours: **0**

### Premium-index 4h continuity
For the long-history assets, factor-ready eligible Monday coverage is approximately **99%**.

Examples:
- BTC: 48 missing premium 4h rows; 190 / 192 eligible Mondays factor-ready
- ETH: 48 missing; 190 / 192
- BNB: 48 missing; 190 / 192
- SOL: 42 missing; 190 / 192
- HBAR: 42 missing; 181 / 183
- SUI: 6 missing; 69 / 70 after later eligibility

The audit identified **48 synchronized premium-gap timestamps** affecting at least half of then-listed assets.

For the major synchronized events, regular 4h perpetual klines remained present while premium-index rows were missing. This characterizes the dominant issue as premium/archive-specific rather than a general absence of tradable-price history.

### Representative synchronized premium gaps

BTC and most then-listed assets:
- 2021-07-01: 6 missing 4h premium bars
- 2021-07-24 through 2021-07-27: 24 missing bars
- 2022-10-02: 6 missing bars
- 2023-02-24: 6 missing bars
- 2026-06-29: 6 missing bars

Some assets have a small number of additional asset-specific differences. No interpolation is performed.

### Regular 4h kline continuity

Most assets: no missing 4h regular klines in their audited listing interval.

SOL, XRP, LTC and HBAR each show 30 missing regular 4h rows concentrated in two historical runs:
- 2022-02-26 through 2022-02-28: 18 bars
- 2022-04-01 through 2022-04-02: 12 bars

These are explicit source gaps and remain unfilled.

## Implication for a successor

A future strategy may only handle these facts through a **new frozen ruleset**.

A defensible successor can:
- keep price/funding factors active only when their exact required inputs exist;
- set an individual factor book to FLAT for a week when that factor's required input window is incomplete;
- require a predeclared minimum coverage rate;
- keep the other independently constructed factor books unchanged.

It may not:
- interpolate premium values;
- delete bad dates after seeing PnL;
- silently switch to another source;
- retroactively repair V2.

V2 remains an immutable `DATA_INTEGRITY_FAILURE`.
