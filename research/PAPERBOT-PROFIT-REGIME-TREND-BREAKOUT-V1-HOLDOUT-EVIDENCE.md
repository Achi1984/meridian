# Regime-Gated Trend / Breakout V1 — Frozen Holdout Evidence

Status: **HOLDOUT FAIL / PAPER-SHADOW NOT AUTHORIZED**  
Ruleset: `PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`  
Execution impact: **false**  
Auto-promotion: **false**

## Provenance

- Holdout implementation merge commit: `4fc28499e0064985c06cf53d8e84bfd265a52aac`
- Holdout implementation PR: **#463**
- Holdout run-authorization commit: `86d9e0bc518854f57b086c30cd238c6d05131574`
- Holdout workflow run: **37113947919 — SUCCESS**
- Evaluate job: **111177040270**
- Source handoff artifact: **11270302232**
- Source artifact digest: `sha256:51e84ed6eb02fd8ebbb49351d5c4e1ad59555b69f571f807a6d021f6f0473b06`
- Result artifact: **11270262408**
- Result artifact digest: `sha256:9b340d23de33da7d087fee01344f32d2d1db9a984a2bd4e85618bacb1bdfff45`
- Exact result JSON SHA-256: `cb12f02d132ac6fbe0be37baf7fccde407d76dcd9bf39a81fca87d636e2d8559`
- Exact result Markdown SHA-256: `dcc5c4915abc41d88063bdb6c8189b9a6c2d9fb12c0128b7cab4497895a58461`
- Exact source JSON SHA-256: `08fb30cd3c9028920637c71d86035a723be2fdc63ee25607b842dc79211cc69b`
- Frozen Discovery result blob: `c3a5b72d27f825e2df951794fb782af429cfafc8`
- Frozen Discovery result PR: **#462**

The Source handoff artifact digest is identical to the frozen Discovery source artifact digest. Discovery parity reproduced before Holdout evaluation.

## Frozen first untouched Holdout result

Decision:

`REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL`

| Gate input | Frozen Holdout result |
|---|---:|
| Evaluation periods | 375 |
| Net compounded return, 8 bps | **+4.9586%** |
| PnL on 10,000 start equity | **+495.86** |
| Profit Factor | **1.11600** |
| Max drawdown | **4.8533%** |
| Positive chronological windows | **3/5** |
| Positive assets | **6/8** |
| Positive-PnL concentration | **38.8849%** |
| 16-bps stress compounded return | **+4.5071%** |
| Turnover notional | 65,761.72 |
| Maximum gross exposure | 0.23348x |

## Frozen gate decision

The Holdout failed exactly three preregistered Stage-B gates:

- `PF_LT_1_15`
- `POSITIVE_WINDOWS_LT_4_OF_5`
- `POSITIVE_PNL_CONCENTRATION_GT_35PCT`

The positive net return, stress return, drawdown and 6/8 positive-asset breadth do not override those failed gates.

## Research consequence

This result does **not** authorize Paper shadow, Paper bot changes, live trading, parameter retuning, universe selection, threshold relaxation or cost-assumption changes.

The completed V1 line remains a frozen negative Holdout result. Any successor must be a separately motivated and preregistered research hypothesis; it may not be a post-hoc rescue of these failed Holdout metrics.
