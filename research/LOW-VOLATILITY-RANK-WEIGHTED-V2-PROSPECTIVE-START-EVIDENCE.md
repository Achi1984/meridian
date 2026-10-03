# Low-Volatility Rank-Weighted V2 — Prospective Shadow Start Evidence

Status: **START AUTHORIZED / SOURCE PATH VERIFIED / ZERO ELIGIBLE PROSPECTIVE OUTCOMES / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Stage: `PROSPECTIVE_PAPER_SHADOW`

## Frozen start

Prospective start:

**2026-10-10T00:00:00Z**

Fixed first-12-week performance-gate endpoint:

**2027-01-02T00:00:00Z**

The start authorization was recorded before the start boundary and before any fully prospective outcome could exist.

Authorization blob:

`1d4ec4f2386005b7a5094ea3f4ea2d3143b9b9a7`

## Pre-start transport history

Two source probes failed before any eligible prospective evidence was produced:

- workflow **37143326461** — public USD-M REST primary host returned HTTP 451;
- workflow **37143595493** — official REST mirrors were unusable from the GitHub-hosted runner.

Both runs are non-evidence. Neither collected an eligible prospective outcome or emitted prospective performance.

The reviewed source transport was then changed to official Binance Vision monthly+daily USD-M archives without changing the strategy, start boundary, costs, or gate.

## Successful source-path verification

Canonical verification workflow:

**37143900156 — SUCCESS**

Jobs:

- invariants: **111263797471 — SUCCESS**
- snapshot: **111263818510 — SUCCESS**

The workflow successfully:

- collected official Binance Vision archive data;
- verified exact source hashes and continuity;
- built a prospective shadow snapshot;
- uploaded source/snapshot artifacts;
- appended the first immutable diagnostic snapshot to the dedicated evidence branch.

Source artifact:

- ID **11281656469**
- ZIP SHA-256: `da3b14d8828b52e9d09ddf8706fa5faa84bab56316474a79ee370415f181f61d`

Snapshot artifact:

- ID **11281676479**
- ZIP SHA-256: `fb0d89f2b2d82a83255632450bb4323d8d5201733b3f132d2dda8b27b2ed732e`

## Diagnostic baseline snapshot

Evidence-branch commit:

`e2923eb`

Snapshot:

`2026-09-26T000000Z`

Result:

- decision: `PROSPECTIVE_WAITING_FOR_START`
- completed prospective observations: **0**
- eligible gate observations: **0**
- data-integrity failure: **false**
- Paper authorized: **false**
- live authorized: **false**
- auto-promotion: **false**
- source digest: `43b7b1295ed591091d27a8297d03655a51e0be53eee34e254a55a6561464480b`

The snapshot is deliberately marked **timely=false** because it is a retrospective pre-start diagnostic cutoff. It cannot count toward the prospective gate.

## Canonical forward schedule

The default-branch workflow runs on Sunday at **02:15 UTC** using completed Binance Vision daily archives.

The required first start-boundary snapshot is the Saturday **2026-10-10T00:00:00Z** cutoff. It must still contain zero completed prospective observations.

The first eligible completed return is the week ending:

**2026-10-17T00:00:00Z**

The 12th and final fixed gate observation ends:

**2027-01-02T00:00:00Z**

Required canonical snapshots must be collected within 36 hours of their Saturday cutoff and are first-write immutable on the evidence branch.

## Promotion boundary

Phase C is active only as forward-only shadow evidence.

No Paper deployment, live deployment, account access, exchange mutation, capital allocation, or strategy retuning is authorized.

A future performance PASS still requires a separate human-reviewed ledger decision before any Paper proposal can be considered.
