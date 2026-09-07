# MERIDIAN v7.102 — Signed Correlation Risk Budget Design

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Comparator: frozen Hybrid Alpha v7.97.  
Negative control: rejected v7.101 flat simultaneous risk cap.

## Structural hypothesis

v7.101 proved that simultaneous exposure is concentrated, but a flat sum cap scales almost every bundle and destroys too much alpha. A portfolio allocator should react to **co-movement and direction**, not merely the arithmetic sum of individual risk multipliers.

For every simultaneous 24h v7.97 decision bundle:

1. Use only the preceding **60 completed daily returns** for the same seven locked assets: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
2. Build the sample correlation matrix `C` from those decision-time returns. No future bars and no trade outcomes are used.
3. Build a signed incoming risk vector `w`, where LONG = `+riskMultiplier` and SHORT = `-riskMultiplier`.
4. Compute effective bundle risk: `sqrt(max(0, w' C w))`.
5. Reuse the already-declared portfolio budget of `1.00` research-risk unit: `scale = min(1, 1 / effectiveRisk)` when effectiveRisk > 0.
6. Multiply every trade in the bundle by the same scale. Every opportunity and the relative risk structure remain intact.

This allows genuinely diversifying/opposite exposures to retain more risk than v7.101 while still reducing highly correlated same-direction bundles.

## Frozen invariants

- Base decisions are exactly frozen v7.97.
- Seven-asset universe stays fixed.
- Primary horizon stays 24h; 4h and 12h are sensitivity only.
- 30/60/90d windows and three chronological 90d folds stay fixed.
- The correlation lookback is exactly 60 completed daily returns and will not be tuned after results.
- The effective-risk budget is exactly 1.00, reused from v7.101; no alternate-cap search.
- No asset, side, regime, funding, OI, taker-flow or realized-outcome rule.
- No ranking and no trade blocking.
- No incoming trade risk may be increased.
- If the required trailing correlation history is incomplete/non-finite, the bundle is left unchanged and flagged `CORRELATION_UNAVAILABLE`; no correlation is invented and the rejected flat-cap fallback is not used.
- No Baseline, Paper/live execution, Pionex, `server.js`, entries or exits change.

## Evaluation locked before evidence

Compare v7.102 directly with frozen v7.97 and show rejected v7.101 only as a negative control.

Required output:
- trade/opportunity count,
- PF, expectancy, net R, max DD,
- net-R/max-DD,
- 30/60/90d,
- three chronological 90d folds,
- LONG/SHORT × regime,
- per-asset concentration,
- number/share of scaled bundles and trades,
- mean/min scale,
- effective-risk before/after,
- correlation-history availability.

## Survival rule

v7.102 survives only as a research candidate if all are true:

1. opportunity count is identical to v7.97;
2. no trade risk is increased;
3. all bundles with valid correlation data finish with effective risk <= 1.00 (rounding tolerance only);
4. max DD improves on all primary 24h windows;
5. PF does not fall by more than 0.05 on any primary 24h window;
6. net-R/max-DD improves on 60d and 90d;
7. no chronological fold gets a materially worse negative expectancy/DD profile;
8. the improvement is not produced by scaling almost all trades toward zero; specifically the mean scale on scaled 90d bundles must remain >= 0.60;
9. no post-result asset/side/regime exclusion is required to make it pass.

Failure closes this allocator hypothesis with no lookback, budget or threshold tuning. Passing permits further research review only — never automatic promotion.
