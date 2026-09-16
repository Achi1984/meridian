# MERIDIAN Bull Compound v0.4.3 — corrected staged hedge sizing

Research-only. Core BTC is never sold. Base market trigger is locked from v0.4.1. Funding is excluded; 10 bps fees and 5 bps adverse slippage are included.

## Training-selected staged policy
- Mode: drawdown-based staging.
- Hedge stages: 10% -> 15% -> 20% of BTC-equivalent notional.
- Stage-up after approximately 2% and 4% drawdown from the local peak.
- No starter timeout or upside invalidation was selected by the 2020–2022 training objective.
- Effective short leverage for margin diagnostics: 8x.
- Base TP/SL logic remains -4% / -8% / -12% partial TPs, 20% runner, +12% stop.

## Results
| Period | Staged hedge | vs HODL | Static 20% v0.4.1 | Static vs HODL |
|---|---:|---:|---:|---:|
| TRAIN 2020–2022 | 1.00802 BTC | +0.80% | 1.01863 BTC | +1.86% |
| OOS 2023–2025 | 0.98729 BTC | -1.27% | 0.98438 BTC | -1.56% |
| Continuous 2020–2025 | 1.02684 BTC | +2.68% | 1.03912 BTC | +3.91% |

Staged OOS drawdown was 31.08% versus 30.69% for the static 20% hedge and 32.02% for pure HODL in the earlier benchmark. The staged model made 10 OOS trades, 5 profitable, with 6 stops; the static model made 9 OOS trades, 5 profitable, with 5 stops.

The 2021-11-10 bull checkpoint for the staged model was 0.99959 BTC (-0.04% versus HODL). None of the top 20 staged policies selected on 2020–2022 beat HODL in untouched 2023–2025; median OOS was 0.98590 BTC.

## Capital efficiency at a full 20% hedge
| Long leverage | Short effective leverage | Long margin | Short margin | Combined margin |
|---:|---:|---:|---:|---:|
| 3x | 7x | 0.06560 BTC | 0.02857 BTC | 0.09417 BTC |
| 3x | 8x | 0.06560 BTC | 0.02500 BTC | 0.09060 BTC |
| 4x | 7x | 0.04920 BTC | 0.02857 BTC | 0.07777 BTC |
| 4x | 8x | 0.04920 BTC | 0.02500 BTC | 0.07420 BTC |
| 5x | 7x | 0.03936 BTC | 0.02857 BTC | 0.06793 BTC |
| 5x | 8x | 0.03936 BTC | 0.02500 BTC | 0.06436 BTC |

## Interpretation
Staging did not create a robust edge. It slightly improved the untouched 2023–2025 terminal BTC result versus the static hedge (0.98729 vs 0.98438), but gave up more in the training cycle and across the full 2020–2025 period. It also increased the number of stops and slightly worsened drawdown versus static 20%.

The evidence currently favors keeping the hedge sizing logic simple rather than forcing 5/10/20-style staging. The next useful research axis is regime gating: deciding when the hedge system should be enabled at all, for example only after a daily/weekly trend-extension regime plus a confirmed loss of short-term momentum. That should be tested out-of-sample without increasing leverage.
