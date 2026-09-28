# Paper Bot Profit V2 — UP-UP Momentum Frozen Result

Workflow run: **36482452784**  
Artifact: **10997375443**  
Artifact SHA-256: `e43eec118cb0f36f634a62cc7c3f461a331f7526caa53c230f638cb0dcdc6fce`

The V2 UP-UP protocol and warm-up rule were committed before this successful discovery run. The only pre-result implementation fix made by the verifier was to ensure zero-scale warm-up rows stay flat instead of being marked active.

| Metric | Result |
|---|---:|
| Net compounded return | **+7.22%** |
| Profit Factor | **1.129** |
| Max drawdown | **43.81%** |
| Positive windows | **2/5** |
| Positive assets | **5** |
| Positive-PnL concentration | **29.2%** |
| Active weeks | **93 / 263 (35.4%)** |
| Modeled cost sum | **9.11 percentage points** |
| Long contribution | **+18.08 pp** |
| Short contribution | **+0.21 pp** |
| Equal-weight benchmark | **+7.24%** |
| BTC benchmark | **+87.51%** |

## Frozen decision

**V2_DISCOVERY_FAIL.**

The strategy is positive, but it fails the pre-committed Profit Factor, max-drawdown and chronological-stability gates. Its net result is also essentially equal to the simple equal-weight benchmark, while BTC buy-and-hold was far stronger over the same eligible timestamps. The short side contributed almost nothing.

No V2 threshold is relaxed and no holdout/promotion is authorized.

## Next research lane

Proceed to the separately frozen **simple delta-neutral funding carry** lane. It has a distinct cash-flow mechanism and does not depend on rescuing the failed directional momentum parameters.

Research only. No live execution impact.
