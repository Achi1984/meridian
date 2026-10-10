# MERIDIAN v7.85 R2 — Definitive Breakout / Expansion Evidence

Status: **REJECTED AS PAPER-CANDIDATE IN V1 FORM**. Research-only; no execution changes.

## Provenance

- Workflow run: `33922958094`
- Source head: `0d66058d02925e95e03cf86ffad756417e8c9e7c`
- Artifact: `9955744713`
- Artifact digest: `sha256:dce0be1b2bf019aacf9dc4801988fe58deae4f16f893ab6351566ced5208ef03`
- Universe: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ vs USDT
- Signal logic: `7.85-BREAKOUT-EXPANSION-V1`
- Outcome: fixed V1 full TP1/SL, 48h horizon, normalized R with fee/slippage; same-candle SL+TP1 resolves to SL.

## Results — TRADE decisions

| Window | n | Avg R | PF | Win rate | Total R |
|---|---:|---:|---:|---:|---:|
| 30d | 2,244 | -0.3930R | 0.533 | 39.62% | -881.8198R |
| 60d | 4,243 | -0.4119R | 0.514 | 39.03% | -1,747.7637R |
| 90d | 6,335 | -0.3979R | 0.523 | 38.03% | -2,520.8040R |

OBSERVE was also negative in every window: 30d -0.5407R / PF 0.422, 60d -0.4856R / PF 0.459, 90d -0.4491R / PF 0.484.

## Directional result

No hidden directional rescue appeared.

- 30d LONG: n=1,250, avg -0.3606R, PF 0.563; SHORT: n=994, avg -0.4337R, PF 0.498.
- 60d LONG: n=2,197, avg -0.4147R, PF 0.513; SHORT: n=2,046, avg -0.4089R, PF 0.516.
- 90d LONG: n=3,268, avg -0.3895R, PF 0.531; SHORT: n=3,067, avg -0.4069R, PF 0.515.

## Chronological stability

Every TRADE fold was negative.

30d folds avgR: -0.5968, -0.5269, -0.1557, -0.1856, -0.5001.

60d folds avgR: -0.4161, -0.5039, -0.4509, -0.3076, -0.3810.

90d folds avgR: -0.3887, -0.3296, -0.5079, -0.4995, -0.2639.

There is therefore no chronological OOS-like stability signal to justify a shadow ledger.

## Asset concentration / robustness

All 12 assets were negative in the 90d TRADE sample. The least-bad assets were still negative, e.g. NEAR -0.2771R / PF 0.634 and AVAX -0.3014R / PF 0.611. BTC was materially worse at -0.6673R / PF 0.347.

This is broad failure, not one bad asset contaminating an otherwise good strategy.

## Interpretation

The V1 close-break architecture is independent from Baseline READY, which is useful architecturally, but independence alone did not create edge. The very high trade frequency and uniformly negative fold/asset results indicate that the current trigger is probably entering too many raw first-break closes, including false breakouts and exhaustion moves.

Do **not** threshold-tune the current weighted score to rescue this result. The next legitimate hypothesis, if pursued, should change market mechanics rather than merely weights: e.g. a predeclared retest/hold confirmation, breakout-age/cooldown logic, or expansion-from-compression state transition. Any such variant must be a new version and compared against this fixed V1 control.

## Decision

- No Paper bot.
- No dashboard bot card as if executable.
- No v7.86 portfolio replay from V1.
- Preserve V1 as a negative control.
- If continuing this family, next candidate is a **Retest / Hold Breakout V2** with a new locked protocol, not score-threshold tuning.
