# MERIDIAN Market Microstructure Data Foundation V1 — Evidence

Status: SOURCE TRANSPORT FAIL — NO ALPHA TEST — NO PROMOTION.

Evidence run: GitHub Actions `Market Microstructure Data V1` run #2 on implementation head `acb8076988860427df95a9320092ac9533f1eb42`.
Artifact: `9994746232`.
Digest: `sha256:f44a2ed34cf7e2f98bd7fb4a5f95eedc8b74e7fefcc00025b6f96ac1adaa4925`.
Cutoff: `2026-09-06T17:00:00Z`.

## Result

The official Binance USDⓈ-M Futures endpoints returned HTTP `451` from the GitHub Actions runner location:

> Service unavailable from a restricted location according to eligibility terms.

This occurred for every locked symbol — BTC, ETH, SOL, XRP, ADA, AVAX and LINK — on all three endpoint families:

- funding history;
- open-interest statistics;
- taker buy/sell volume.

The audit records the status and response hash rather than crashing or inventing rows. All series contain zero canonical observations and fail coverage/freshness gates.

## Foundation decision

- Funding ready: `false`.
- Open interest ready: `false`.
- Taker flow ready: `false`.
- All features ready: `false`.
- Funding-only ready: `false`.
- Alpha evidence: `false`.
- Experiment permitted: `false`.
- Promotion permitted: `false`.

## Decision

Do not bypass the location restriction with a proxy, VPN, alternate runner region or undocumented endpoint. Do not treat current snapshots from another source as Binance history.

Any continuation requires a separately predeclared source-portability audit against an officially documented, lawfully accessible public provider. Provider differences in venue, contract, timestamp semantics and retention must remain explicit; data may not be silently mixed with Binance or used as a historical proxy.

No changes were made to v7.97, Baseline 6.2, Paper/live execution, `server.js` or Pionex.
