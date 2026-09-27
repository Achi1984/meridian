# MERIDIAN Documented Edge Lab V1 — Frozen Protocol

Status: **research only**  
Ruleset: `DOCUMENTED-EDGE-LAB-V1-FROZEN`

This lab starts from published strategy families instead of optimizing MERIDIAN's existing technical rules.

## 1. TSMOM Classic — crypto adaptation

Evidence base:
- Moskowitz, Ooi & Pedersen (2012), *Time Series Momentum*
- Hurst, Ooi & Pedersen (2017), *A Century of Evidence on Trend-Following Investing*

Frozen replication mechanics:
- daily public price history
- binary 1-month / 3-month / 12-month direction signals
- crypto-calendar approximations: 30 / 90 / 365 days
- equal-weight average of the three signals
- rebalance every 30 days
- 60-day realized volatility estimate
- 10% annualized per-market volatility target
- leverage capped at 2x as a MERIDIAN research safety constraint
- 8 bps modeled cost per unit of exposure turnover
- multi-asset portfolio across BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI when sufficient history exists

The leverage cap and crypto-calendar mapping mean this is a transparent crypto adaptation, not a byte-for-byte reproduction of the original futures portfolio.

Frozen internal research gate:
- >= 24 portfolio periods
- PF >= 1.10
- positive total return
- max drawdown <= 25%
- >= 3/5 positive chronological windows
- >= 4 positive assets

A pass does not permit live trading.

## 2. Funding Carry — existing MERIDIAN evidence

The existing Funding Carry research remains frozen and is surfaced rather than rewritten.

Current code state:
- Funding Carry V2 new entries are disabled.
- Retirement reason: repeatability sample gate.
- Earlier BTC/ETH/SOL evidence windows remain historical screening evidence only.
- Later cross-asset experiments remain research evidence and are not silently merged into the production strategy.

No live or Paper entry is re-enabled by this lab.

## 3. Cross-Sectional Momentum — 3-week price-only proxy

Evidence base:
- Liu, Tsyvinski & Wu (2022), *Common Risk Factors in Cryptocurrency*

The published cryptocurrency momentum factor uses cross-sectional ranking and value-weighted portfolios. MERIDIAN currently has public historical prices but not a validated historical market-cap panel.

Frozen proxy mechanics:
- 21-day formation return
- skip most recent day
- weekly rebalance
- long top 30%, short bottom 30%
- equal-weight within long and short sleeves
- dollar-neutral 50% long / 50% short gross allocation
- 8 bps modeled cost per unit of turnover

Because historical market-cap weights are missing:
- `exactReplication=false`
- the proxy can never pass to promotion
- its result is diagnostic only
- exact replication requires a separate historical market-cap data source and independent validation

## Anti-overfitting rules

- No parameter changes after seeing results within V1.
- No dropping losing assets after the batch.
- No side filtering based on the same sample.
- No changing gates to rescue a near-pass.
- Any new hypothesis becomes a separately named version with a new frozen protocol.
- No strategy in this lab can submit live orders.

## Deep-audit implementation revision

The strategy rules above remain frozen. MERIDIAN engine revision `WEIGHTED-TURNOVER-R2` corrects implementation accounting only:

- skipped under-breadth periods no longer mutate position state;
- portfolio turnover is measured on equal-weighted portfolio exposures;
- assets leaving the active universe incur explicit exit turnover cost;
- final portfolio/asset close costs are included.

Results produced before this engine revision must be rerun before they are treated as current evidence. No gate or strategy parameter was relaxed.
