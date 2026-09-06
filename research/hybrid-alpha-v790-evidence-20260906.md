# MERIDIAN v7.90 — Hybrid Alpha V1 First Public-Market Evidence

Status: RESEARCH ONLY. No execution impact. No Pionex changes. Baseline 6.2 frozen.

Evidence run: GitHub Actions `Hybrid Alpha v7.90 Evidence` run `34023372237` on head `8c07a24e3df7c0eb3a1197f552391ef3e39807f2`.
Artifact: `9986258396`, digest `sha256:c3c3961d740328572ff2f83ad79dc378cfa7b848816dfc1077236719ca72c0ef`.
Source: public Coinbase Exchange 15m candles for BTC-USD / ETH-USD / SOL-USD.

## Method

- Decision-time feature snapshots only.
- Trend blends closed 15m, 1h and 4h evidence.
- Momentum, relative strength, mean reversion, volatility ratio, liquidity quality and reversal-risk attenuation are computed only from information available at decision time.
- Funding/carry and true order-flow are absent in this pass and therefore omitted, not fabricated; Hybrid Alpha V1 renormalizes remaining soft weights.
- Forward outcomes use non-overlapping 4h / 12h / 24h horizons.
- Forward R = future return divided by decision-time ATR14 percent. This is a normalized research label, not Baseline TP/SL R.
- Cost assumption = 0.03R per full research-risk unit; cost scales with the risk multiplier.

## Headline 30/60/90d results

| Horizon | 30d PF / EXP | 60d PF / EXP | 90d PF / EXP | Verdict |
|---|---:|---:|---:|---|
| 4h | 0.90 / -0.083R | 0.89 / -0.089R | 0.95 / -0.043R | FAIL |
| 12h | 1.10 / +0.127R | 0.76 / -0.401R | 0.94 / -0.088R | FAIL |
| 24h | 2.73 / +3.225R | 1.22 / +0.563R | 1.04 / +0.102R | NOT ROBUST |

The 24h headline is positive, but chronological stability fails: in the 90d sample the three descriptive folds have PF 0.68 / 0.35 / 2.64 and expectancy -0.799R / -2.176R / +3.095R. The apparent edge is concentrated in the latest fold and must not be treated as a robust OOS result.

## 90d structural cohorts

### Side
- 4h LONG: n=639, PF 1.07, EXP +0.055R; SHORT: n=426, PF 0.80, EXP -0.190R.
- 12h LONG: n=220, PF 1.18, EXP +0.239R; SHORT: n=144, PF 0.67, EXP -0.587R.
- 24h LONG: n=123, PF 1.50, EXP +1.144R; SHORT: n=69, PF 0.42, EXP -1.754R.

The current Hybrid Alpha V1 short leg is consistently the main drag across all tested horizons. This is opposite to the current legacy Challenger V2 sample, where SHORT is the stronger adequate cohort. Therefore no global `SHORT bad` thesis is justified; the weakness is model-specific.

### Regime
- BULL is positive at all tested 90d horizons: PF 1.06 / 1.34 / 1.91 for 4h / 12h / 24h.
- BEAR is negative at all tested horizons: PF 0.69 / 0.59 / 0.66.
- TRANSITION is near flat at 4h but materially negative at 12h/24h.
- RANGE is near flat to negative in the broader V1 public evidence, despite the small legacy Challenger RANGE cohort being strongly positive.

This again argues against hard regime gates. Different models express different conditional edges.

### Asset
- SOL is the only symbol positive at all tested 90d horizons: PF 1.10 / 1.08 / 1.06.
- ETH is negative at 4h/12h but positive at 24h (PF 1.19).
- BTC is negative at all three tested horizons.

Do not make an asset allow-list from this sample. Use asset reliability only as prior-history soft sizing evidence.

## Decision

**NO PROMOTION. HYBRID ALPHA V1 FAILS ROBUSTNESS.**

The useful finding is structural: the thesis stack contains pockets of edge, but fixed global regime weights mis-handle short/bear contexts and temporal stability. The next candidate should not add more hard indicators. It should preserve the transparent alpha score and add leakage-safe, prior-only reliability attenuation that can reduce risk for historically weak side/regime/asset cohorts without increasing risk above V1 and without hard-blocking trades.

## Next research candidate — v7.91

Build a prior-only Reliability Router:
1. Base decision remains Hybrid Alpha V1.
2. At each decision, use only earlier matured outcomes from a bounded lookback window.
3. Estimate side / regime / asset reliability with shrinkage toward neutral.
4. Poor prior expectancy may only reduce the V1 risk multiplier; it cannot increase leverage above V1 and does not create a hard entry gate.
5. Compare V1 vs Reliability Router on the same non-overlapping 30/60/90d evidence and chronological folds.
6. Reject if gains depend on one horizon, one asset or one recent fold.
