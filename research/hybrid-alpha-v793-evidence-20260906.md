# MERIDIAN v7.93 — Transition Asymmetry evidence

Status: RESEARCH ONLY. No execution impact. No Pionex changes. Baseline 6.2 remains frozen.

Evidence run: GitHub Actions #35 on head `179af48e1b9f939c8a4dec6081c8699d878fe3a4`.
Artifact: `9986661279`.
Digest: `sha256:61429aac07a1fb44c9810893be67a1c1717b736334d1e970319a57d0a7ec023e`.
Cutoff: `2026-09-06T09:00:00.000Z`.
Source: Coinbase Exchange public 15m candles, BTC/ETH/SOL. Costs: 0.03R per full research-risk unit, scaled by actual risk multiplier.

## Predeclared hypothesis

v7.93 starts from v7.92 Macro Trend Overlay and applies one narrow soft change only:

- if `regime === TRANSITION` and `side === SHORT`, multiply research risk by `0.60`;
- no trade is blocked;
- LONG risk is never increased;
- no asset-specific rule;
- no threshold or entry change.

The hypothesis was selected because SHORT×TRANSITION had negative expectancy in each of the three prior 24h/90d folds, while LONG×TRANSITION was positive in all three.

## Results vs v7.92

### 24h

| Window | v7.92 PF | v7.93 PF | v7.92 EXP | v7.93 EXP | v7.92 DD | v7.93 DD |
|---|---:|---:|---:|---:|---:|---:|
| 30d | 2.05 | **2.11** | +2.305R | **+2.350R** | 48.202R | **46.753R** |
| 60d | 1.42 | **1.56** | +0.938R | **+1.130R** | 75.847R | **63.729R** |
| 90d | 1.44 | **1.59** | +0.861R | **+1.006R** | 63.600R | **50.362R** |

Trade count is unchanged: 63 / 129 / 199. This is a pure risk-allocation effect, not opportunity removal.

### 24h / 90d chronological folds

| Fold | v7.92 PF | v7.93 PF | v7.92 EXP | v7.93 EXP | v7.92 DD | v7.93 DD |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1.52 | **1.70** | +0.720R | **+0.776R** | 23.114R | **22.458R** |
| 2 | 0.84 | **0.98** | -0.354R | **-0.044R** | 51.106R | **43.654R** |
| 3 | 2.00 | **2.09** | +2.210R | **+2.286R** | 78.650R | **77.053R** |

The previously failing middle fold is almost neutral but remains slightly negative. Therefore the robustness criterion is still not met.

### 12h

v7.93 materially improves the longer windows:
- 30d: PF 1.18 -> 1.17, EXP +0.200R -> +0.187R (slightly worse).
- 60d: PF 0.98 -> **1.08**, EXP -0.032R -> **+0.100R**, DD 53.142R -> **46.604R**.
- 90d: PF 1.04 -> **1.14**, EXP +0.059R -> **+0.169R**, DD 53.142R -> **46.604R**.

### 4h

Still negative. v7.93 improves loss/DD but does not create edge:
- 90d PF 0.92 -> 0.95; EXP -0.060R -> -0.039R.

This supports keeping Hybrid Alpha focused on slower 12h/24h horizons rather than forcing a 4h application.

## Decision

**NO PROMOTION.**

v7.93 is the strongest Hybrid Alpha candidate so far because it improves 24h PF, expectancy and drawdown in all three 30/60/90d windows without reducing trade count, and improves every chronological 24h fold. However fold 2 remains marginally negative (PF 0.98, EXP -0.044R), so it does not meet the robustness requirement.

Do not tune the 0.60 factor to force fold 2 above 1.00. That would be direct in-sample threshold fitting.

## Next step

Freeze v7.93 parameters. Run a prospective / later-data holdout and broader-asset robustness check before any further algorithm change. Add funding/carry and true order-flow only when decision-time historical data can be sourced without leakage; missing features remain missing rather than fabricated.
