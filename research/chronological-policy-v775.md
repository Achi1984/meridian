# MERIDIAN v7.75 — Chronological Policy Selection

Generated: 2026-09-03T19:07:16.501Z

Research-only. The policy for each 90d test period is selected exclusively from the immediately older 90d period. No same-period hindsight, no coverage reduction, no Paper/runtime/UI changes.

## Walk-forward steps

- P3 → P2: **LR_MTF3_VOLUME** · test ΔAvgR=0.003 · ΔPF=0.005 · displaced=3
- P2 → P1: **LR_MTF3** · test ΔAvgR=0 · ΔPF=0 · displaced=44
- P1 → P0: **LR_VOLUME** · test ΔAvgR=-0.002 · ΔPF=-0.002 · displaced=83

## Summary

Positive: **1/3** · neutral: **1** · negative: **1** · mean ΔAvgR=0 · mean ΔPF=0.001.

Persistent: **false**. Promotion allowed: **false**. Next step: **REJECT_PERIOD_SWITCHING_POLICY**.
