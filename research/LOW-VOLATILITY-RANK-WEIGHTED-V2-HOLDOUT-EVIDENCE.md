# Low-Volatility Rank-Weighted V2 — Frozen Holdout Evidence

Status: **HOLDOUT PASS / PROSPECTIVE PAPER REVIEW ONLY / LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Research only: **true**  
Execution impact: **false**

## Canonical lineage

The canonical first untouched Holdout evaluation is:

- frozen Development PASS merge: `60ec789dc05c68f64155af139de5f53068c0c02d`;
- Holdout implementation merge: `76e7161ab00886932412a027b9e93b1061ecce4a`;
- Holdout run-authorization commit: `b15bddb8f316b8d313dd8893a46654849db2a6cd`;
- workflow run: **37133809945 — SUCCESS**;
- invariants job: **111234091190 — SUCCESS**;
- source job: **111234113412 — SUCCESS**;
- evaluate job: **111234154391 — SUCCESS**.

Frozen Development prerequisite:

- canonical Development workflow: **37132394717**;
- Development decision: `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`;
- Development evidence blob: `e9babe1566c8667a21eb6cae8388ca6dfb77385e`;
- Development frozen summary blob: `5b3ada9fd32abe4747fbc854bb5f5388e15e6763`.

## Untouched source provenance

Holdout source artifact:

- artifact ID: **11278085201**;
- ZIP digest: `sha256:8f9ed3953268ba985034ecd6db09a4a3e5900c835061ce6930b710320de50426`;
- source receipt digest: `cba10d070b2956d4ba293888f26dcd65c93875096aee22b5a7b7e457bbe5b76e`;
- source manifest SHA-256: `ed2ed862e62578dd0695a5d852e1e661ef2ee01dcc6d37f1e0e35b87168aa230`.

The source package contains only official public Binance Vision USD-M monthly 1h kline and fundingRate archives for the 12 frozen assets.

Independent source facts:

- **6,386** contiguous hourly rows per asset;
- first hourly row: **2025-12-05T23:00:00Z**;
- last hourly row: **2026-08-29T00:00:00Z**;
- **715** retained funding rows per asset;
- first retained funding timestamp: **2026-01-03T00:00:00.001Z**;
- last retained funding timestamp: **2026-08-29T00:00:00Z**;
- 9 kline archives and 9 funding archives per asset;
- no private data;
- no synthetic backfill;
- no Paper/live data.

December 2025 hourly rows exist only to form the frozen 28-day feature for the first Holdout anchor.

## Exact result artifact

Canonical Holdout result artifact:

- artifact ID: **11277199985**;
- ZIP digest: `sha256:7c96e9456d80f3eb61047f6c7f108dddddbf704409f6526643f5fa3f8e1106af`;
- exact full result JSON SHA-256: `c88ab6074e3fc0777f3a69693d6e549a9b704f7a668b384a44d0e0db02a01dd0`;
- exact Markdown SHA-256: `24cdf3b1d54a943fa17645bcb77237b3082ba73e72dc196554ed13b767f24e7a`;
- runner prehash SHA-256: `93afdabd1208e56ada008499b8e27d20793ca2c50c141a44d6aabfc2609fdbc3`.

The full JSON remains represented by its exact cryptographic digest. The repository freezes the exact Markdown summary and a compact canonical JSON summary.

## First untouched Holdout result

Decision:

`HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`

| Frozen metric | Holdout result | Frozen gate |
|---|---:|---:|
| Periods | **34** | exactly 34 |
| Baseline compounded return | **+15.0184%** | >0 |
| Profit Factor | **1.8469** | >=1.15 |
| Annualized weekly Sharpe | **1.7417** | >=0.75 |
| Max drawdown | **5.4217%** | <=20% |
| Positive chronological blocks | **4/4** | >=3/4 |
| 20-bps stress compounded return | **+13.8589%** | >0 |
| Mean weekly Rank IC | **+0.187988** | >0 |
| Rank IC Newey-West(4) t | **4.6585** | >=1.645 |
| Gross exposure deviation | **0.0** | <=1e-12 |
| Absolute net exposure | **0.0** | <=1e-12 |

Chronological Holdout block returns:

- Block 1: **+3.8288%**
- Block 2: **+5.8097%**
- Block 3: **+4.2669%**
- Block 4: **+0.4100%**

Accounting diagnostics:

- total turnover: **10.2222**;
- baseline cost contribution: **-1.0222%**;
- price contribution: **+16.9810%**;
- funding contribution: **-1.4189%**.

Every frozen Holdout gate passed.

## Development-to-Holdout consistency

The same frozen V2 strategy family passed both stages without parameter changes.

Development:

- net compounded return: **+31.2784%**;
- Profit Factor: **1.8084**;
- Sharpe: **1.7021**;
- max drawdown: **7.3433%**;
- 20-bps stress return: **+29.4741%**;
- Rank IC Newey-West(4) t: **4.3375**;
- positive chronological blocks: **4/4**.

Untouched Holdout:

- net compounded return: **+15.0184%**;
- Profit Factor: **1.8469**;
- Sharpe: **1.7417**;
- max drawdown: **5.4217%**;
- 20-bps stress return: **+13.8589%**;
- Rank IC Newey-West(4) t: **4.6585**;
- positive chronological blocks: **4/4**.

This is descriptive evidence only; it is not a guarantee of future performance.

## Asset attribution diagnostic

Frozen Holdout attribution:

| Asset | Attribution |
|---|---:|
| BTC | -2.8876% |
| ETH | -3.6838% |
| BNB | -2.3874% |
| SOL | -0.6381% |
| XRP | +5.6010% |
| ADA | +0.7825% |
| DOGE | +6.4145% |
| LINK | +0.0096% |
| DOT | +12.7293% |
| LTC | -3.0006% |
| BCH | +0.6423% |
| AVAX | +0.9584% |

These contributions are descriptive only. No asset may be removed, reweighted, or selected retrospectively from this Holdout result.

## Research consequence

The Holdout PASS authorizes only a **prospective Paper-review decision**.

It does not authorize:

- automatic Paper deployment;
- changing the frozen V2 rules based on Holdout;
- live trading;
- leverage escalation;
- capital allocation.

Any next phase must be separately defined as forward-only evidence with no historical retuning. If a Paper phase is approved, it must preserve the frozen signal/weighting mechanics and clearly separate simulated execution from live capital.
