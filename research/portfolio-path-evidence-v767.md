# MERIDIAN v7.67 — Challenger V3.2 Portfolio-Path Replay

Generated: 2026-09-02T15:32:55.760Z

Research-only. Baseline READY and Challenger V3.2 are replayed chronologically with the same 10,000 start equity, 1% risk/trade, max 3 open positions, max 3% portfolio risk, max 8 entries/day, 3% daily-loss gate, 8% drawdown gate and 30m symbol cooldown. V3.2 ranking uses only features present at each sample timestamp.

> Drawdown caveat: compact cohorts only contain entry/outcome/exit events, so DD is realized-equity drawdown rather than intratrade mark-to-market DD.

## 30d

Baseline: trades **139**, AvgR **0.157**, PF **1.303**, end equity **12271.61**, realized DD **8.49%**.
V3.2: trades **108**, AvgR **0.022**, PF **1.039**, end equity **10164.62**, realized DD **9.32%**.
Opportunity: overlap 17, discovered 91, displaced 122, avoided losers 63, missed winners 59.

## 60d

Baseline: trades **150**, AvgR **0.216**, PF **1.438**, end equity **13517.17**, realized DD **8.84%**.
V3.2: trades **9**, AvgR **-1**, PF **0**, end equity **9126.73**, realized DD **8.73%**.
Opportunity: overlap 2, discovered 7, displaced 148, avoided losers 72, missed winners 76.

## 90d

Baseline: trades **33**, AvgR **0.018**, PF **1.032**, end equity **10009.57**, realized DD **8.37%**.
V3.2: trades **32**, AvgR **0.05**, PF **1.089**, end equity **10115.87**, realized DD **8.55%**.
Opportunity: overlap 9, discovered 23, displaced 24, avoided losers 16, missed winners 8.

## P0

Baseline: trades **33**, AvgR **0.018**, PF **1.032**, end equity **10009.57**, realized DD **8.37%**.
V3.2: trades **32**, AvgR **0.05**, PF **1.089**, end equity **10115.87**, realized DD **8.55%**.
Opportunity: overlap 9, discovered 23, displaced 24, avoided losers 16, missed winners 8.

## P1

Baseline: trades **61**, AvgR **-0.016**, PF **0.972**, end equity **9830.08**, realized DD **10.21%**.
V3.2: trades **65**, AvgR **0.145**, PF **1.276**, end equity **10893.6**, realized DD **9.62%**.
Opportunity: overlap 20, discovered 45, displaced 41, avoided losers 22, missed winners 19.

## P2

Baseline: trades **26**, AvgR **-0.354**, PF **0.516**, end equity **9098.31**, realized DD **9.02%**.
V3.2: trades **52**, AvgR **-0.169**, PF **0.741**, end equity **9126.24**, realized DD **9.63%**.
Opportunity: overlap 9, discovered 43, displaced 17, avoided losers 11, missed winners 6.

## P3

Baseline: trades **9**, AvgR **-1**, PF **0**, end equity **9126.73**, realized DD **8.73%**.
V3.2: trades **50**, AvgR **-0.136**, PF **0.787**, end equity **9288.17**, realized DD **10.04%**.
Opportunity: overlap 6, discovered 44, displaced 3, avoided losers 3, missed winners 0.

## Summary

Across disjoint P0–P3, V3.2 had better AvgR in **4/4** periods, better PF in **4/4**, and lower realized DD in **1/4**.

## Guardrail

This is a chronological portfolio-path test, not Paper activation. If evidence survives, freeze the scorer and require a prospective untouched holdout before Shadow activation. Do not retune v7.66 weights on these same periods.
