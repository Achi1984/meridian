# MERIDIAN v7.91 — Hybrid Alpha Reliability Router Design

Status: DESIGN / RESEARCH ONLY.

Purpose: preserve Hybrid Alpha V1's transparent soft-score decision while using only prior matured outcomes to attenuate risk in cohorts that have recently shown negative expectancy. No hard side/regime/asset gate. No risk increase above V1.

Reliability dimensions: side, regime, symbol. Each estimate uses only rows with timestamp earlier than the current decision and inside a bounded lookback. Expectancy is shrunk toward zero with n/(n+priorStrength). Positive expectancy leaves the factor at 1.0; negative expectancy reduces the factor smoothly as `1/(1+abs(shrunkExpectancy))`, bounded to [0.35,1.0]. The three factors are averaged, not multiplied, to avoid over-penalizing correlated evidence.

Research invariant: reliability can only reduce the base Hybrid Alpha risk multiplier. It never changes Baseline, Paper execution, live execution or Pionex.
