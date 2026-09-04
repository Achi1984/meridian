# MERIDIAN v7.77 — Challenger V3.3 Risk Allocation Shadow

Generated: 2026-09-04T19:12:55.863Z

Research-only. Strict chronological expanding training. Challenger V3.2 entries, ranking and exits stay frozen; only bounded risk allocation changes from 0.25% base to max 0.35%. No Paper/UI/runtime execution change.

- **P3 → P2** · policy cells 36 · trades 310 · boosted 237 · ΔReturn -0.829pp · ΔPF 0.003 · ΔDD 1.318pp · winner−loser risk 0.0015pp
- **P3+P2 → P1** · policy cells 14 · trades 723 · boosted 313 · ΔReturn 0.268pp · ΔPF -0.002 · ΔDD 0.374pp · winner−loser risk -0.0003pp
- **P3+P2+P1 → P0** · policy cells 7 · trades 723 · boosted 225 · ΔReturn 0.757pp · ΔPF 0.003 · ΔDD 0.143pp · winner−loser risk 0.0008pp

## Summary

Positive return steps: **2/3** · DD-safe: **1/3** · allocation-efficient: **2/3** · equal coverage: **true**.
Persistent: **false**. Promotion allowed: **false**. Next step: **KEEP_V32_025_NO_CONTEXT_RISK**.

## Guardrail

This experiment cannot add or remove entries. It only reallocates risk among the exact frozen Challenger V3.2 trade set using context evidence learned exclusively from older periods. Even a pass does not promote V3.3 to Paper; it only permits a prospective research shadow.
