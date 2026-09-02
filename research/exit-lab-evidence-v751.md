# MERIDIAN v7.51 — Exit Lab Evidence Report

Generated: 2026-09-02T12:38:09.518Z

Assets: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, SUIUSDT, HBARUSDT, AVAXUSDT, NEARUSDT, DOTUSDT, FETUSDT, INJUSDT

Windows: 30d, 60d, 90d

Method: same historical entries, parallel exit policies on subsequent 15m candles. Research-only.

## 30-day window

| Bot | Modell | Trades | Total R | Avg R | Median R | R-WR | Giveback R | TP1→BE | TP2 | ΔR vs A |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | A_CURRENT | 25 | -4.741 | -0.19 | -1.108 | 48% | 0 | 0% | 0% | 0 |
| baseline | B_PROTECTED | 25 | -4.705 | -0.188 | -1.108 | 48% | 0 | 0% | 0% | 0.036 |
| baseline | C_ATR_RUNNER | 25 | -5.628 | -0.225 | -1.108 | 48% | 0 | 0% | 0% | -0.887 |
| baseline | D_ADAPTIVE | 25 | -3.392 | -0.136 | -1.108 | 48% | 0 | 0% | 0% | 1.349 |
| baseline | B_CONFIRM_CLOSE | 25 | -5.207 | -0.208 | -1.108 | 40% | 0 | 0% | 0% | -0.466 |
| baseline | B_BE_PLUS_010 | 25 | -4.455 | -0.178 | -1.108 | 48% | 0 | 0% | 0% | 0.286 |
| baseline | B_BE_PLUS_025 | 25 | -4.727 | -0.189 | -1.108 | 48% | 0 | 0% | 0% | 0.014 |
| shadow | A_CURRENT | 18 | -11.236 | -0.624 | -1.199 | 27.8% | 0 | 0% | 0% | 0 |
| shadow | B_PROTECTED | 18 | -12.029 | -0.668 | -1.199 | 27.8% | 0 | 0% | 0% | -0.793 |
| shadow | C_ATR_RUNNER | 18 | -10.981 | -0.61 | -1.199 | 27.8% | 0 | 0% | 0% | 0.255 |
| shadow | D_ADAPTIVE | 18 | -10.555 | -0.586 | -1.199 | 27.8% | 0 | 0% | 0% | 0.681 |
| shadow | B_CONFIRM_CLOSE | 18 | -12.655 | -0.703 | -1.199 | 22.2% | 0 | 0% | 0% | -1.419 |
| shadow | B_BE_PLUS_010 | 18 | -11.879 | -0.66 | -1.199 | 27.8% | 0 | 0% | 0% | -0.643 |
| shadow | B_BE_PLUS_025 | 18 | -11.654 | -0.647 | -1.199 | 27.8% | 0 | 0% | 0% | -0.418 |
| challenger | A_CURRENT | 24 | -5.584 | -0.233 | -1.127 | 45.8% | 0 | 0% | 0% | 0 |
| challenger | B_PROTECTED | 24 | -5.162 | -0.215 | -1.127 | 45.8% | 0 | 0% | 0% | 0.422 |
| challenger | C_ATR_RUNNER | 24 | -6.16 | -0.257 | -1.127 | 45.8% | 0 | 0% | 0% | -0.576 |
| challenger | D_ADAPTIVE | 24 | -4.082 | -0.17 | -1.127 | 45.8% | 0 | 0% | 0% | 1.502 |
| challenger | B_CONFIRM_CLOSE | 24 | -6.417 | -0.267 | -1.127 | 37.5% | 0 | 0% | 0% | -0.833 |
| challenger | B_BE_PLUS_010 | 24 | -4.962 | -0.207 | -1.127 | 45.8% | 0 | 0% | 0% | 0.622 |
| challenger | B_BE_PLUS_025 | 24 | -5.308 | -0.221 | -1.127 | 45.8% | 0 | 0% | 0% | 0.276 |
| regime | A_CURRENT | 39 | -18.915 | -0.485 | -1.21 | 41% | 0 | 0% | 0% | 0 |
| regime | B_PROTECTED | 39 | -19.361 | -0.496 | -1.21 | 41% | 0 | 0% | 0% | -0.446 |
| regime | C_ATR_RUNNER | 39 | -16.853 | -0.432 | -1.21 | 41% | 0 | 0% | 0% | 2.062 |
| regime | D_ADAPTIVE | 39 | -17.176 | -0.44 | -1.21 | 41% | 0 | 0% | 0% | 1.739 |
| regime | B_CONFIRM_CLOSE | 39 | -18.827 | -0.483 | -1.21 | 35.9% | 0 | 0% | 0% | 0.088 |
| regime | B_BE_PLUS_010 | 39 | -18.961 | -0.486 | -1.21 | 41% | 0 | 0% | 0% | -0.046 |
| regime | B_BE_PLUS_025 | 39 | -18.361 | -0.471 | -1.21 | 41% | 0 | 0% | 0% | 0.554 |

