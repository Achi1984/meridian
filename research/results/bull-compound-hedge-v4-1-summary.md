# MERIDIAN Bull Compound v0.4.1 — activation + leverage safety

Research-only. Core BTC is never sold. Short notional and effective leverage are treated separately.

## Locked rule selected on 2020–2022 only
- Breakout: 60-day high; Fib extensions 1.618 / 2.0 / 2.618.
- Overextension gate: RSI14 >= 62 and close / EMA200 >= 1.00.
- Additional reversal confirmation: none selected by the training objective; red-close, 3-day-low-break and RSI-rollover variants did not improve the selected training score.
- Hedge notional: 20% of BTC-equivalent.
- TPs: -4% / -8% / -12%, closing 25% / 30% / 25%, with a 20% runner.
- Stop: +12% above hedge entry.

## Backtest results
| Period | BTC end | vs HODL | Trades | Profitable | Stops | Max DD strategy | Max DD HODL |
|---|---:|---:|---:|---:|---:|---:|---:|
| TRAIN 2020–2022 | 1.01863 | +1.86% | 4 | 3 | 1 | 76.20% | 76.63% |
| OOS 2023–2025 | 0.98438 | -1.56% | 9 | 5 | 5 | 30.69% | 32.02% |
| Continuous 2020–2025 | 1.03912 | +3.91% | 15 | 10 | 6 | 76.20% | 76.63% |

2021-11-10 bull checkpoint: 1.00769 BTC (+0.77% vs HODL). None of the top 20 training-selected models beat HODL in 2023–2025; median OOS was 0.97722 BTC.

## Effective short leverage safety
Safety rule: theoretical inverse-short bankruptcy distance must exceed the +12% stop by an additional 2 percentage points. This is a bankruptcy-distance approximation, not a Pionex maintenance-margin liquidation formula.

| Effective short leverage | Approx. bankruptcy distance up | Margin for 0.20 BTC-equivalent notional | Pass |
|---:|---:|---:|:---:|
| 6x | +20.00% | 0.03333 BTC | Yes |
| 7x | +16.67% | 0.02857 BTC | Yes |
| 8x | +14.29% | 0.02500 BTC | Yes |
| 9x | +12.50% | 0.02222 BTC | No |
| 10x | +11.11% | 0.02000 BTC | No |

The current short, normalized as 0.20 BTC notional on 0.02250 BTC total margin, is about 8.89x effective leverage. That is above the v4.1 safety cutoff for a +12% stop plus a 2% buffer, even though Pionex's actual liquidation calculation may differ.

## Long leverage / fixed notional margin
For a fixed 0.1968 BTC-equivalent long notional, leverage changes required margin but not pre-liquidation PnL:

| Nominal long leverage | Required margin |
|---:|---:|
| 3x | 0.06560 BTC |
| 4x | 0.04920 BTC |
| 5x | 0.03936 BTC |

Observed current 4x Pionex grid: entry 75,966.1, liquidation 46,837.5 = 38.34% downside buffer. Grid floor 42,600 is 43.92% below entry, so the observed liquidation remains above the grid floor. Exact 3x/5x Pionex grid liquidation is not inferred because grid inventory, maintenance margin and fill state materially affect the platform calculation.

## Interpretation
The backtest did not find a better hedge-activation filter than the original Fib/overextension trigger. The more actionable result is leverage separation: for the selected +12% hedge stop, 8x effective short leverage is the highest candidate meeting the 2%-buffer rule. On the long side, 4x remains a reasonable capital-efficiency reference for the current fixed notional, but its actual safety must be managed from the live Pionex liquidation value rather than a plain-futures leverage formula.
