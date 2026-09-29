# Self-History Perpetual Factor V2 — Frozen Discovery Result

Workflow run: **36555166725**  
Artifact: **11027965691**  
Artifact ZIP SHA-256: `e29f1fb541bf53b684e17a61cab38076378fe311dcb4c13e5db7347ad792a514`  
Summary file SHA-256: `9668624d6587c85d14a2e9d66261614a3372fdc3b637a2a8ceccef31de674439`  
Full evidence SHA-256: `deead4f04a22da060b936f06db931c74ad372b8d84534211fe89389e8de1c46b`  
Markdown SHA-256: `bf52a97d68dda172d99040800e9e27144334fd3da4b0e3256af6c8427af2e04d`

This records the first untouched real-data run of `SELF-HISTORY-PERP-FACTOR-V2-FROZEN`.

## Frozen decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

Gate reason:
- `DATA_INTEGRITY_FAILURE`

Observed error:
- `BTC: PREMIUM_GAP`

No economic strategy metrics were evaluated.

## Collected source evidence

Official Binance Vision USD-M monthly archives were collected for the frozen discovery universe.

Examples:
- BTC: 8,766 4h perpetual bars; 8,724 4h premium-index bars; 4,383 funding rows
- ETH: 8,766 / 8,724 / 4,383
- BNB: 8,766 / 8,724 / 4,383
- SOL: 8,736 / 8,730 / 4,458
- XRP: 8,736 / 8,730 / 4,383
- SUI: 3,650 / 3,650 / 1,825 from its later listing history

The strategy engine required exact 4h premium continuity and therefore failed closed before computing own-history, cross-sectional, PnL, Sharpe or drawdown.

## Decision discipline

- no premium interpolation;
- no gap deletion;
- no factor removal inside V2;
- no threshold change;
- no universe change;
- no economic interpretation of the absent strategy result;
- no temporal holdout;
- no transfer holdout;
- no Paper or live promotion.

The next allowed step is a **separate data diagnostic/foundation** that locates and classifies the premium-index gaps without changing V2. Any strategy successor must receive a new ruleset/name and be frozen before its first result.