## 60-day window

| Bot | Modell | Trades | Total R | Avg R | Median R | R-WR | Giveback R | TP1→BE | TP2 | ΔR vs A |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | A_CURRENT | 15 | -6.917 | -0.461 | -1.114 | 33.3% | 0 | 0% | 0% | 0 |
| baseline | B_PROTECTED | 15 | -8.755 | -0.584 | -1.114 | 33.3% | 0 | 0% | 0% | -1.838 |
| baseline | C_ATR_RUNNER | 15 | -7.482 | -0.499 | -1.114 | 33.3% | 0 | 0% | 0% | -0.565 |
| baseline | D_ADAPTIVE | 15 | -8.364 | -0.558 | -1.114 | 33.3% | 0 | 0% | 0% | -1.447 |
| baseline | B_CONFIRM_CLOSE | 15 | -11.167 | -0.744 | -1.114 | 13.3% | 0 | 0% | 0% | -4.25 |
| baseline | B_BE_PLUS_010 | 15 | -8.555 | -0.57 | -1.114 | 33.3% | 0 | 0% | 0% | -1.638 |
| baseline | B_BE_PLUS_025 | 15 | -8.255 | -0.55 | -1.114 | 33.3% | 0 | 0% | 0% | -1.338 |
| shadow | A_CURRENT | 13 | -6.791 | -0.522 | -1.135 | 30.8% | 0 | 0% | 0% | 0 |
| shadow | B_PROTECTED | 13 | -8.117 | -0.624 | -1.135 | 30.8% | 0 | 0% | 0% | -1.326 |
| shadow | C_ATR_RUNNER | 13 | -7.088 | -0.545 | -1.135 | 30.8% | 0 | 0% | 0% | -0.297 |
| shadow | D_ADAPTIVE | 13 | -7.732 | -0.595 | -1.135 | 30.8% | 0 | 0% | 0% | -0.941 |
| shadow | B_CONFIRM_CLOSE | 13 | -9.899 | -0.761 | -1.135 | 15.4% | 0 | 0% | 0% | -3.108 |
| shadow | B_BE_PLUS_010 | 13 | -7.967 | -0.613 | -1.135 | 30.8% | 0 | 0% | 0% | -1.176 |
| shadow | B_BE_PLUS_025 | 13 | -7.742 | -0.596 | -1.135 | 30.8% | 0 | 0% | 0% | -0.951 |
| challenger | A_CURRENT | 15 | -6.917 | -0.461 | -1.114 | 33.3% | 0 | 0% | 0% | 0 |
| challenger | B_PROTECTED | 15 | -8.755 | -0.584 | -1.114 | 33.3% | 0 | 0% | 0% | -1.838 |
| challenger | C_ATR_RUNNER | 15 | -7.482 | -0.499 | -1.114 | 33.3% | 0 | 0% | 0% | -0.565 |
| challenger | D_ADAPTIVE | 15 | -8.364 | -0.558 | -1.114 | 33.3% | 0 | 0% | 0% | -1.447 |
| challenger | B_CONFIRM_CLOSE | 15 | -11.167 | -0.744 | -1.114 | 13.3% | 0 | 0% | 0% | -4.25 |
| challenger | B_BE_PLUS_010 | 15 | -8.555 | -0.57 | -1.114 | 33.3% | 0 | 0% | 0% | -1.638 |
| challenger | B_BE_PLUS_025 | 15 | -8.255 | -0.55 | -1.114 | 33.3% | 0 | 0% | 0% | -1.338 |
| regime | A_CURRENT | 20 | -13.143 | -0.657 | -1.189 | 25% | 0 | 0% | 0% | 0 |
| regime | B_PROTECTED | 20 | -15.877 | -0.794 | -1.189 | 25% | 0 | 0% | 0% | -2.734 |
| regime | C_ATR_RUNNER | 20 | -14.263 | -0.713 | -1.189 | 25% | 0 | 0% | 0% | -1.12 |
| regime | D_ADAPTIVE | 20 | -15.262 | -0.763 | -1.189 | 25% | 0 | 0% | 0% | -2.119 |
| regime | B_CONFIRM_CLOSE | 20 | -17.234 | -0.862 | -1.189 | 15% | 0 | 0% | 0% | -4.091 |
| regime | B_BE_PLUS_010 | 20 | -15.627 | -0.781 | -1.189 | 25% | 0 | 0% | 0% | -2.484 |
| regime | B_BE_PLUS_025 | 20 | -15.252 | -0.763 | -1.189 | 25% | 0 | 0% | 0% | -2.109 |

