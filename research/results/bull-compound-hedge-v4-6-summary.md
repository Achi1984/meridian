# MERIDIAN Bull Compound v0.4.6 — full-coverage funding + margin audit

Research-only. The BTC core is never sold. Hedge rules are frozen from v0.4.1: static 20% inverse-style short, Fib 1.618 / 2.0 / 2.618 overextension trigger, partial TPs at -4% / -8% / -12%, 20% runner, +12% strategy stop, fees 10 bps and adverse slippage 5 bps per transaction.

## Funding data coverage
- Hybrid funding events: 7,965.
- Calendar-day coverage: 100.00% from 2020-05-12 through 2025-12-31.
- Binance Vision COIN-M BTCUSD_PERP archive available from 2022-07-01 through 2025-12-31 (42 monthly archives).
- Earlier missing COIN-M archive timestamps were filled from Binance Vision USD-M BTCUSDT; 4,227 fallback events were used.
- Where COIN-M and USD-M overlap, mean absolute funding-rate difference was 0.00004283 per funding event.
- Funding is a proxy for Pionex, not Pionex's own historical funding ledger.

## Funding-adjusted results
| Period | BTC end | vs 1 BTC HODL | Funding contribution | Stops | Liquidations | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| 2020-05-12 → 2025-12-31 | 1.06159 BTC | +6.16% | +0.02212 BTC | 6 | 0 at 7x/8x/8.89x with modeled execution | 76.20% |
| OOS 2023-01-01 → 2025-12-31 | 0.99657 BTC | -0.34% | +0.01206 BTC | 5 | 0 at 7x/8x/8.89x with modeled execution | 30.68% |

The conservative funding-ordering variant produced essentially the same result: 1.06158 BTC continuous and 0.99656 BTC OOS. Leverage does not change pre-liquidation PnL for the same hedge notional; 7x, 8x and 8.89x therefore have the same modeled terminal BTC when no liquidation occurs.

For comparison, the earlier no-funding v0.4.1 reference was 1.03912 BTC continuous and 0.98438 BTC OOS. Funding therefore improved the modeled result materially, but the untouched 2023–2025 window still remained slightly below 1 BTC HODL.

## Short leverage / liquidation calibration
The observed current Pionex short has entry 75,784.8, liquidation 85,007.9, 0.20 BTC-equivalent notional and 0.02250 BTC total margin, implying about 8.89x effective leverage. The observed liquidation is +12.17% above entry versus a theoretical inverse-short bankruptcy distance of +12.68%, so the snapshot calibration uses a maintenance/liquidation haircut of about 0.51 percentage points.

| Effective short leverage | Margin for 0.20 BTC notional | Extra vs current 0.02250 BTC | Modeled buffer above strategy +12% stop |
|---:|---:|---:|---:|
| 7x | 0.02857 BTC | +0.00607 BTC | +4.16 pp |
| 8x | 0.02500 BTC | +0.00250 BTC | +1.78 pp |
| 8.89x | 0.02250 BTC | +0.00000 BTC | +0.17 pp |

The user's actual current stop at 83,200 is only +9.78% above the observed short entry, while the observed liquidation is +12.17%, leaving 2.39 percentage points of entry-price buffer (about 2.17% of the stop price). This is safer than applying the generalized +12% strategy stop to the same 8.89x effective leverage.

## Current long-grid snapshot sensitivity
Observed current 4x Pionex long grid: entry 75,966.1, liquidation 46,837.5, base margin 0.0492 BTC, grid floor 42,600. A local inverse-position calibration to this single snapshot gives the following sensitivity estimates. These are not a full Pionex grid-liquidation engine because grid inventory and maintenance margin change as orders fill.

| Target long liquidation | Estimated total long margin | Estimated extra margin vs 0.0492 BTC |
|---:|---:|---:|
| $42,600 | 0.06196 BTC | +0.01276 BTC |
| $41,000 | 0.06747 BTC | +0.01827 BTC |
| $40,000 | 0.07113 BTC | +0.02193 BTC |
| $38,000 | 0.07904 BTC | +0.02984 BTC |
| $35,000 | 0.09260 BTC | +0.04340 BTC |

Current observed long margin plus current short total margin is 0.07170 BTC. If the generalized hedge strategy kept a +12% short stop, 7x effective short leverage has the largest modeled safety buffer among the tested practical choices; 8x remains more capital efficient but leaves only 1.78 percentage points to the calibrated liquidation estimate. The live current short differs because its stop is tighter at +9.78%.
