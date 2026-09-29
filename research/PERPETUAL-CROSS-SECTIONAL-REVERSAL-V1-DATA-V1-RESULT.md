# Perpetual Cross-Sectional Reversal V1 Data Foundation V1 — Frozen Result

Workflow run: **36599268166**  
Artifact: **11049091249**  
Artifact ZIP SHA-256: `5b066b52dd122ac6e3ea78b9e5b5465fde5f0f397807560016063f87834f5760`  
Foundation JSON SHA-256: `c1f18744b4e74de44c0bb7d25b8f2d4c896787ac4a071b81dadd90620cc30626`

This records the first untouched result of `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN`.

## Frozen scope

Candidate universe: 24 assets

- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX
- HBAR
- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR
- OP
- INJ
- APT
- CRV
- LDO
- GALA
- IMX
- ARB

Audit interval:
- 2022-01 through 2026-08
- 56 completed calendar months

Public source:
- Binance Vision USD-M 1d perpetual klines
- Binance Vision USD-M fundingRate archives

## Result

**FOUNDATION_PASS**

- LONG_HISTORY_READY: **24/24**
- 2024_DISCOVERY_READY: **23/24**
- unexpected transport errors: **0**
- strategy PnL calculated: **false**
- reversal ranks calculated: **false**
- volatility-conditioned returns calculated: **false**
- synthetic backfill used: **false**

The preregistered foundation gates were:
- >=18/24 LONG_HISTORY_READY
- >=12/24 2024_DISCOVERY_READY

Both pass with substantial margin.

## Discovery-ready assets

All frozen candidates except ARB are 2024_DISCOVERY_READY:

ADA, DOGE, LINK, DOT, LTC, BCH, AVAX, HBAR, TRX, ETC, XLM, ATOM, UNI, AAVE, FIL, NEAR, OP, INJ, APT, CRV, LDO, GALA, IMX.

ARB:
- first official price month: 2023-03
- first core-complete month: 2023-04
- long-history ready by 2026-08: yes
- 2024-discovery ready under the frozen pre-2024 history rule: no

ARB remains in the frozen foundation output and may only become eligible in a later stage if the separately frozen strategy protocol's objective history rule permits it.

## Historical archive gaps retained

The audit preserved several early 2022 core gaps rather than repairing them.

Examples:
- LTC: 2022-02, 2022-04
- HBAR: 2022-02, 2022-04
- TRX: 2022-02, 2022-04
- XLM: 2022-02, 2022-04
- FIL: 2022-02, 2022-04
- NEAR: 2022-02, 2022-04
- IMX: 2022-04

These assets still satisfy LONG_HISTORY_READY because each has a later >=24-month uninterrupted core-complete run ending in 2026-08.

No missing month was reconstructed or silently ignored.

## Gate decision

**FOUNDATION_PASS**

This authorizes only a separately frozen Perpetual Cross-Sectional Reversal V1 strategy protocol.

It does not authorize:
- strategy PnL;
- reversal ranking;
- volatility conditioning;
- portfolio construction;
- Paper shadow;
- live execution.

## Anti-overfitting status

- universe unchanged;
- mega-cap exclusion unchanged;
- audit interval unchanged;
- no failed-asset replacement;
- no gap tolerance added after results;
- no strategy parameters inferred;
- no PnL calculated.

The next allowed step is to freeze formation period, skip period, weekly ranking/holding, volatility treatment, funding/cost accounting, discovery/holdout split and promotion gates before the first strategy result.