## 90-day window

| Bot | Modell | Trades | Total R | Avg R | Median R | R-WR | Giveback R | TP1→BE | TP2 | ΔR vs A |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | A_CURRENT | 39 | 8.163 | 0.209 | 1.173 | 56.4% | 0 | 0% | 0% | 0 |
| baseline | B_PROTECTED | 39 | 11.84 | 0.304 | 0.599 | 56.4% | 0 | 0% | 0% | 3.677 |
| baseline | C_ATR_RUNNER | 39 | 12.352 | 0.317 | 0.91 | 56.4% | 0 | 0% | 0% | 4.189 |
| baseline | D_ADAPTIVE | 39 | 12.831 | 0.329 | 0.756 | 56.4% | 0 | 0% | 0% | 4.668 |
| baseline | B_CONFIRM_CLOSE | 39 | 10.676 | 0.274 | 0.589 | 53.8% | 0 | 0% | 0% | 2.513 |
| baseline | B_BE_PLUS_010 | 39 | 11.127 | 0.285 | 0.649 | 56.4% | 0 | 0% | 0% | 2.964 |
| baseline | B_BE_PLUS_025 | 39 | 10.706 | 0.275 | 0.724 | 56.4% | 0 | 0% | 0% | 2.543 |
| shadow | A_CURRENT | 34 | 2.224 | 0.065 | 0.05 | 50% | 0 | 0% | 0% | 0 |
| shadow | B_PROTECTED | 34 | 5.858 | 0.172 | -0.239 | 50% | 0 | 0% | 0% | 3.634 |
| shadow | C_ATR_RUNNER | 34 | 6.145 | 0.181 | -0.089 | 50% | 0 | 0% | 0% | 3.921 |
| shadow | D_ADAPTIVE | 34 | 6.374 | 0.187 | -0.225 | 50% | 0 | 0% | 0% | 4.15 |
| shadow | B_CONFIRM_CLOSE | 34 | 4.768 | 0.14 | -0.501 | 50% | 0 | 0% | 0% | 2.544 |
| shadow | B_BE_PLUS_010 | 34 | 4.079 | 0.12 | -0.214 | 50% | 0 | 0% | 0% | 1.855 |
| shadow | B_BE_PLUS_025 | 34 | 4.454 | 0.131 | -0.177 | 50% | 0 | 0% | 0% | 2.23 |
| challenger | A_CURRENT | 39 | 5.87 | 0.151 | 1.169 | 53.8% | 0 | 0% | 0% | 0 |
| challenger | B_PROTECTED | 39 | 10.113 | 0.259 | 0.589 | 53.8% | 0 | 0% | 0% | 4.243 |
| challenger | C_ATR_RUNNER | 39 | 10.512 | 0.27 | 0.91 | 53.8% | 0 | 0% | 0% | 4.642 |
| challenger | D_ADAPTIVE | 39 | 11.582 | 0.297 | 0.801 | 53.8% | 0 | 0% | 0% | 5.712 |
| challenger | B_CONFIRM_CLOSE | 39 | 9.548 | 0.245 | 0.585 | 53.8% | 0 | 0% | 0% | 3.678 |
| challenger | B_BE_PLUS_010 | 39 | 9.35 | 0.24 | 0.639 | 53.8% | 0 | 0% | 0% | 3.48 |
| challenger | B_BE_PLUS_025 | 39 | 8.854 | 0.227 | 0.714 | 53.8% | 0 | 0% | 0% | 2.984 |
| regime | A_CURRENT | 66 | -6.62 | -0.1 | -1.103 | 45.5% | 0 | 0% | 0% | 0 |
| regime | B_PROTECTED | 66 | 0.428 | 0.006 | -1.103 | 45.5% | 0 | 0% | 0% | 7.048 |
| regime | C_ATR_RUNNER | 66 | -5.441 | -0.082 | -1.103 | 45.5% | 0 | 0% | 0% | 1.179 |
| regime | D_ADAPTIVE | 66 | -4.116 | -0.062 | -1.103 | 45.5% | 0 | 0% | 0% | 2.504 |
| regime | B_CONFIRM_CLOSE | 66 | 1.455 | 0.022 | -1.103 | 43.9% | 0 | 0% | 0% | 8.075 |
| regime | B_BE_PLUS_010 | 66 | 0.778 | 0.012 | -1.103 | 45.5% | 0 | 0% | 0% | 7.398 |
| regime | B_BE_PLUS_025 | 66 | -1.321 | -0.02 | -1.103 | 45.5% | 0 | 0% | 0% | 5.299 |

