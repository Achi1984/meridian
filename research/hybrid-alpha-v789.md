# MERIDIAN v7.89 — Hybrid Alpha V1 Thesis Stack

Status: RESEARCH ONLY. No execution impact. No Pionex changes. Baseline 6.2 remains frozen.

## Goal

Build a new crypto research bot from evidence-backed financial-market theses without turning every observation into a hard entry gate. The bot is a soft evidence router: multiple independent signals contribute to one signed alpha score, regime changes the weights, and risk is scaled down by volatility / reversal risk / liquidity quality.

## Thesis comparison

### 1. Time-series momentum / trend following — PRIMARY
Classic time-series momentum evidence (Moskowitz, Ooi, Pedersen) documents return persistence across liquid futures markets. Recent crypto-specific work also reports value in volatility-adaptive trend following. This is the structural core because crypto trends can persist and because trend-following is naturally compatible with both LONG and SHORT.

Sources:
- Moskowitz, Ooi, Pedersen — Time Series Momentum: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463
- Karassavidis — Quantitative Evaluation of Volatility-Adaptive Trend-Following Models in Cryptocurrency Markets: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5821842
- Bui & Nguyen — Systematic Trend-Following with Adaptive Portfolio Construction: https://arxiv.org/abs/2602.11708

### 2. Cross-sectional / relative-strength momentum — SECONDARY
Rather than asking only whether an asset is rising, compare its strength with the crypto universe. This can improve asset selection while avoiding a blanket long/short assumption. It is deliberately a soft component because cross-sectional leadership can reverse quickly in crypto.

### 3. Mean reversion / reversal — REGIME-CONDITIONAL
Mean reversion should not fight a strong trend by default. It receives its largest weight in RANGE / SIDEWAYS conditions and only a small weight in BULL/BEAR trend regimes. Reversal-risk evidence is also used as a risk attenuator rather than as a mandatory veto.

Related evidence:
- Early warning of cryptocurrency reversal risks via multi-source data, Finance Research Letters (2025): https://doi.org/10.1016/j.frl.2025.107890

### 4. Carry / funding — SECONDARY
Perpetual funding can represent positioning pressure and carry. The prototype treats it as signed evidence, not as a standalone trade rule. Extreme funding can support either continuation or crowded-position reversal depending on regime, so its weight stays modest until MERIDIAN measures its own OOS contribution.

### 5. Order flow / microstructure — HIGH-POTENTIAL, DATA-DEPENDENT
Recent published crypto research finds predictive information in order flow and market-microstructure variables. At the same time, short samples can be unstable: a 2026 BTC/USDT OFI study reports that the out-of-sample conclusion reversed as the sample was extended. Therefore order flow is useful as a soft feature but must not become a hard gate until MERIDIAN has a reliable, leakage-safe feed and walk-forward evidence.

Sources:
- Anastasopoulos et al. — Order flow and cryptocurrency returns, Journal of Financial Markets (2026): https://doi.org/10.1016/j.finmar.2026.101047
- Easley, O'Hara, Yang, Zhang — Microstructure and market dynamics in crypto markets (2026): https://doi.org/10.1016/j.finmar.2026.101071
- Schmalz — Order Flow Imbalance and Short-Horizon BTC/USDT Returns (2026): https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7227998

### 6. Machine learning — LATER META-LAYER, NOT V1 CORE
Recent high-dimensional crypto return research reports that tree-based models can outperform neural networks OOS and that on-chain characteristics may matter. ML is therefore a candidate for later weighting / meta-labeling, but V1 stays transparent and auditable to avoid look-ahead, overfitting and opaque feature interactions.

Source:
- Li et al. — Predicting cryptocurrency returns with machine learning: Evidence from high-dimensional factor modeling, Pacific-Basin Finance Journal (2026): https://doi.org/10.1016/j.pacfin.2025.103033

## Hybrid Alpha V1 design

Inputs are normalized to [-1,+1]:
- trend
- momentum
- relativeStrength
- meanReversion
- carry
- orderFlow

Context inputs:
- regime: BULL / BEAR / RANGE / TRANSITION
- reversalRisk: 0..1
- volatilityRatio: current volatility / target-normal volatility
- liquidityQuality: 0..1

The model uses regime-dependent weights. Trend and momentum dominate BULL/BEAR; mean reversion becomes material in RANGE; order flow has a moderate role across regimes. Missing optional features are simply excluded and remaining weights are renormalized.

Only one non-market hard guard exists: at least 3 evidence components must be present. Otherwise the bot returns OBSERVE. A signed alpha magnitude below 0.20 also returns OBSERVE. This is not an indicator gate stack; it is a minimum evidence-quality requirement.

Risk multiplier is bounded <=1.0. Volatility, reversal risk and weak liquidity can only reduce risk. V1 never increases leverage above the parent research risk budget.

## Why this mix is plausible

The hypotheses are intentionally complementary:
- trend captures persistence;
- relative strength chooses where the persistence is strongest;
- mean reversion helps during range/chop;
- carry reflects crowded positioning / holding economics;
- order flow adds short-horizon information;
- volatility and reversal risk control exposure instead of trying to predict every turning point.

The expected advantage is not that every thesis is always profitable. The thesis is that a regime-aware blend can reduce the opportunity cost of one-dimensional filters while preserving enough trade frequency.

## Promotion protocol

No promotion from this design alone. Required next steps:
1. Construct leakage-safe historical features from information available at decision time only.
2. Compare Hybrid Alpha V1 against Baseline and Challenger V2 on identical windows and identical exit assumptions.
3. Report LONG/SHORT × regime × asset, PF, expectancy, DD, trade frequency, market capture and opportunity cost.
4. Walk-forward OOS with purge/embargo where overlapping labels exist.
5. Transaction-cost / slippage sensitivity.
6. Parameter sensitivity; reject if profitability depends on a narrow weight/threshold island.
7. Shadow ledger first; human approval required before any execution integration.

## Current decision

BUILD AS SHADOW RESEARCH CANDIDATE. No live/Paper execution connection yet.
