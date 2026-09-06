# MERIDIAN v7.97 — Low-Liquidity Risk Attenuation Design

Status: RESEARCH ONLY — NO PROMOTION.

This hypothesis is predeclared before any v7.97 evidence run.

## Single isolated change

Starting from frozen v7.96 behavior, if decision-time `liquidityQuality < 0.50`, multiply existing research risk by the already-used fixed factor `0.60`.

- v7.96 weak-alpha attenuation remains unchanged.
- v7.93 TRANSITION × SHORT attenuation remains unchanged.
- Risk may only decrease and never exceed the incoming v7.96 multiplier.
- No trade is blocked; side selection and opportunity count must remain unchanged.
- No factor, threshold, alpha band, asset, side or regime is tuned after results.
- No asset is removed, including AVAX.
- No Paper/live execution or Pionex path is connected.

## Locked evaluation

- Primary horizon: 24h.
- Locked universe: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
- Windows: 30d, 60d, 90d.
- Walk-forward: three chronological folds on 90d.
- Direct comparison: frozen v7.93 vs v7.96 vs v7.97.
- Report: PF, expectancy, max drawdown and opportunity count.
- Concentration: SIDE, REGIME and ASSET, with sample adequacy considered.
- Horizon-specificity guard: 4h and 12h remain diagnostic only; no generalization from 24h.

## Decision rule

Promotion remains forbidden regardless of aggregate improvement unless chronological OOS robustness, breadth and sample adequacy are credible. If the middle fold remains materially negative or the change is unstable, stop threshold search and move to structurally new, leakage-free evidence research.
