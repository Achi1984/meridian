# Regime-Gated Grid V2 — Frozen Discovery Result

Workflow run: **36547247431**  
Artifact: **11023180803**  
Artifact ZIP SHA-256: `e1ea1b30ad9ad1ddcd3bb6e88cf906595af44006003e78b7ae83033885cfd5a9`  
Summary SHA-256: `89b478d4ffad0a70293d74a5476421c9c43ca2125ab424528d6ba2ed521f2b0d`  
Full evidence SHA-256: `db6410bd6d93941145b409e67850c72b847ca523ef61726edbedcfd484262d7d`

This records the first untouched result of `REGIME-GATED-GRID-V2-FROZEN`.

## Regime sample

Discovery window:
- BTC / ETH
- 2024-01 through 2025-12
- 24 calendar months

Eligible before execution:
- BTC: 9 months
- ETH: 8 months
- paired eligible months: 5
- paired eligible asset-month cycles: **10**

Frozen minimum:
- >=16 paired asset-month cycles
- >=8 per asset

**Sample gate fails.**

Paired eligible months:
- 2024-08
- 2024-10
- 2025-02
- 2025-07
- 2025-10

All eligible minute datasets passed the execution-data gate.

## Frozen decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No candidate passes and no 2026 holdout is authorized.

## Best predeclared candidate

`RG2_GEO_0p015_H5`
- geometric step: 1.5%
- half-levels: 5

### PAPER_OLHC
- Dynamic return: **-16.27%**
- Static same-parameter return: **-21.39%**
- Profit Factor: **0.454**
- Max marked drawdown: **24.91%**
- Positive windows: **2/5**
- Paired asset-month cycles: **10**
- BTC return: **-8.65%**
- ETH return: **-24.18%**
- fills: 2,478
- resets: 89
- modeled costs: $2,741.91

### ALT_OHLC
- Dynamic return: **-16.24%**
- Static same-parameter return: **-21.63%**
- Profit Factor: **0.455**
- Max marked drawdown: **25.21%**
- Positive windows: **2/5**
- Paired asset-month cycles: **10**
- BTC return: **-8.67%**
- ETH return: **-24.09%**
- fills: 2,472
- resets: 89
- modeled costs: $2,734.54

### Stress
- PAPER_OLHC: **-20.34%**
- ALT_OHLC: **-20.31%**

## Interpretation

The independently frozen regime filter reduced trading activity and improved the same-parameter static grid, but it did not produce a positive net edge.

The result fails for two independent reasons:
1. the pre-committed regime sample is too sparse;
2. every tested candidate remains economically negative under both path assumptions, with both BTC and ETH negative.

This is therefore not a threshold-near miss and must not be rescued by loosening the regime gate or sample requirement.

## Anti-overfitting decision

- no 2026 holdout;
- no regime-threshold relaxation;
- no conversion of ineligible months after seeing results;
- no cost reduction;
- no path-mode removal;
- no candidate addition;
- no live or Paper promotion.

Any successor must use a new ruleset and a genuinely different hypothesis.
