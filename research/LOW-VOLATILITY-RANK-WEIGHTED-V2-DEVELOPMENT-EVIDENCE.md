# Low-Volatility Rank-Weighted V2 — Frozen Development Evidence

Status: **DEVELOPMENT PASS / HOLDOUT REQUIRED / PAPER AND LIVE NOT AUTHORIZED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Research only: **true**  
Execution impact: **false**

## Canonical lineage

The canonical first valid Development evaluation is:

- corrected implementation merge: `257fcd3fba441e3ccb4103ba8c1382185d22c9a0`;
- corrected run-authorization commit: `a30a789ce058b08452bb4597f4a92b3bd58383e1`;
- workflow run: **37132394717 — SUCCESS**;
- invariants job: **111229932560 — SUCCESS**;
- source job: **111229963737 — SUCCESS**;
- evaluate job: **111230001510 — SUCCESS**.

The earlier run **37131815781** is not a scientific result. It stopped with `dataIntegrityFailure=true`, `result=null`, and `stress=null` because official funding timestamps exceeded the nominal interval grid by at most 16 ms. The fixed 1,000 ms coverage-validator tolerance was reviewed and merged before the canonical run. No strategy rule, date, asset, cost, funding value, inclusion boundary, or gate threshold was changed.

## Source provenance

Canonical source artifact:

- artifact ID: **11277247641**;
- ZIP digest: `sha256:b62f7b3eadacc7c55a1d61006d645caea385dbd73c33854522c30624499e5556`;
- source receipt digest: `c632e7a00c30625fc3efb7a58c400e9c9b481bb0c603aa95bf68e0be44ba6220`;
- source manifest SHA-256: `770e7d452422793debc08c80f19f168c6da6ef487db6c9c2b2ce3726a05a8662`.

The source is restricted to official public Binance Vision USD-M monthly 1h klines and fundingRate archives for the 12 frozen assets. Development hourly rows end at 2026-01-03T00:00:00Z. No untouched Holdout evaluation occurred.

## Exact result artifact

Canonical result artifact:

- artifact ID: **11277656738**;
- ZIP digest: `sha256:e076f9424b4373621bec7502d9835945a00a1211716ba299057b7adcd7b22314`;
- exact full result JSON SHA-256: `c72046db7aeb0e28a87e3e8e2c181b9d67f8ed9b8eae275c3b7f4037793a16bb`;
- exact Markdown SHA-256: `e0a2c60b690ddd0c3b5cf141e21208bf2f255de0f1952f1853f1df14fcbeec62`;
- runner prehash SHA-256: `2362f76bac08deb9ff4271fba5d1d1545a455e03bf2271b924ffcc8f09d626b1`.

The full JSON remains represented by its exact cryptographic digest. The repository freezes a compact canonical JSON summary and the exact Markdown result summary.

## Canonical Development result

Decision:

`DEVELOPMENT_PASS_HOLDOUT_REQUIRED`

| Frozen metric | Result | Frozen gate |
|---|---:|---:|
| Periods | **48** | exactly 48 |
| Baseline compounded return | **+31.2784%** | >0 |
| Profit Factor | **1.8084** | >=1.15 |
| Annualized weekly Sharpe | **1.7021** | >=0.75 |
| Max drawdown | **7.3433%** | <=20% |
| Positive chronological blocks | **4/4** | >=3/4 |
| 20-bps stress compounded return | **+29.4741%** | >0 |
| Mean weekly Rank IC | **+0.215035** | >0 |
| Rank IC Newey-West(4) t | **4.3375** | >=1.645 |
| Gross exposure deviation | **0.0** | <=1e-12 |
| Absolute net exposure | **0.0** | <=1e-12 |

Chronological block returns:

- Block 1: **+2.6529%**
- Block 2: **+8.8203%**
- Block 3: **+13.9046%**
- Block 4: **+3.1741%**

Accounting diagnostics:

- total turnover: **13.8889**;
- baseline cost contribution: **-1.3889%**;
- price contribution: **+30.6015%**;
- funding contribution: **-0.3981%**.

All frozen Development conditions passed.

## Asset attribution diagnostic

Frozen Development attribution from the canonical result:

| Asset | Attribution |
|---|---:|
| BTC | -2.5292% |
| ETH | -5.0031% |
| BNB | +7.5406% |
| SOL | +0.2424% |
| XRP | +0.5920% |
| ADA | +0.0721% |
| DOGE | +3.2632% |
| LINK | +4.4038% |
| DOT | +9.4456% |
| LTC | +9.9463% |
| BCH | +1.0857% |
| AVAX | -0.2449% |

These values are descriptive diagnostics only. No asset is removed, reweighted, or selected based on these contributions.

## Duplicate-run handling

A later workflow run **37132982310** was triggered after the canonical run had already completed. It is not part of the scientific lineage and is not used for selection or promotion.

It independently reproduced:

- the same decision;
- the same source digest;
- the same Development summary metrics.

This later duplicate is treated only as a reproducibility check. The earlier canonical run **37132394717** remains the frozen Development result.

## Research consequence

The Development PASS authorizes only the next preregistered step: an isolated untouched Holdout implementation and, after review, one separately authorized Holdout evaluation.

Still not authorized:

- changing V2 feature, ranks, assets, costs, funding treatment, dates, or gates;
- using Development attribution to retune the portfolio;
- inspecting Holdout before its implementation and run authorization are frozen;
- Paper execution;
- live execution.

The untouched Holdout must use the identical 34-period frozen V2 rules and must independently pass every preregistered Holdout gate before any prospective Paper-review discussion.
