# MERIDIAN v7.92 — Macro Trend Overlay Evidence

Status: RESEARCH ONLY. No execution impact. No promotion.

Evidence run: `34024008675` on head `82bc9314c4ed0d5afa0a25ed6dbd8c6c645e924e`.
Artifact: `9986459221`, digest `sha256:291b4ae1789d1f515996a2eb2e844e7fbc902291eed69aff2843c324566ad511`.
Cutoff: `2026-09-06T08:45:00Z`.

## Thesis

Hybrid Alpha V1 contains 15m/1h/4h trend evidence but no slow market-direction context. v7.92 adds a symmetric BTC macro trend overlay based only on prior 7d/30d volatility-normalized drift. It does not alter the signal side and never increases V1 risk. It only attenuates LONG risk when macro trend is negative and SHORT risk when macro trend is positive.

## 30/60/90d comparison vs V1

### 4h
- 30d: EXP improves `-0.209R -> -0.166R`; PF `0.76 -> 0.79`; DD `84.2R -> 68.6R`.
- 60d: EXP `-0.153R -> -0.137R`; DD improves by ~13.5R.
- 90d: EXP slightly worsens `-0.055R -> -0.060R`; PF `0.94 -> 0.92`; DD improves `122.8R -> 107.6R`.

4h remains unprofitable. The overlay reduces risk but does not create edge.

### 12h
- 30d: PF `1.26 -> 1.18`, EXP `+0.328R -> +0.200R`.
- 60d: PF `1.02 -> 0.98`, EXP `+0.027R -> -0.032R`.
- 90d: PF `1.10 -> 1.04`, EXP `+0.146R -> +0.059R`; DD improves modestly.

The overlay sacrifices too much 12h edge.

### 24h
- 30d: PF `1.87 -> 2.05`, EXP `+2.131R -> +2.305R`, DD `59.6R -> 48.2R`.
- 60d: PF `1.36 -> 1.42`, EXP `+0.875R -> +0.938R`, DD `84.4R -> 75.8R`.
- 90d: PF `1.40 -> 1.44`, EXP `+0.877R -> +0.861R`, DD essentially flat/slightly better.

This is the first modification that improves the 24h candidate on PF and drawdown across all three windows while preserving almost all 90d expectancy.

## Robustness caveat

24h chronological 90d folds remain mixed:
- V1: PF `1.51 / 0.87 / 1.83`, EXP `+0.881 / -0.308 / +2.041R`.
- v7.92: PF `1.52 / 0.84 / 2.00`, EXP `+0.720 / -0.354 / +2.210R`.

The middle fold is still negative. v7.92 therefore **does not pass promotion robustness**. It improves risk/quality at the 24h horizon but does not solve temporal instability.

## Decision

- v7.91 Reliability Router: REJECTED.
- v7.92 Macro Trend Overlay: KEEP AS RESEARCH CANDIDATE, NOT PROMOTED.
- 4h Hybrid Alpha: reject as current primary horizon.
- 12h: secondary research horizon only.
- 24h: strongest current Hybrid Alpha horizon and the only one worth deeper robustness work.

## Next step

Do not tune macro attenuation strength yet. First explain the negative middle 24h fold. Break the 24h result into side x regime x asset x macro-alignment for each chronological fold and identify whether the failure is caused by one direction, regime, asset or market transition. Any next change should target a repeatable structural cause, not a fitted threshold.
