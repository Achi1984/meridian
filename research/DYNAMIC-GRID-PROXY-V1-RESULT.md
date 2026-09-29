# Dynamic Grid Proxy V1 — Frozen Discovery Result

Workflow run: **36545882929**  
Artifact: **11022720893**  
Artifact ZIP SHA-256: `3f8ba43470af8476bfa6f10eb9581b5665219cfec873df4e509f7e5794ac519b`  
Summary SHA-256: `8113ff83ef9cb28830366bac34a7bf5a764ed105dd634f397082dc148ccba026`  
Full evidence SHA-256: `fb185605a95123f014b620ef17a44252d4e75ec25f991b7120733dcd0eb6ef62`

This records the first untouched result of `DYNAMIC-GRID-PROXY-V1-FROZEN`.

## Data gate

Official Binance Vision Spot 1-minute data:
- BTCUSDT
- ETHUSDT
- discovery: 2022-01 through 2023-12

Valid asset-months: **46 / 48**

Rejected identically for both assets:
- 2023-03 BTC: minute data gap
- 2023-03 ETH: minute data gap

No synthetic reconstruction was used.

## Frozen decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No candidate passes the pre-committed gate. No temporal holdout is authorized.

## Best predeclared candidate

`GEO_0p02_H5`
- geometric step: 2.0%
- half-levels: 5

### PAPER_OLHC
- Dynamic net return: **-8.07%**
- Static same-parameter return: **-42.20%**
- Profit Factor: **1.011**
- Max marked drawdown: **32.97%**
- Positive windows: **3/5**
- BTC return: **-10.53%**
- ETH return: **-6.96%**
- Fills: 4,161
- Dynamic resets: 129
- Modeled costs: $4,600.43

### ALT_OHLC
- Dynamic net return: **-7.51%**
- Static same-parameter return: **-42.42%**
- Profit Factor: **1.018**
- Max marked drawdown: **32.74%**
- Positive windows: **3/5**
- BTC return: **-11.14%**
- ETH return: **-5.13%**
- Fills: 4,175
- Dynamic resets: 129
- Modeled costs: $4,613.81

### Stress
- PAPER_OLHC: **-18.50%**
- ALT_OHLC: **-18.03%**

## Interpretation

The dynamic reset mechanism materially improves the same-parameter static grid, so the reset concept has economic value relative to a fixed grid in this sample. It still fails to produce a positive net edge under the frozen self-financing wallet, 8 bps fee, 2 bps base slippage and no-capital-injection model.

The failure is not caused by one intrabar path assumption: both path modes produce similar negative outcomes. The best candidate remains negative for both BTC and ETH and becomes materially worse under the frozen stress costs.

## Anti-overfitting decision

- no holdout;
- no fee/slippage reduction;
- no asset/month removal;
- no path-mode removal;
- no addition of a new grid size or half-level after seeing this result;
- no arithmetic-grid rescue;
- no live or Paper promotion.

Any successor must use a newly frozen hypothesis/ruleset rather than retuning V1.