## Cross-window robustness

| Bot | Modell | Positive Δ windows | Avg ΔR vs A | Mean Avg R | Mean Total R |
|---|---|---:|---:|---:|---:|
| challenger | D_ADAPTIVE | 2/3 | 1.922 | -0.144 | -0.288 |
| baseline | D_ADAPTIVE | 2/3 | 1.523 | -0.122 | 0.358 |
| regime | B_CONFIRM_CLOSE | 2/3 | 1.357 | -0.441 | -11.535 |
| shadow | D_ADAPTIVE | 2/3 | 1.297 | -0.331 | -3.971 |
| shadow | C_ATR_RUNNER | 2/3 | 1.293 | -0.325 | -3.975 |
| regime | B_BE_PLUS_025 | 2/3 | 1.248 | -0.418 | -11.645 |
| challenger | B_PROTECTED | 2/3 | 0.942 | -0.18 | -1.268 |
| challenger | B_BE_PLUS_010 | 2/3 | 0.821 | -0.179 | -1.389 |
| regime | D_ADAPTIVE | 2/3 | 0.708 | -0.422 | -12.185 |
| regime | C_ATR_RUNNER | 2/3 | 0.707 | -0.409 | -12.186 |
| challenger | B_BE_PLUS_025 | 2/3 | 0.641 | -0.181 | -1.57 |
| baseline | B_PROTECTED | 2/3 | 0.625 | -0.156 | -0.54 |
| baseline | B_BE_PLUS_010 | 2/3 | 0.537 | -0.154 | -0.628 |
| baseline | B_BE_PLUS_025 | 2/3 | 0.406 | -0.155 | -0.759 |
| regime | B_BE_PLUS_010 | 1/3 | 1.623 | -0.418 | -11.27 |
| regime | B_PROTECTED | 1/3 | 1.289 | -0.428 | -11.603 |
| challenger | C_ATR_RUNNER | 1/3 | 1.167 | -0.162 | -1.043 |
| baseline | C_ATR_RUNNER | 1/3 | 0.912 | -0.136 | -0.253 |
| shadow | B_PROTECTED | 1/3 | 0.505 | -0.373 | -4.763 |
| shadow | B_BE_PLUS_025 | 1/3 | 0.287 | -0.371 | -4.981 |
| shadow | B_BE_PLUS_010 | 1/3 | 0.012 | -0.384 | -5.256 |
| challenger | B_CONFIRM_CLOSE | 1/3 | -0.468 | -0.255 | -2.679 |
| shadow | B_CONFIRM_CLOSE | 1/3 | -0.661 | -0.441 | -5.929 |
| baseline | B_CONFIRM_CLOSE | 1/3 | -0.734 | -0.226 | -1.899 |
| baseline | A_CURRENT | 0/3 | 0 | -0.147 | -1.165 |
| shadow | A_CURRENT | 0/3 | 0 | -0.36 | -5.268 |
| challenger | A_CURRENT | 0/3 | 0 | -0.181 | -2.21 |
| regime | A_CURRENT | 0/3 | 0 | -0.414 | -12.893 |
